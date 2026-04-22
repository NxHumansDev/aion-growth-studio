/**
 * Editorial AI — Chief Editor agent (Claude Sonnet 4.6 + web_search).
 *
 * Runs in 3 modes:
 *   - 'review'  (iter 0): fact-check only, emits verdict, no content change
 *   - 'rewrite' (iter 1): fact-check + rewrite with web_search, emits new content + verdict
 *   - (salvage lives in agents/salvage.ts; it doesn't use web_search)
 *
 * Uses Anthropic's native web_search_20250305 server tool. Search execution
 * happens on Anthropic's side — we receive citations and the model's final
 * JSON verdict in content blocks.
 *
 * Cost cap: hard limit of $2 per article total (writer + editor + rewrite).
 * Search cost: $0.01 per web_search call. We cap max_uses per call at 20.
 */

import { logGeneration, getSourcesWhitelist } from '../db';
import { CHIEF_EDITOR_SYSTEM } from '../prompts';
import type { Article, EditorVerdict, PublicationProfile } from '../types';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

// Pricing (per M tokens)
const SONNET_IN_PER_M = 3.0;
const SONNET_OUT_PER_M = 15.0;
const SONNET_CACHE_READ_PER_M = 0.3;
const WEB_SEARCH_COST_PER_CALL = 0.01;  // $10 / 1000 searches

// Per-call caps
const REVIEW_MAX_SEARCHES  = 10;  // iter 0 — fact-check (reduced from 20 to avoid Vercel 300s timeout)
const REWRITE_MAX_SEARCHES = 8;   // iter 1 — fill specific gaps

export type EditorMode = 'review' | 'rewrite';

export interface EditorResult {
  success: boolean;
  verdict?: EditorVerdict;
  revised_content?: string;  // populated only in rewrite mode
  error?: string;
  cost_usd: number;
  tokens_in?: number;
  tokens_out?: number;
  web_searches: number;
  latency_ms: number;
  stop_reason?: string;
}

function estimateCost(usage: any, webSearches: number): number {
  if (!usage) return webSearches * WEB_SEARCH_COST_PER_CALL;
  const inputTokens  = usage.input_tokens  ?? 0;
  const cachedTokens = usage.cache_read_input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const regularInput = Math.max(0, inputTokens - cachedTokens);
  return (
    (regularInput  * SONNET_IN_PER_M  / 1_000_000) +
    (cachedTokens  * SONNET_CACHE_READ_PER_M / 1_000_000) +
    (outputTokens  * SONNET_OUT_PER_M / 1_000_000) +
    (webSearches   * WEB_SEARCH_COST_PER_CALL)
  );
}

/** Build the user-facing instruction block for the editor. */
function buildEditorInstructions(
  article: Article,
  profile: PublicationProfile,
  mode: EditorMode,
  previousVerdict: EditorVerdict | null,
): string {
  const lines: string[] = [];

  lines.push(`# TAREA DEL EDITOR JEFE`);
  lines.push('');
  lines.push(`Modo: **${mode.toUpperCase()}** (iteración ${mode === 'review' ? 0 : 1})`);
  lines.push(`Idioma del artículo: ${article.language === 'es' ? 'Español' : 'Inglés'}`);
  lines.push(`Canal: ${profile.platform}`);
  lines.push(`Primary keyword objetivo: ${article.primary_keyword ?? '(no especificada)'}`);
  if (article.secondary_keywords?.length) {
    lines.push(`Secondary keywords objetivo: ${article.secondary_keywords.join(', ')}`);
  }
  lines.push('');

  if (mode === 'review') {
    lines.push(`## Acción`);
    lines.push(`Ejecuta FASE 1 (fact-check + audits SEO/GEO + plagio).`);
    lines.push(`Lanza web_search por cada afirmación factual para verificar.`);
    lines.push(`Incluye explícitamente los [NO_VERIFICADO:] del redactor.`);
    lines.push(``);
    lines.push(`**NO reescribas el artículo aún.** Solo emite el veredicto JSON.`);
  } else {
    lines.push(`## Acción`);
    lines.push(`El artículo pasó el review con estado ${previousVerdict?.status ?? 'REQUIRES_CHANGES'}.`);
    lines.push(`Ahora ejecuta FASE 2 (rewrite):`);
    lines.push(`- Los incorrect_claims del veredicto previo: busca dato real y sustituye`);
    lines.push(`- Los unsourced_claims: busca fuente o ELIMINA sin sustituir`);
    lines.push(`- Los plagiarism_warnings: reescribe la frase con tu propia estructura`);
    lines.push(`- Al final añade sección "Fuentes" con URLs numeradas`);
    lines.push(`- Re-ejecuta fact-check sobre el texto reescrito`);
    lines.push(`- Emite veredicto final JSON + texto reescrito completo`);
  }

  lines.push('');
  lines.push(`## Output`);
  lines.push(`Devuelve UN solo JSON al final de tu respuesta, con esta estructura EXACTA:`);
  lines.push(``);
  lines.push('```json');
  lines.push(`{`);
  lines.push(`  "status": "APPROVED" | "REQUIRES_CHANGES" | "REJECTED",`);
  lines.push(`  "verified_claims": [{ "claim": "...", "source_url": "...", "confidence": 0.95 }],`);
  lines.push(`  "incorrect_claims": [{ "claim": "...", "reason": "...", "suggested_fix": "..." }],`);
  lines.push(`  "unsourced_claims": [{ "claim": "...", "action": "remove" | "find_source" }],`);
  lines.push(`  "plagiarism_warnings": [{ "excerpt": "...", "source_url": "...", "similarity": 0.85 }],`);
  lines.push(`  "seo_audit": {`);
  lines.push(`    "primary_keyword_in_h1": true,`);
  lines.push(`    "primary_keyword_in_first_100_words": true,`);
  lines.push(`    "primary_keyword_density": 1.2,`);
  lines.push(`    "secondary_keywords_present": ["..."],`);
  lines.push(`    "secondary_keywords_missing": ["..."],`);
  lines.push(`    "meta_title_length": 58,`);
  lines.push(`    "meta_description_length": 155,`);
  lines.push(`    "url_slug": "...",`);
  lines.push(`    "internal_links_count": 3,`);
  lines.push(`    "external_authoritative_links_count": 5,`);
  lines.push(`    "featured_snippet_ready": true,`);
  lines.push(`    "issues": []`);
  lines.push(`  },`);
  lines.push(`  "geo_audit": {`);
  lines.push(`    "atomic_claims_ratio": 0.85,`);
  lines.push(`    "sourced_claims_ratio": 0.92,`);
  lines.push(`    "definitions_for_technical_terms": true,`);
  lines.push(`    "faq_section_present": true,`);
  lines.push(`    "entities_mentioned": ["..."],`);
  lines.push(`    "citable_structures_count": 12,`);
  lines.push(`    "ambiguity_warnings": [],`);
  lines.push(`    "issues": []`);
  lines.push(`  },`);
  lines.push(`  "style_review": { "matches_rules": [], "violations": [] },`);
  lines.push(`  "recommendations": [{ "issue": "...", "suggested_text": "..." }],`);
  lines.push(`  "seo_score": 87,`);
  lines.push(`  "geo_score": 91,`);
  lines.push(`  "overall_score": 89,`);
  lines.push(`  "iteration": ${mode === 'review' ? 0 : 1}`);
  if (mode === 'rewrite') {
    lines.push(`  ,`);
    lines.push(`  "revised_content": "...markdown o texto reescrito completo..."`);
  }
  lines.push(`}`);
  lines.push('```');
  lines.push('');
  lines.push(`**Solo JSON al final. Envuelve el JSON en un bloque marcado con triple backtick "json" para que el parser lo encuentre. Todo lo demás de tu respuesta (razonamiento, resultados de búsqueda) es opcional.**`);
  lines.push('');
  lines.push(`## ARTÍCULO A REVISAR`);
  lines.push('');
  lines.push('---');
  const content = mode === 'rewrite' && article.revised_content
    ? article.revised_content
    : article.draft_content ?? '';
  lines.push(content);
  lines.push('---');

  if (mode === 'rewrite' && previousVerdict) {
    lines.push('');
    lines.push(`## VEREDICTO PREVIO (úsalo como punto de partida)`);
    lines.push('```json');
    lines.push(JSON.stringify({
      status: previousVerdict.status,
      incorrect_claims: previousVerdict.incorrect_claims,
      unsourced_claims: previousVerdict.unsourced_claims,
      plagiarism_warnings: previousVerdict.plagiarism_warnings ?? [],
    }, null, 2));
    lines.push('```');
  }

  return lines.join('\n');
}

/** Extract JSON verdict from Claude's text response (handles ```json fences). */
function parseVerdict(text: string): EditorVerdict | null {
  // Try fenced block first
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const candidate = fenced?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as EditorVerdict;
  } catch {
    return null;
  }
}

/** Count search calls + extract any revised_content. */
function analyzeContentBlocks(content: any[]): { webSearches: number; text: string; revised?: string } {
  let webSearches = 0;
  const textParts: string[] = [];

  for (const block of content ?? []) {
    if (block.type === 'server_tool_use' && block.name === 'web_search') webSearches++;
    if (block.type === 'text') textParts.push(block.text);
  }

  const fullText = textParts.join('\n');
  const verdict = parseVerdict(fullText);
  return {
    webSearches,
    text: fullText,
    revised: verdict && (verdict as any).revised_content,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function runEditor(
  article: Article,
  profile: PublicationProfile,
  mode: EditorMode,
  previousVerdict: EditorVerdict | null = null,
): Promise<EditorResult> {
  const t0 = Date.now();
  let webSearches = 0;

  if (!ANTHROPIC_API_KEY) {
    return { success: false, error: 'Missing ANTHROPIC_API_KEY', cost_usd: 0, web_searches: 0, latency_ms: 0 };
  }

  const content = mode === 'rewrite' && article.revised_content
    ? article.revised_content
    : article.draft_content;
  if (!content || content.length < 50) {
    return {
      success: false, error: `No content to review (${content?.length ?? 0} chars)`,
      cost_usd: 0, web_searches: 0, latency_ms: Date.now() - t0,
    };
  }

  // Cost cap check
  if ((article.cost_usd ?? 0) >= 2.0) {
    return {
      success: false,
      error: `Cost cap exceeded (article already at $${article.cost_usd.toFixed(2)})`,
      cost_usd: 0, web_searches: 0, latency_ms: Date.now() - t0,
    };
  }

  // Load whitelist for domain filtering
  const whitelist = await getSourcesWhitelist(article.client_id);
  const maxSearches = mode === 'review' ? REVIEW_MAX_SEARCHES : REWRITE_MAX_SEARCHES;

  const webSearchTool: any = {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: maxSearches,
  };
  // If we have a whitelist AND enough domains to contrast (>=5), restrict
  if (whitelist && whitelist.domains.length >= 5) {
    webSearchTool.allowed_domains = whitelist.domains.slice(0, 50);
  }

  const instructions = buildEditorInstructions(article, profile, mode, previousVerdict);

  // 550s timeout (within Vercel 600s maxDuration)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 550_000);

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
        max_tokens: 16384,
        thinking: { type: 'adaptive' },
        tools: [webSearchTool],
        system: [
          { type: 'text', text: CHIEF_EDITOR_SYSTEM, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          { role: 'user', content: [{ type: 'text', text: instructions }] },
        ],
      }),
    });

    const latency_ms = Date.now() - t0;

    if (!res.ok) {
      const errText = await res.text();
      const result: EditorResult = {
        success: false,
        error: `Anthropic API ${res.status}: ${errText.slice(0, 500)}`,
        cost_usd: 0, web_searches: 0, latency_ms,
      };
      logGeneration({
        article_id: article.id, client_id: article.client_id,
        agent: mode === 'review' ? 'editor' : 'editor_rewrite', model: MODEL,
        success: false, latency_ms, error_message: result.error,
      }).catch(() => {});
      return result;
    }

    const data = await res.json();
    const analysis = analyzeContentBlocks(data.content ?? []);
    webSearches = data.usage?.server_tool_use?.web_search_requests ?? analysis.webSearches;

    const cost_usd = estimateCost(data.usage, webSearches);
    const verdict = parseVerdict(analysis.text);

    logGeneration({
      article_id: article.id, client_id: article.client_id,
      agent: mode === 'review' ? 'editor' : 'editor_rewrite', model: MODEL,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      web_searches: webSearches, cost_usd, latency_ms,
      success: !!verdict,
      error_message: verdict ? undefined : 'Failed to parse JSON verdict from response',
    }).catch(() => {});

    if (!verdict) {
      return {
        success: false,
        error: `Could not parse JSON verdict from editor response (${analysis.text.length} chars of text)`,
        cost_usd, tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
        web_searches: webSearches, latency_ms, stop_reason: data.stop_reason,
      };
    }

    // Normalize (in case the model drops fields)
    verdict.verified_claims ??= [];
    verdict.incorrect_claims ??= [];
    verdict.unsourced_claims ??= [];
    verdict.plagiarism_warnings ??= [];
    verdict.recommendations ??= [];
    verdict.style_review ??= { matches_rules: [], violations: [] };
    verdict.iteration = mode === 'review' ? 0 : 1;

    return {
      success: true,
      verdict,
      revised_content: mode === 'rewrite' ? (analysis.revised ?? (verdict as any).revised_content) : undefined,
      cost_usd,
      tokens_in: data.usage?.input_tokens,
      tokens_out: data.usage?.output_tokens,
      web_searches: webSearches,
      latency_ms,
      stop_reason: data.stop_reason,
    };
  } catch (err: any) {
    const latency_ms = Date.now() - t0;
    const isAbort = err?.name === 'AbortError';
    const msg = isAbort ? `Editor timed out after ${latency_ms}ms` : String(err?.message ?? err);
    logGeneration({
      article_id: article.id, client_id: article.client_id,
      agent: mode === 'review' ? 'editor' : 'editor_rewrite', model: MODEL,
      success: false, latency_ms, error_message: msg,
    }).catch(() => {});
    return { success: false, error: msg, cost_usd: 0, web_searches: 0, latency_ms };
  } finally {
    clearTimeout(timer);
  }
}
