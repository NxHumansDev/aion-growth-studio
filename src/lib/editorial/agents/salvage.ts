/**
 * Editorial AI — Salvage agent (Claude Sonnet 4.6, NO web_search).
 *
 * Iteration 2 fallback. Called after editor review + rewrite both failed
 * to reach APPROVED. The salvage agent does NOT investigate further — it
 * takes the existing verdict and deterministically:
 *   - Removes all `incorrect_claims` and `unsourced_claims`
 *   - Reconstructs affected paragraphs with transitions using ONLY `verified_claims`
 *   - Keeps the brand voice + format rules
 *
 * Output contract:
 *   - If ≥60% of original word count survives → status: APPROVED_SALVAGED
 *   - If <60% → status: NEEDS_HUMAN (text returned, but flagged)
 *
 * This is pure LLM without tools — fast, deterministic, no cost explosion.
 */

import { logGeneration } from '../db';
import type { Article, EditorVerdict, PublicationProfile, SalvageMetadata } from '../types';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

const SONNET_IN_PER_M = 3.0;
const SONNET_OUT_PER_M = 15.0;
const SONNET_CACHE_READ_PER_M = 0.3;

export interface SalvageResult {
  success: boolean;
  final_content?: string;
  salvage_metadata?: SalvageMetadata;
  needs_human: boolean;
  error?: string;
  cost_usd: number;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms: number;
}

const SALVAGE_SYSTEM = `Eres el editor jefe en modo SALVAGE. Tu trabajo NO es investigar.

Tu única tarea: producir la versión más larga posible del artículo que contenga SOLO afirmaciones verificadas.

REGLAS:
1. Elimina CADA "incorrect_claim" sin sustituirlo.
2. Elimina CADA "unsourced_claim" sin sustituirlo.
3. Reconstruye los párrafos afectados con transiciones coherentes usando SOLO los "verified_claims".
4. Mantén la voz de la marca (te la paso en el contexto).
5. El artículo puede quedarse más corto. Es aceptable.
6. Mantén el formato del canal (headings, hashtags, estructura).
7. Añade al final una sección "Fuentes" con las URLs de los verified_claims (numeradas).

OUTPUT:
Responde SOLO con JSON válido en bloque \`\`\`json\`\`\`:
{
  "final_content": "...texto final completo...",
  "removed_claims": ["claim 1 eliminada", "claim 2 eliminada", ...],
  "survival_notes": "breve explicación de qué has podido mantener"
}

NO inventes datos. NO busques en internet (no tienes acceso). NO sustituyas claims rechazadas.`;

function estimateCost(usage: any): number {
  if (!usage) return 0;
  const inputTokens  = usage.input_tokens  ?? 0;
  const cachedTokens = usage.cache_read_input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const regularInput = Math.max(0, inputTokens - cachedTokens);
  return (
    (regularInput  * SONNET_IN_PER_M  / 1_000_000) +
    (cachedTokens  * SONNET_CACHE_READ_PER_M / 1_000_000) +
    (outputTokens  * SONNET_OUT_PER_M / 1_000_000)
  );
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export async function runSalvage(
  article: Article,
  profile: PublicationProfile,
  latestVerdict: EditorVerdict,
): Promise<SalvageResult> {
  const t0 = Date.now();

  if (!ANTHROPIC_API_KEY) {
    return { success: false, needs_human: false, error: 'Missing ANTHROPIC_API_KEY', cost_usd: 0, latency_ms: 0 };
  }

  const sourceContent = article.revised_content ?? article.draft_content;
  if (!sourceContent || sourceContent.length < 50) {
    return { success: false, needs_human: true, error: 'No content to salvage', cost_usd: 0, latency_ms: 0 };
  }

  const originalLength = wordCount(sourceContent);

  const userBlock = [
    `# ARTÍCULO A SALVAGE`,
    '',
    `Canal: ${profile.platform}`,
    `Idioma: ${article.language === 'es' ? 'Español' : 'Inglés'}`,
    `Longitud original (palabras): ${originalLength}`,
    '',
    `## VEREDICTO DEL EDITOR (el que ya hemos intentado rewrite sin éxito)`,
    '```json',
    JSON.stringify({
      verified_claims: latestVerdict.verified_claims,
      incorrect_claims: latestVerdict.incorrect_claims,
      unsourced_claims: latestVerdict.unsourced_claims,
    }, null, 2),
    '```',
    '',
    `## CONTENIDO ACTUAL`,
    '---',
    sourceContent,
    '---',
    '',
    `Produce el salvage siguiendo las reglas del sistema. Solo JSON al final.`,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 200_000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system: SALVAGE_SYSTEM,
        messages: [{ role: 'user', content: userBlock }],
      }),
    });

    const latency_ms = Date.now() - t0;
    if (!res.ok) {
      const errText = await res.text();
      return {
        success: false, needs_human: false,
        error: `Anthropic ${res.status}: ${errText.slice(0, 300)}`,
        cost_usd: 0, latency_ms,
      };
    }

    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const cost_usd = estimateCost(data.usage);

    // Parse JSON
    const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    const candidate = fenced?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0];
    if (!candidate) {
      logGeneration({
        article_id: article.id, client_id: article.client_id,
        agent: 'editor_salvage', model: MODEL,
        tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
        cost_usd, latency_ms, success: false,
        error_message: 'No JSON in salvage response',
      }).catch(() => {});
      return { success: false, needs_human: false, error: 'No JSON in response', cost_usd, latency_ms };
    }

    let parsed: { final_content: string; removed_claims?: string[]; survival_notes?: string };
    try {
      parsed = JSON.parse(candidate);
    } catch (e: any) {
      return { success: false, needs_human: false, error: `JSON parse: ${e.message}`, cost_usd, latency_ms };
    }

    const finalLength = wordCount(parsed.final_content ?? '');
    const survivalRatio = originalLength > 0 ? finalLength / originalLength : 0;
    const needs_human = survivalRatio < 0.6;

    const salvage_metadata: SalvageMetadata = {
      removed_claims: parsed.removed_claims ?? [],
      original_length: originalLength,
      final_length: finalLength,
      survival_ratio: +survivalRatio.toFixed(2),
    };

    logGeneration({
      article_id: article.id, client_id: article.client_id,
      agent: 'editor_salvage', model: MODEL,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      cost_usd, latency_ms, success: true,
    }).catch(() => {});

    return {
      success: true,
      final_content: parsed.final_content,
      salvage_metadata,
      needs_human,
      cost_usd,
      tokens_in: data.usage?.input_tokens,
      tokens_out: data.usage?.output_tokens,
      latency_ms,
    };
  } catch (err: any) {
    const latency_ms = Date.now() - t0;
    const isAbort = err?.name === 'AbortError';
    return {
      success: false, needs_human: false,
      error: isAbort ? `Salvage timed out after ${latency_ms}ms` : String(err?.message ?? err),
      cost_usd: 0, latency_ms,
    };
  } finally {
    clearTimeout(timer);
  }
}
