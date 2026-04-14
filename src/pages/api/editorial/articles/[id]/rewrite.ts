export const prerender = false;

import type { APIRoute } from 'astro';
import {
  getArticle, getPublicationProfile, transitionStatus, updateArticle,
} from '../../../../../lib/editorial/db';
import { runEditor } from '../../../../../lib/editorial/agents/chief-editor';

/**
 * POST /api/editorial/articles/:id/rewrite
 *
 *   queued_rewrite → processing_rewrite → ready_for_review     (APPROVED)
 *                                       → queued_salvage       (still REQUIRES_CHANGES or REJECTED)
 *                                       → error_rewrite        (failure)
 *
 * Runs chief editor in rewrite mode: uses web_search to fill gaps, replaces
 * incorrect claims with verified data, strips unsourced, emits new verdict
 * plus revised_content.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  const articleId = params.id as string;

  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if (!articleId) return json({ error: 'Missing article id' }, 400);

  const locked = await transitionStatus(
    articleId, 'queued_rewrite', 'processing_rewrite',
    { rewrite_started_at: new Date().toISOString() },
  );
  if (!locked) {
    const current = await getArticle(articleId);
    if (!current) return json({ error: 'Article not found' }, 404);
    if (current.client_id !== client.id) return json({ error: 'Forbidden' }, 403);
    return json({ error: 'Not in queued_rewrite status', current_status: current.status }, 409);
  }
  if (locked.client_id !== client.id) {
    await transitionStatus(articleId, 'processing_rewrite', 'queued_rewrite');
    return json({ error: 'Forbidden' }, 403);
  }

  if (!locked.editor_verdict) {
    await updateArticle(articleId, {
      status: 'error_rewrite',
      error_message: 'No prior editor_verdict to rewrite from',
      rewrite_finished_at: new Date().toISOString(),
    });
    return json({ error: 'Missing prior verdict' }, 500);
  }

  const profile = await getPublicationProfile(locked.profile_id);
  if (!profile) {
    await updateArticle(articleId, {
      status: 'error_rewrite',
      error_message: 'Publication profile missing',
      rewrite_finished_at: new Date().toISOString(),
    });
    return json({ error: 'Publication profile missing' }, 500);
  }

  const result = await runEditor(locked, profile, 'rewrite', locked.editor_verdict);

  if (!result.success || !result.verdict) {
    await updateArticle(articleId, {
      status: 'error_rewrite',
      error_message: result.error ?? 'Editor returned no verdict on rewrite',
      cost_usd: (locked.cost_usd ?? 0) + (result.cost_usd ?? 0),
      rewrite_finished_at: new Date().toISOString(),
    });
    return json({
      error: 'Editor rewrite failed',
      detail: result.error,
      latency_ms: result.latency_ms,
      web_searches: result.web_searches,
    }, 502);
  }

  // After rewrite: APPROVED → ready; anything else → salvage (iter 2)
  const nextStatus = result.verdict.status === 'APPROVED' ? 'ready_for_review' : 'queued_salvage';

  const updated = await updateArticle(articleId, {
    editor_verdict: result.verdict,
    revised_content: result.revised_content,
    status: nextStatus,
    cost_usd: (locked.cost_usd ?? 0) + (result.cost_usd ?? 0),
    rewrite_finished_at: new Date().toISOString(),
    iteration_count: 2,
  });

  return json({
    article_id: updated.id,
    status: updated.status,
    verdict: {
      status: result.verdict.status,
      seo_score: result.verdict.seo_score,
      geo_score: result.verdict.geo_score,
      verified_count: result.verdict.verified_claims.length,
      incorrect_count: result.verdict.incorrect_claims.length,
      unsourced_count: result.verdict.unsourced_claims.length,
    },
    revised_length: result.revised_content?.length ?? 0,
    cost_usd: updated.cost_usd,
    web_searches: result.web_searches,
    latency_ms: result.latency_ms,
    next: nextStatus === 'queued_salvage' ? 'salvage' : null,
    next_endpoint: nextStatus === 'queued_salvage'
      ? `/api/editorial/articles/${updated.id}/salvage`
      : null,
  });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
