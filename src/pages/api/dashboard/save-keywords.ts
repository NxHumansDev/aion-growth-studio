export const prerender = false;

import type { APIRoute } from 'astro';
import { saveClientOnboarding, getClientOnboarding, logInteraction } from '../../../lib/db';
import type { PriorityKeyword, KeywordStrategy } from '../../../lib/db';

/**
 * POST /api/dashboard/save-keywords
 * Persists priority_keywords + keyword_strategy into client_onboarding.
 * Body: { priority_keywords?: PriorityKeyword[], keyword_strategy?: KeywordStrategy }
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;

  if (!client?.id) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const priorityKeywords = body.priority_keywords as PriorityKeyword[] | undefined;
    const keywordStrategy = body.keyword_strategy as KeywordStrategy | undefined;

    // If no onboarding row exists, seed a minimal one so keyword config
    // is never blocked by onboarding state. The client can complete the
    // rest of onboarding later.
    const existing = (await getClientOnboarding(client.id)) || { client_id: client.id };

    await saveClientOnboarding({
      ...existing,
      client_id: client.id,
      priority_keywords: Array.isArray(priorityKeywords) ? priorityKeywords : existing.priority_keywords,
      keyword_strategy: keywordStrategy
        ? { ...(existing.keyword_strategy || {}), ...keywordStrategy, updatedAt: new Date().toISOString() }
        : existing.keyword_strategy,
    });

    logInteraction(client.id, 'priority_keywords_saved', {
      count: priorityKeywords?.length ?? 0,
      hasStrategy: !!keywordStrategy,
    }, user?.id).catch(() => {});

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[save-keywords] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
