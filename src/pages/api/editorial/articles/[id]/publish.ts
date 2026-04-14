export const prerender = false;

import type { APIRoute } from 'astro';
import { getArticle, transitionStatus, updateArticle } from '../../../../../lib/editorial/db';
import { canApprove, incrementApproved } from '../../../../../lib/editorial/quota';

/**
 * POST /api/editorial/articles/:id/publish
 *
 * User decision: publish as-is OR publish with minor modifications.
 * Requires status 'ready_for_review' or 'approved_salvaged'.
 * Optionally accepts { published_url, final_user_content, modifications_learned }.
 *
 * On success: status → 'published', increments approved_count, writes
 * publication_decision, sets published_at/approved_by/approved_at.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  const articleId = params.id as string;

  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if ((user.clientRole ?? user.role) !== 'admin' && user.role !== 'superuser') {
    return json({ error: 'Admin role required' }, 403);
  }
  if (!articleId) return json({ error: 'Missing article id' }, 400);

  const current = await getArticle(articleId);
  if (!current) return json({ error: 'Article not found' }, 404);
  if (current.client_id !== client.id) return json({ error: 'Forbidden' }, 403);
  if (!['ready_for_review', 'approved_salvaged'].includes(current.status)) {
    return json({ error: `Cannot publish from status ${current.status}` }, 409);
  }

  // Quota check
  const quota = await canApprove(client.id);
  if (!quota.allowed) {
    return json({ error: 'Monthly approved quota exceeded', quota }, 429);
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* empty body is allowed */ }

  const publishedUrls = current.published_urls ?? [];
  if (body.published_url) {
    publishedUrls.push({
      platform: body.platform ?? 'unknown',
      url: body.published_url,
      published_at: new Date().toISOString(),
    });
  }

  await updateArticle(articleId, {
    status: 'published',
    final_user_content: body.final_user_content ?? current.revised_content ?? current.draft_content,
    published_url: body.published_url ?? current.published_url,
    published_urls: publishedUrls,
    published_at: new Date().toISOString(),
    approved_by: user.id,
    approved_at: new Date().toISOString(),
    publication_decision: {
      decision: body.final_user_content && body.final_user_content !== current.revised_content
        ? 'publish_with_changes'
        : 'publish_as_is',
      modifications_learned: body.modifications_learned ?? [],
    },
  });

  await incrementApproved(client.id).catch(() => {});

  return json({ ok: true, article_id: articleId, status: 'published' });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
