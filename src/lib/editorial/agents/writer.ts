/**
 * Editorial AI — Writer agent (Claude Opus 4.6 with adaptive thinking).
 *
 * Pure generation function. Takes the full context bundle, calls Claude
 * once, returns the draft markdown/text.
 *
 * Cost tracking and logging happens here. Caller is responsible for
 * managing article status transitions.
 */

import {
  WRITER_SYSTEM, buildWriterContext,
} from '../prompts';
import {
  getBrandVoice, listStyleRules, listReferenceMedia,
  getPublicationProfile, logGeneration,
} from '../db';
import type {
  Article, BriefResolutionResult, PublicationProfile,
} from '../types';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-opus-4-6';

// Opus 4.6 pricing (per M tokens) as of knowledge cutoff
const COST_IN_PER_M  = 5.0;
const COST_OUT_PER_M = 25.0;
const COST_CACHE_READ_PER_M = 0.5;  // 10% of input when reading cache

function estimateCost(usage: any): number {
  if (!usage) return 0;
  const inputTokens  = usage.input_tokens  ?? 0;
  const cachedTokens = usage.cache_read_input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const regularInput = Math.max(0, inputTokens - cachedTokens);
  return (
    (regularInput  * COST_IN_PER_M  / 1_000_000) +
    (cachedTokens  * COST_CACHE_READ_PER_M / 1_000_000) +
    (outputTokens  * COST_OUT_PER_M / 1_000_000)
  );
}

export interface WriterResult {
  success: boolean;
  content?: string;
  error?: string;
  cost_usd: number;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms: number;
  stop_reason?: string;
}

/**
 * Generate an article draft. Caller provides the article row (with brief fields
 * populated). Loads all context from the DB internally.
 */
export async function runWriter(
  article: Article,
  brief: BriefResolutionResult,
): Promise<WriterResult> {
  const t0 = Date.now();

  if (!ANTHROPIC_API_KEY) {
    return {
      success: false, error: 'Missing ANTHROPIC_API_KEY',
      cost_usd: 0, latency_ms: 0,
    };
  }

  // Load all context in parallel
  const [brandVoice, styleRules, referenceMedia, profile] = await Promise.all([
    getBrandVoice(article.client_id),
    listStyleRules(article.client_id, { language: article.language }),
    listReferenceMedia(article.client_id, article.language),
    getPublicationProfile(article.profile_id),
  ]);

  if (!profile) {
    return {
      success: false, error: `Publication profile ${article.profile_id} not found`,
      cost_usd: 0, latency_ms: Date.now() - t0,
    };
  }

  const contextBlock = buildWriterContext({
    brandVoice,
    styleRules,
    referenceMedia,
    profile,
    brief,
    language: article.language,
  });

  // ── Call Claude Opus 4.6 ─────────────────────────────────────────────
  const controller = new AbortController();
  // 270s timeout (Vercel Fn max is 300s). Opus with adaptive thinking
  // generating 1500-2500 words typically completes in 120-200s.
  const timer = setTimeout(() => controller.abort(), 270_000);

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
        // 8192 is plenty for a ~2500-word article with metadata block.
        // Bumped from typical 4096 because multi-source citations inflate token count.
        max_tokens: 8192,
        // Adaptive thinking — Claude decides when it needs to reason.
        thinking: { type: 'adaptive' },
        // Cache breakpoints: system prompt is stable across all writer calls
        // for all clients; the context block is stable per-client for that month.
        system: [
          {
            type: 'text',
            text: WRITER_SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: contextBlock,
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
        ],
      }),
    });

    const latency_ms = Date.now() - t0;

    if (!res.ok) {
      const errText = await res.text();
      const result: WriterResult = {
        success: false,
        error: `Anthropic API ${res.status}: ${errText.slice(0, 500)}`,
        cost_usd: 0, latency_ms,
      };
      logGeneration({
        article_id: article.id, client_id: article.client_id,
        agent: 'writer', model: MODEL,
        success: false, latency_ms,
        error_message: result.error,
      }).catch(() => {});
      return result;
    }

    const data = await res.json();
    const content = (data.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    const cost_usd = estimateCost(data.usage);
    const tokens_in = data.usage?.input_tokens;
    const tokens_out = data.usage?.output_tokens;
    const stop_reason = data.stop_reason;

    logGeneration({
      article_id: article.id, client_id: article.client_id,
      agent: 'writer', model: MODEL,
      tokens_in, tokens_out, cost_usd, latency_ms,
      success: true,
    }).catch(() => {});

    if (!content || content.length < 100) {
      return {
        success: false,
        error: `Empty or too-short draft (${content.length} chars). stop_reason=${stop_reason}`,
        cost_usd, tokens_in, tokens_out, latency_ms, stop_reason,
      };
    }

    return {
      success: true, content,
      cost_usd, tokens_in, tokens_out, latency_ms, stop_reason,
    };
  } catch (err: any) {
    const latency_ms = Date.now() - t0;
    const isAbort = err?.name === 'AbortError';
    const errorMessage = isAbort
      ? `Writer timed out after ${latency_ms}ms`
      : String(err?.message ?? err);
    logGeneration({
      article_id: article.id, client_id: article.client_id,
      agent: 'writer', model: MODEL,
      success: false, latency_ms,
      error_message: errorMessage,
    }).catch(() => {});
    return {
      success: false, error: errorMessage,
      cost_usd: 0, latency_ms,
    };
  } finally {
    clearTimeout(timer);
  }
}
