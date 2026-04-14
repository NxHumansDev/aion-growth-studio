export const prerender = false;

import type { APIRoute } from 'astro';
import { extractVoice } from '../../../../lib/editorial/agents/voice-extractor';
import { clientHasEditorial } from '../../../../lib/editorial/db';
import type { EditorialLanguage } from '../../../../lib/editorial/types';

/**
 * POST /api/editorial/setup/extract-voice
 *
 * Body: { samples: string[], language: 'es' | 'en' }
 * Response: VoiceExtractionResult proposed for user confirmation.
 *
 * Admin-only. Does NOT persist anything — the user reviews and then
 * /api/editorial/setup/complete saves the final values.
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

  let body: { samples: string[]; language: EditorialLanguage };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!Array.isArray(body.samples) || body.samples.length === 0) {
    return json({ error: 'samples (array) required' }, 400);
  }
  if (!['es', 'en'].includes(body.language)) {
    return json({ error: 'language must be "es" or "en"' }, 400);
  }

  // Validate samples length
  const validSamples = body.samples.map(s => (s ?? '').trim()).filter(s => s.length >= 100);
  if (validSamples.length === 0) {
    return json({
      error: 'Each sample must be at least 100 characters. Paste real texts written by the brand.',
    }, 400);
  }

  const { success, result, error, cost_usd, latency_ms } = await extractVoice(validSamples, body.language);
  if (!success || !result) {
    return json({ error: error ?? 'Extraction failed', cost_usd, latency_ms }, 502);
  }

  return json({
    ...result,
    meta: { samples_count: validSamples.length, cost_usd, latency_ms },
  });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
