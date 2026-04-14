export const prerender = false;

import type { APIRoute } from 'astro';
import { getArticle, updateArticle, addRejectedTopic } from '../../../../../lib/editorial/db';
import { embed } from '../../../../../lib/editorial/embeddings';

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

  // ── Loop 1: rejected topics with embedding ─────────────────────────────
  // When the user marks the topic as not relevant, persist an embedding so
  // future Growth Agent recommendations can filter semantically similar
  // topics (cosine similarity > 0.85 with any rejected topic → suppress).
  let learning_signal: 'topic_filter' | 'voice_nudge' | 'editor_alert' | null = null;
  if (reason_category === 'topic_not_relevant') {
    const topicText = `${current.topic}${current.brief ? ' — ' + current.brief : ''}`;
    const emb = await embed(topicText);
    if (emb.success && emb.embedding) {
      await addRejectedTopic({
        client_id: client.id,
        topic_text: topicText,
        topic_embedding: emb.embedding,
        reason: body.reason_text,
        article_id: articleId,
      }).catch(() => { /* fire-and-forget — non-fatal */ });
      learning_signal = 'topic_filter';
    }
  } else if (reason_category === 'tone_not_my_voice') {
    // Loop 3 trigger: the UI will read this signal and offer to add more
    // brand_voice samples by routing the user back to /editorial/setup
    // Step 2 with prefilled context. (Implementation pending UI wiring.)
    learning_signal = 'voice_nudge';
  } else if (reason_category === 'factual_errors') {
    // The editor passed something that shouldn't have. Future iterations
    // could decrement editor confidence and increase searches per claim.
    learning_signal = 'editor_alert';
  }

  return json({
    ok: true,
    article_id: articleId,
    status: 'rejected',
    learning_signal,
  });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
