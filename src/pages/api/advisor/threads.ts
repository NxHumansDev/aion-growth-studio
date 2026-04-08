export const prerender = false;

import type { APIRoute } from 'astro';
import { getThreads, getThreadMessages } from '../../../lib/advisor/db';

/**
 * GET /api/advisor/threads         → list all threads
 * GET /api/advisor/threads?id=xxx  → get messages for a specific thread
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  if (!client?.id) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const threadId = url.searchParams.get('id');

  if (threadId) {
    const messages = await getThreadMessages(threadId);
    return new Response(JSON.stringify({ messages }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const threads = await getThreads(client.id);
  return new Response(JSON.stringify({ threads }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
