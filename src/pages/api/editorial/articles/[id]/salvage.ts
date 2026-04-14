export const prerender = false;

import type { APIRoute } from 'astro';
import {
  getArticle, getPublicationProfile, transitionStatus, updateArticle,
} from '../../../../../lib/editorial/db';
import { runSalvage } from '../../../../../lib/editorial/agents/salvage';

/**
 * POST /api/editorial/articles/:id/salvage
 *
 *   queued_salvage → processing_salvage → approved_salvaged    (>=60% survives)
 *                                        → needs_human          (<60% survives)
 *                                        → error_salvage        (failure)
 *
 * Last-resort: strips unverifiable claims, keeps only verified content.
 * No web_search. Pure LLM cleanup.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  const articleId = params.id as string;

  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if (!articleId) return json({ error: 'Missing article id' }, 400);

  const locked = await transitionStatus(
    articleId, 'queued_salvage', 'processing_salvage',
    { salvage_started_at: new Date().toISOString() },
  );
  if (!locked) {
    const current = await getArticle(articleId);
    if (!current) return json({ error: 'Article not found' }, 404);
    if (current.client_id !== client.id) return json({ error: 'Forbidden' }, 403);
    return json({ error: 'Not in queued_salvage status', current_status: current.status }, 409);
  }
  if (locked.client_id !== client.id) {
    await transitionStatus(articleId, 'processing_salvage', 'queued_salvage');
    return json({ error: 'Forbidden' }, 403);
  }

  if (!locked.editor_verdict) {
    await updateArticle(articleId, {
      status: 'error_salvage',
      error_message: 'No editor_verdict to salvage from',
      salvage_finished_at: new Date().toISOString(),
    });
    return json({ error: 'Missing prior verdict' }, 500);
  }

  const profile = await getPublicationProfile(locked.profile_id);
  if (!profile) {
    await updateArticle(articleId, {
      status: 'error_salvage',
      error_message: 'Publication profile missing',
      salvage_finished_at: new Date().toISOString(),
    });
    return json({ error: 'Publication profile missing' }, 500);
  }

  const result = await runSalvage(locked, profile, locked.editor_verdict);

  if (!result.success || !result.final_content) {
    await updateArticle(articleId, {
      status: 'error_salvage',
      error_message: result.error ?? 'Salvage returned no content',
      cost_usd: (locked.cost_usd ?? 0) + (result.cost_usd ?? 0),
      salvage_finished_at: new Date().toISOString(),
    });
    return json({
      error: 'Salvage failed',
      detail: result.error,
      latency_ms: result.latency_ms,
    }, 502);
  }

  const nextStatus = result.needs_human ? 'needs_human' : 'approved_salvaged';

  const updated = await updateArticle(articleId, {
    revised_content: result.final_content,
    salvage_metadata: result.salvage_metadata,
    status: nextStatus,
    cost_usd: (locked.cost_usd ?? 0) + (result.cost_usd ?? 0),
    salvage_finished_at: new Date().toISOString(),
    iteration_count: 3,
  });

  return json({
    article_id: updated.id,
    status: updated.status,
    salvage_metadata: result.salvage_metadata,
    needs_human: result.needs_human,
    cost_usd: updated.cost_usd,
    latency_ms: result.latency_ms,
    next: null,  // terminal state — user decides from UI
  });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
