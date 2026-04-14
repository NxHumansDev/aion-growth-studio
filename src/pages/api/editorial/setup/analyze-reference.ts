export const prerender = false;

import type { APIRoute } from 'astro';
import { analyzeReference } from '../../../../lib/editorial/agents/reference-analyzer';
import { clientHasEditorial } from '../../../../lib/editorial/db';

/**
 * POST /api/editorial/setup/analyze-reference
 *
 * Body: { url: string }
 * Response: ReferenceAnalysisResult proposed for user confirmation.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;

  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if ((user.clientRole ?? user.role) !== 'admin' && user.role !== 'superuser') {
    return json({ error: 'Admin role required' }, 403);
  }
  if (!(await clientHasEditorial(client.id))) {
    return json({ error: 'Editorial AI not enabled for this client', upsell: 'signals' }, 403);
  }

  let body: { url: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.url?.trim()) return json({ error: 'url required' }, 400);

  const { success, result, error, cost_usd, latency_ms } = await analyzeReference(body.url.trim());
  if (!success || !result) {
    return json({ error: error ?? 'Analysis failed', cost_usd, latency_ms }, 502);
  }

  return json({ ...result, meta: { cost_usd, latency_ms } });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
