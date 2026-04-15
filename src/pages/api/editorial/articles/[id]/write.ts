export const prerender = false;

import type { APIRoute } from 'astro';
import {
  getArticle, getPublicationProfile, transitionStatus, updateArticle,
} from '../../../../../lib/editorial/db';
import { runWriter } from '../../../../../lib/editorial/agents/writer';
import { resolveBrief } from '../../../../../lib/editorial/brief';
import { suggestInternalLinks } from '../../../../../lib/editorial/internal-links';
import type { ArticleBrief } from '../../../../../lib/editorial/types';

/**
 * POST /api/editorial/articles/:id/write
 *
 * Runs the writer agent on an article in status='queued_writer'.
 * Uses atomic status lock to prevent double-execution.
 *
 *   queued_writer → processing_writer → queued_editor  (on success)
 *                                     → error_writer   (on failure)
 *
 * Response includes the draft and the next step to call.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  const articleId = params.id as string;

  if (!client?.id || !user?.id) {
    return json({ error: 'Authentication required' }, 401);
  }

  if (!articleId) return json({ error: 'Missing article id' }, 400);

  // Atomically lock the article into processing_writer state.
  // If it's not in queued_writer, this returns null.
  const lockedArticle = await transitionStatus(
    articleId, 'queued_writer', 'processing_writer',
    { writer_started_at: new Date().toISOString() },
  );

  if (!lockedArticle) {
    // Check actual state for a useful error
    const current = await getArticle(articleId);
    if (!current) return json({ error: 'Article not found' }, 404);
    if (current.client_id !== client.id) return json({ error: 'Forbidden' }, 403);
    return json({
      error: 'Article is not in queued_writer status',
      current_status: current.status,
    }, 409);
  }

  // Verify tenant ownership
  if (lockedArticle.client_id !== client.id) {
    // Rollback the status (this shouldn't normally happen because of RLS,
    // but we defend anyway).
    await transitionStatus(articleId, 'processing_writer', 'queued_writer');
    return json({ error: 'Forbidden' }, 403);
  }

  // Load the publication profile for brief resolution
  const profile = await getPublicationProfile(lockedArticle.profile_id);
  if (!profile) {
    await updateArticle(articleId, {
      status: 'error_writer',
      error_message: `Publication profile ${lockedArticle.profile_id} not found`,
      writer_finished_at: new Date().toISOString(),
    });
    return json({ error: 'Publication profile missing' }, 500);
  }

  // Resolve the full brief
  const briefInput: ArticleBrief = {
    topic: lockedArticle.topic,
    brief: lockedArticle.brief,
    profile_id: lockedArticle.profile_id,
    language: lockedArticle.language,
    primary_keyword: lockedArticle.primary_keyword,
    secondary_keywords: lockedArticle.secondary_keywords,
    funnel_stage: lockedArticle.funnel_stage,
  };
  const resolvedBrief = await resolveBrief(client.id, briefInput, profile);

  // Internal link suggestions from the client's existing published corpus.
  // Non-fatal: if embeddings or DB fail, we just skip the suggestions.
  try {
    const suggestions = await suggestInternalLinks(
      client.id,
      lockedArticle.topic,
      resolvedBrief.resolved_primary_keyword,
      articleId,
      4,
    );
    if (suggestions.length > 0) {
      (resolvedBrief as any).internal_link_suggestions = suggestions;
    }
  } catch { /* non-fatal */ }

  // Run the writer
  const result = await runWriter(lockedArticle, resolvedBrief);

  if (!result.success || !result.content) {
    await updateArticle(articleId, {
      status: 'error_writer',
      error_message: result.error ?? 'Writer returned empty content',
      cost_usd: (lockedArticle.cost_usd ?? 0) + (result.cost_usd ?? 0),
      writer_finished_at: new Date().toISOString(),
    });
    return json({
      error: 'Writer failed',
      detail: result.error,
      latency_ms: result.latency_ms,
    }, 502);
  }

  // Persist draft + resolved brief + advance status
  const updated = await updateArticle(articleId, {
    draft_content: result.content,
    primary_keyword: resolvedBrief.resolved_primary_keyword,
    secondary_keywords: resolvedBrief.resolved_secondary_keywords,
    funnel_stage: resolvedBrief.funnel_stage,
    target_length: resolvedBrief.target_length,
    entities_to_cite: resolvedBrief.entities_to_cite,
    competitor_articles: resolvedBrief.competitor_articles,
    status: 'queued_editor',
    cost_usd: (lockedArticle.cost_usd ?? 0) + (result.cost_usd ?? 0),
    writer_finished_at: new Date().toISOString(),
  });

  return json({
    article_id: updated.id,
    status: updated.status,
    draft_length: result.content.length,
    cost_usd: updated.cost_usd,
    latency_ms: result.latency_ms,
    next: 'review',
    next_endpoint: `/api/editorial/articles/${updated.id}/review`,
    warnings: resolvedBrief.warnings,
  });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
