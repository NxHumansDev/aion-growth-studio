export const prerender = false;

import type { APIRoute } from 'astro';
import { getArticle, resetStuckArticles } from '../../../../../lib/editorial/db';

/**
 * GET /api/editorial/articles/:id/status
 *
 * Lightweight polling endpoint for the UI. Returns just enough state to
 * decide what to render and what to call next.
 *
 * As a side effect, if the request detects a stuck processing_* state
 * older than 5 minutes, it calls the stuck-job reset RPC so the next
 * poll will find the article back in queued_* and the UI can resume.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const client = (locals as any).client;
  const articleId = params.id as string;

  if (!client?.id) return json({ error: 'Authentication required' }, 401);
  if (!articleId) return json({ error: 'Missing article id' }, 400);

  let article = await getArticle(articleId);
  if (!article) return json({ error: 'Article not found' }, 404);
  if (article.client_id !== client.id) return json({ error: 'Forbidden' }, 403);

  // Opportunistic stuck-job detection: if this article is stuck in a
  // processing state for >5 min, unblock it (service-wide RPC — cheap).
  if (article.status.startsWith('processing_')) {
    const now = Date.now();
    const updated = new Date(article.updated_at).getTime();
    if (now - updated > 5 * 60 * 1000) {
      await resetStuckArticles().catch(() => {});
      // Re-read the article to pick up the reset status
      const refreshed = await getArticle(articleId);
      if (refreshed) article = refreshed;
    }
  }

  // Map status to next action the UI should take
  const queuedNext: Record<string, string | null> = {
    queued_writer:  `/api/editorial/articles/${articleId}/write`,
    queued_editor:  `/api/editorial/articles/${articleId}/review`,
    queued_rewrite: `/api/editorial/articles/${articleId}/rewrite`,
    queued_salvage: `/api/editorial/articles/${articleId}/salvage`,
  };

  const isTerminal = ['published', 'rejected', 'approved_salvaged', 'needs_human'].includes(article.status) ||
                     article.status.startsWith('error_');
  const isReady = article.status === 'ready_for_review';

  return json({
    article_id: article.id,
    status: article.status,
    iteration_count: article.iteration_count,
    cost_usd: article.cost_usd,
    draft_length: article.draft_content?.length ?? 0,
    has_verdict: !!article.editor_verdict,
    has_revised: !!article.revised_content,
    is_terminal: isTerminal,
    is_ready: isReady,
    can_poll_next: !!queuedNext[article.status],
    next_endpoint: queuedNext[article.status] ?? null,
    error_message: article.error_message,
    verdict_summary: article.editor_verdict ? {
      status: article.editor_verdict.status,
      seo_score: article.editor_verdict.seo_score,
      geo_score: article.editor_verdict.geo_score,
      overall_score: article.editor_verdict.overall_score,
    } : null,
    updated_at: article.updated_at,
  });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
