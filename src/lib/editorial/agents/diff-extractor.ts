/**
 * Editorial AI — diff extractor (Haiku 4.5).
 *
 * Compares the editor's output (revised_content) with the user's final
 * version (final_user_content) and extracts generalizable style rules
 * that explain the user's edits.
 *
 * The extractor classifies each change into a category and proposes a
 * rule that, if added to style_rules, would prevent the same edit on
 * future generations. The user reviews and approves which to keep.
 *
 * Filters out one-off corrections (typos, single name changes) — only
 * rules that look like a recurring pattern.
 */

import { logGeneration } from '../db';
import type { StyleRuleType } from '../types';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5';

export interface ProposedRule {
  rule_type: StyleRuleType;
  content: string;            // the rule, written as a directive
  priority: 1 | 2 | 3 | 4 | 5;
  rationale: string;          // why the extractor inferred this
  example_change: string;     // the concrete edit that triggered it
}

export interface DiffResult {
  success: boolean;
  proposed_rules: ProposedRule[];
  changes_count: number;
  significant: boolean;       // true if there are 1+ generalizable rules
  error?: string;
  cost_usd: number;
  latency_ms: number;
}

const SYSTEM = `Eres un analista de estilo editorial. Te paso DOS versiones de un artículo: la que produjo el editor (REVISED) y la final que el usuario publicó (FINAL).

Tu trabajo: identificar qué cambios sistemáticos hizo el usuario y proponer reglas de estilo generalizables que un redactor podría seguir para evitar esos cambios en el futuro.

REGLAS:
1. SOLO propones reglas si el cambio es generalizable. Cambios puntuales (typos, un nombre concreto, una cifra que solo aplica a este artículo) NO son reglas.
2. Cada regla debe ser ACCIONABLE — el redactor debe poder aplicarla sin ambigüedad.
3. Clasifica cada regla en uno de: tone, structure, vocabulary_avoid, vocabulary_prefer, formula, length, formatting, structural.
4. Asigna priority:
   - 5 = inquebrantable (el usuario eliminó/cambió MÚLTIPLES instancias del mismo patrón)
   - 4 = preferencia fuerte (cambio repetido al menos 2 veces)
   - 3 = preferencia (cambio puntual pero accionable)
5. Si NO encuentras patrones generalizables (solo correcciones puntuales), devuelves proposed_rules: [] y significant: false.

EJEMPLOS:

Cambio: usuario eliminó 5 emojis del artículo.
→ Regla: { rule_type: "formatting", content: "No usar emojis en el cuerpo del artículo", priority: 5 }

Cambio: usuario reemplazó "brutal" por "significativo" 3 veces.
→ Regla: { rule_type: "vocabulary_avoid", content: "Evitar adjetivos superlativos como 'brutal', 'increíble', 'espectacular' — usar 'significativo' o equivalentes neutros", priority: 4 }

Cambio: usuario acortó el primer párrafo de 85 a 42 palabras.
→ Regla: { rule_type: "length", content: "Primer párrafo <50 palabras — apertura concisa", priority: 3 }

Cambio: usuario cambió "Andbank" por "ANDBANK" en una sola instancia.
→ NO es regla (cambio puntual).

OUTPUT JSON:
{
  "proposed_rules": [
    { "rule_type": "...", "content": "...", "priority": 5, "rationale": "El usuario hizo X en N instancias", "example_change": "antes: ... → después: ..." }
  ],
  "changes_count": 12,
  "significant": true
}

Solo JSON, sin markdown, sin texto adicional.`;

export async function extractRulesFromDiff(args: {
  client_id?: string;
  article_id?: string;
  revised_content: string;
  final_user_content: string;
}): Promise<DiffResult> {
  const t0 = Date.now();

  if (!ANTHROPIC_API_KEY) {
    return { success: false, proposed_rules: [], changes_count: 0, significant: false,
             error: 'Missing ANTHROPIC_API_KEY', cost_usd: 0, latency_ms: 0 };
  }

  // Skip if texts are identical or differ trivially
  if (args.revised_content === args.final_user_content) {
    return { success: true, proposed_rules: [], changes_count: 0, significant: false, cost_usd: 0, latency_ms: 0 };
  }
  const lenDelta = Math.abs(args.revised_content.length - args.final_user_content.length);
  if (lenDelta < 20 && args.revised_content.length > 100) {
    // Practically identical — nothing to extract
    return { success: true, proposed_rules: [], changes_count: 0, significant: false, cost_usd: 0, latency_ms: 0 };
  }

  // Trim huge texts — Haiku can handle the full thing but cost adds up
  const revised = args.revised_content.slice(0, 12_000);
  const final = args.final_user_content.slice(0, 12_000);
  const userBlock = `### REVISED (versión del editor)\n${revised}\n\n### FINAL (versión publicada por el usuario)\n${final}\n\nAnaliza los cambios y devuelve el JSON.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

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
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: 'user', content: userBlock }],
      }),
    });

    const latency_ms = Date.now() - t0;
    if (!res.ok) {
      const err = await res.text();
      return { success: false, proposed_rules: [], changes_count: 0, significant: false,
               error: `Anthropic ${res.status}: ${err.slice(0, 300)}`, cost_usd: 0, latency_ms };
    }

    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const cost_usd = (data.usage?.input_tokens ?? 0) * 1.0 / 1_000_000 +
                     (data.usage?.output_tokens ?? 0) * 5.0 / 1_000_000;

    const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    const candidate = fenced?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0];
    if (!candidate) {
      return { success: false, proposed_rules: [], changes_count: 0, significant: false,
               error: 'No JSON in response', cost_usd, latency_ms };
    }

    let parsed: any;
    try { parsed = JSON.parse(candidate); }
    catch (e: any) {
      return { success: false, proposed_rules: [], changes_count: 0, significant: false,
               error: `JSON parse: ${e.message}`, cost_usd, latency_ms };
    }

    const validTypes: StyleRuleType[] = [
      'tone', 'structure', 'vocabulary_avoid', 'vocabulary_prefer',
      'formula', 'length', 'formatting', 'structural',
    ];
    const proposed_rules: ProposedRule[] = (Array.isArray(parsed.proposed_rules) ? parsed.proposed_rules : [])
      .filter((r: any) => r && validTypes.includes(r.rule_type) && typeof r.content === 'string' && r.content.trim().length > 5)
      .map((r: any): ProposedRule => ({
        rule_type: r.rule_type,
        content: String(r.content).trim(),
        priority: ([1, 2, 3, 4, 5].includes(r.priority) ? r.priority : 3) as 1 | 2 | 3 | 4 | 5,
        rationale: String(r.rationale ?? '').slice(0, 200),
        example_change: String(r.example_change ?? '').slice(0, 300),
      }))
      .slice(0, 8);  // cap to avoid overwhelming the user

    logGeneration({
      article_id: args.article_id, client_id: args.client_id,
      agent: 'diff_extractor', model: MODEL,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      cost_usd, latency_ms, success: true,
    }).catch(() => {});

    return {
      success: true,
      proposed_rules,
      changes_count: typeof parsed.changes_count === 'number' ? parsed.changes_count : proposed_rules.length,
      significant: proposed_rules.length > 0,
      cost_usd, latency_ms,
    };
  } catch (err: any) {
    const latency_ms = Date.now() - t0;
    return {
      success: false, proposed_rules: [], changes_count: 0, significant: false,
      error: err?.name === 'AbortError' ? 'Diff extraction timed out' : String(err?.message ?? err),
      cost_usd: 0, latency_ms,
    };
  } finally {
    clearTimeout(timer);
  }
}
