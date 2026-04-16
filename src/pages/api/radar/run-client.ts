export const prerender = false;

import type { APIRoute } from 'astro';
import { getClientById, IS_DEMO } from '../../../lib/db';
import { runRadarForClient } from '../../../lib/radar/run-radar';

const CRON_SECRET = import.meta.env?.CRON_SECRET || process.env.CRON_SECRET;

/**
 * POST /api/radar/run-client
 *
 * Runs the FULL Radar pipeline for a single client in one invocation.
 * Previously this was split into phases chained via fire-and-forget,
 * but that pattern dropped requests on Vercel Serverless (even with
 * Fluid Compute + waitUntil — for reasons we couldn't pin down). The
 * dispatcher now awaits each run-client fetch directly, and this
 * endpoint runs the whole pipeline in one shot.
 *
 * Trade-off: if the pipeline exceeds maxDuration=300s, the invocation
 * times out and the client's snapshot is skipped. The next cron cycle
 * will retry. Accepted for simplicity and reliability.
 *
 * Body: { clientId: string }
 * Auth: CRON_SECRET
 */
export const POST: APIRoute = async ({ request }) => {
  if (IS_DEMO) {
    return new Response(JSON.stringify({ error: 'Demo mode' }), { status: 400 });
  }

  const authHeader = request.headers.get('authorization');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!authHeader?.includes(CRON_SECRET || '') && !isVercelCron && CRON_SECRET) {
    console.warn('[radar:single] Unauthorized request — authHeader missing or wrong');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { clientId } = body;

    if (!clientId) {
      return new Response(JSON.stringify({ error: 'clientId required' }), { status: 400 });
    }

    const client = await getClientById(clientId);
    console.log(`[radar:single] Starting full pipeline for ${client.name} (${client.domain})`);

    const result = await runRadarForClient(
      { id: client.id, name: client.name, domain: client.domain },
    );

    console.log(`[radar:single] ${client.domain}: ${result.success ? 'OK' : 'FAIL'} in ${result.durationMs}ms`);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[radar:single] Unhandled error:', (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
};
