export const prerender = false;

import type { APIRoute } from 'astro';
import {
  getArticle, getPublicationProfile, transitionStatus, updateArticle,
} from '../../../../../lib/editorial/db';
import { runEditor } from '../../../../../lib/editorial/agents/chief-editor';

/**
 * POST /api/editorial/articles/:id/review
 *
 *   queued_editor → processing_editor → ready_for_review         (APPROVED)
 *                                     → queued_rewrite           (REQUIRES_CHANGES)
 *                                     → queued_salvage           (REJECTED)
 *                                     → error_editor             (on failure)
 *
 * Runs chief editor in review mode (fact-check, SEO/GEO audit, plagiarism).
 * No content modification. Just emits verdict.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  const articleId = params.id as string;

  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if (!articleId) return json({ error: 'Missing article id' }, 400);

  const locked = await transitionStatus(
    articleId, 'queued_editor', 'processing_editor',
    { editor_started_at: new Date().toISOString() },
  );
  if (!locked) {
    const current = await getArticle(articleId);
    if (!current) return json({ error: 'Article not found' }, 404);
    if (current.client_id !== client.id) return json({ error: 'Forbidden' }, 403);
    return json({ error: 'Not in queued_editor status', current_status: current.status }, 409);
  }
  if (locked.client_id !== client.id) {
    await transitionStatus(articleId, 'processing_editor', 'queued_editor');
    return json({ error: 'Forbidden' }, 403);
  }

  const profile = await getPublicationProfile(locked.profile_id);
  if (!profile) {
    await updateArticle(articleId, {
      status: 'error_editor',
      error_message: 'Publication profile missing',
      editor_finished_at: new Date().toISOString(),
    });
    return json({ error: 'Publication profile missing' }, 500);
  }

  const result = await runEditor(locked, profile, 'review');

  if (!result.success || !result.verdict) {
    await updateArticle(articleId, {
      status: 'error_editor',
      error_message: result.error ?? 'Editor returned no verdict',
      cost_usd: (locked.cost_usd ?? 0) + (result.cost_usd ?? 0),
      editor_finished_at: new Date().toISOString(),
    });
    return json({
      error: 'Editor review failed',
      detail: result.error,
      latency_ms: result.latency_ms,
      web_searches: result.web_searches,
    }, 502);
  }

  // Determine next status from verdict
  const nextStatus =
    result.verdict.status === 'APPROVED'          ? 'ready_for_review' :
    result.verdict.status === 'REQUIRES_CHANGES'  ? 'queued_rewrite'   :
    /* REJECTED */                                  'queued_salvage';

  const updated = await updateArticle(articleId, {
    editor_verdict: result.verdict,
    status: nextStatus,
    cost_usd: (locked.cost_usd ?? 0) + (result.cost_usd ?? 0),
    editor_finished_at: new Date().toISOString(),
    iteration_count: 1,
  });

  const nextEndpoint =
    nextStatus === 'queued_rewrite' ? `/api/editorial/articles/${updated.id}/rewrite` :
    nextStatus === 'queued_salvage' ? `/api/editorial/articles/${updated.id}/salvage` :
    null;

  return json({
    article_id: updated.id,
    status: updated.status,
    verdict: {
      status: result.verdict.status,
      seo_score: result.verdict.seo_score,
      geo_score: result.verdict.geo_score,
      overall_score: result.verdict.overall_score,
      verified_count: result.verdict.verified_claims.length,
      incorrect_count: result.verdict.incorrect_claims.length,
      unsourced_count: result.verdict.unsourced_claims.length,
      plagiarism_count: result.verdict.plagiarism_warnings?.length ?? 0,
    },
    cost_usd: updated.cost_usd,
    web_searches: result.web_searches,
    latency_ms: result.latency_ms,
    next: nextEndpoint ? (nextStatus === 'queued_rewrite' ? 'rewrite' : 'salvage') : null,
    next_endpoint: nextEndpoint,
  });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
