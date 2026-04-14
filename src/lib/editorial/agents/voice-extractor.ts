/**
 * Editorial AI — voice extractor (Haiku 4.5).
 *
 * Takes 2-3 text samples written BY the company (their real LinkedIn, blog,
 * newsletter) and extracts:
 *   - tone_descriptors
 *   - structural_patterns
 *   - vocabulary_fingerprint
 *   - initial style rules (with suggested priority)
 *
 * The output is proposed to the user in the wizard — they confirm/edit
 * before saving to brand_voice and editorial_style_rules.
 *
 * Called once per language during setup.
 */

import { logGeneration } from '../db';
import type { EditorialLanguage } from '../types';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5';

export interface VoiceExtractionResult {
  tone_descriptors: string[];
  structural_patterns: string[];
  vocabulary_fingerprint: string[];
  proposed_rules: Array<{
    rule_type: 'tone' | 'structure' | 'vocabulary_avoid' | 'vocabulary_prefer' | 'formula' | 'length' | 'formatting';
    content: string;
    priority: 1 | 2 | 3 | 4 | 5;
    rationale: string;   // why the extractor suggests this
  }>;
  avg_sentence_length?: number;
  uses_first_person?: boolean;
  uses_questions?: boolean;
  has_emojis?: boolean;
}

const SYSTEM = `Eres un analista de estilo editorial. Tu trabajo es leer 2-3 muestras de texto escritas por UNA MISMA MARCA y extraer patrones consistentes de voz y estilo.

Reglas:
- Solo saca patrones que se repiten en AL MENOS 2 de las muestras. Un patrón que solo aparece 1 vez no es voz, es azar.
- tone_descriptors: 3-5 adjetivos concretos (evita genéricos como "claro" o "profesional")
- structural_patterns: cómo estructuran los textos ("abren con anécdota personal", "cierran con pregunta al lector", "usan listas numeradas")
- vocabulary_fingerprint: 8-15 palabras o expresiones que se repiten y que son distintivas (no palabras comunes)
- proposed_rules: 8-12 reglas accionables que un redactor podría seguir. Cada una con priority (1-5):
  · 5 = inquebrantable ("NUNCA usar emojis en títulos")
  · 4 = preferencia fuerte ("Frases cortas, media <25 palabras")
  · 3 = preferencia ("Cerrar con llamada a la reflexión")
  · 2 = sugerencia
  · 1 = opcional
- Incluye también métricas descriptivas: avg_sentence_length, uses_first_person, uses_questions, has_emojis

Output: JSON válido con la estructura VoiceExtractionResult. Sin markdown, sin comentarios.`;

export async function extractVoice(
  samples: string[],
  language: EditorialLanguage,
): Promise<{ success: boolean; result?: VoiceExtractionResult; error?: string; cost_usd: number; latency_ms: number }> {
  const t0 = Date.now();

  if (!ANTHROPIC_API_KEY) {
    return { success: false, error: 'Missing ANTHROPIC_API_KEY', cost_usd: 0, latency_ms: 0 };
  }
  if (!samples || samples.length < 1) {
    return { success: false, error: 'At least 1 sample required', cost_usd: 0, latency_ms: 0 };
  }

  // Trim huge samples to keep costs predictable (voice is detectable in 500-1500 chars easily)
  const trimmed = samples.map(s => s.slice(0, 3000));
  const userBlock = `Idioma de las muestras: ${language === 'es' ? 'Español' : 'English'}

${trimmed.map((s, i) => `### Muestra ${i + 1}\n${s}`).join('\n\n')}

Analiza estas muestras y extrae el patrón de voz de la marca. Devuelve el JSON.`;

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
      const errText = await res.text();
      return { success: false, error: `Anthropic ${res.status}: ${errText.slice(0, 300)}`, cost_usd: 0, latency_ms };
    }

    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');

    const cost_usd = estimateHaikuCost(data.usage);

    // Extract JSON — the model sometimes wraps in markdown despite instructions
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: 'No JSON in response', cost_usd, latency_ms };
    }

    let parsed: VoiceExtractionResult;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e: any) {
      return { success: false, error: `JSON parse failed: ${e.message}`, cost_usd, latency_ms };
    }

    // Sanity defaults
    parsed.tone_descriptors ??= [];
    parsed.structural_patterns ??= [];
    parsed.vocabulary_fingerprint ??= [];
    parsed.proposed_rules ??= [];

    logGeneration({
      agent: 'voice_extractor', model: MODEL,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      cost_usd, latency_ms, success: true,
    }).catch(() => {});

    return { success: true, result: parsed, cost_usd, latency_ms };
  } catch (err: any) {
    return {
      success: false,
      error: err?.name === 'AbortError' ? 'Voice extraction timed out' : String(err?.message ?? err),
      cost_usd: 0, latency_ms: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

function estimateHaikuCost(usage: any): number {
  if (!usage) return 0;
  // Haiku 4.5: $1/M input, $5/M output
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  return (inputTokens * 1.0 / 1_000_000) + (outputTokens * 5.0 / 1_000_000);
}
