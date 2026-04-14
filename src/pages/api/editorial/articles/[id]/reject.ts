export const prerender = false;

import type { APIRoute } from 'astro';
import { getArticle, updateArticle } from '../../../../../lib/editorial/db';

/**
 * POST /api/editorial/articles/:id/reject
 *
 * User decision: discard the article. Collects a reason_category so
 * downstream learning loops (P7-S6) can act accordingly.
 *
 * Body: { reason_category, reason_text?, modifications? }
 *   reason_category: 'tone_not_my_voice' | 'factual_errors' |
 *                    'topic_not_relevant' | 'structure' | 'other'
 *
 * Does NOT increment approved_count (rejection is not consumed).
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

  let body: any = {};
  try { body = await request.json(); } catch { /* empty body is allowed */ }

  const validCategories = [
    'tone_not_my_voice', 'factual_errors', 'topic_not_relevant',
    'structure', 'other',
  ];
  const reason_category = validCategories.includes(body.reason_category) ? body.reason_category : 'other';

  await updateArticle(articleId, {
    status: 'rejected',
    publication_decision: {
      decision: 'discard',
      reason_category,
      reason_text: body.reason_text,
    },
  });

  // NOTE: P7-S6 will consume this decision to feed the learning loops
  // (topic_not_relevant → rejected_topics with embedding, tone_not_my_voice
  // → nudge to re-extract voice, etc.).

  return json({ ok: true, article_id: articleId, status: 'rejected' });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
