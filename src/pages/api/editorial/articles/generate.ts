export const prerender = false;

import type { APIRoute } from 'astro';
import {
  clientHasEditorial, createArticle, getPublicationProfile,
} from '../../../../lib/editorial/db';
import { canGenerate, incrementGenerated, decrementGenerated } from '../../../../lib/editorial/quota';
import type { ArticleBrief } from '../../../../lib/editorial/types';

/**
 * POST /api/editorial/articles/generate
 *
 * Creates a new article in status='queued_writer' and increments the monthly
 * quota. Returns { article_id, next: 'write' } so the client can call the
 * writer endpoint.
 *
 * Body: ArticleBrief (topic, profile_id, language, optional primary_keyword,
 *                     secondary_keywords, funnel_stage, brief, source_action_id,
 *                     tracking_keyword)
 * Auth: authenticated admin of the client
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;

  if (!client?.id || !user?.id) {
    return json({ error: 'Authentication required' }, 401);
  }

  // Must be admin
  if ((user.clientRole ?? user.role) !== 'admin' && user.role !== 'superuser') {
    return json({ error: 'Admin role required' }, 403);
  }

  // Feature flag
  if (!(await clientHasEditorial(client.id))) {
    return json({
      error: 'Editorial AI is not enabled for this client',
      upsell: 'signals',
    }, 403);
  }

  // Parse body
  let body: ArticleBrief;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.topic?.trim()) return json({ error: 'topic is required' }, 400);
  if (!body.profile_id)    return json({ error: 'profile_id is required' }, 400);
  if (!body.language || !['es', 'en'].includes(body.language)) {
    return json({ error: 'language must be "es" or "en"' }, 400);
  }

  // Validate profile belongs to client
  const profile = await getPublicationProfile(body.profile_id);
  if (!profile || profile.client_id !== client.id) {
    return json({ error: 'Invalid profile_id for this client' }, 400);
  }

  // Quota check
  const quota = await canGenerate(client.id);
  if (!quota.allowed) {
    return json({
      error: 'Monthly generation quota reached',
      reason: quota.reason,
      quota,
    }, 429);
  }

  // Increment quota BEFORE creating article — if creation fails we decrement.
  await incrementGenerated(client.id);

  try {
    const article = await createArticle({
      client_id: client.id,
      profile_id: body.profile_id,
      topic: body.topic.trim(),
      brief: body.brief?.trim(),
      language: body.language,
      primary_keyword: body.primary_keyword?.trim(),
      secondary_keywords: body.secondary_keywords,
      funnel_stage: body.funnel_stage,
      source_action_id: body.source_action_id,
      tracking_keyword: body.tracking_keyword,
      status: 'queued_writer',
    });

    return json({
      article_id: article.id,
      tracking_id: article.tracking_id,
      status: article.status,
      next: 'write',
      next_endpoint: `/api/editorial/articles/${article.id}/write`,
      quota_remaining: {
        generated: quota.remaining.generated - 1,
        approved: quota.remaining.approved,
      },
    });
  } catch (err: any) {
    // Roll back quota increment on failure
    await decrementGenerated(client.id).catch(() => {});
    return json({ error: err?.message ?? 'Article creation failed' }, 500);
  }
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
