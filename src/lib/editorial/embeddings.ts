/**
 * Editorial AI — embeddings utility (OpenAI text-embedding-3-small).
 *
 * Used by:
 *   - rejected_topics (loop 1) — store embedding of topics the user rejected
 *     so future Growth Agent recommendations can filter similar topics.
 *   - style_rules conflict detection — compare new vs existing rules of the
 *     same rule_type to flag potential contradictions.
 *
 * Model: text-embedding-3-small (1536 dims, $0.00002/1K tokens, ~$0.02/M).
 * One topic = ~10 tokens = $0.0000002. Effectively free.
 */

const OPENAI_API_KEY = import.meta.env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const MODEL = 'text-embedding-3-small';
const DIMS = 1536;

export interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  error?: string;
  cost_usd: number;
}

/** Compute a single embedding. Returns null on failure. */
export async function embed(text: string): Promise<EmbeddingResult> {
  if (!OPENAI_API_KEY) return { success: false, error: 'Missing OPENAI_API_KEY', cost_usd: 0 };
  if (!text || text.trim().length === 0) return { success: false, error: 'Empty text', cost_usd: 0 };

  const trimmed = text.trim().slice(0, 8000);  // input limit safety
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, input: trimmed }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `OpenAI ${res.status}: ${err.slice(0, 200)}`, cost_usd: 0 };
    }
    const data = await res.json();
    const vec: number[] = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== DIMS) {
      return { success: false, error: 'Bad embedding response', cost_usd: 0 };
    }
    const tokens = data.usage?.total_tokens ?? Math.ceil(trimmed.length / 4);
    const cost_usd = tokens * 0.02 / 1_000_000;
    return { success: true, embedding: vec, cost_usd };
  } catch (err: any) {
    return {
      success: false,
      error: err?.name === 'AbortError' ? 'Embedding timeout' : String(err?.message ?? err),
      cost_usd: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Cosine similarity (in [-1, 1], higher = more similar). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; ma += a[i] ** 2; mb += b[i] ** 2; }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  return denom === 0 ? 0 : dot / denom;
}
