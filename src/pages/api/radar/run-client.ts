export const prerender = false;

import type { APIRoute } from 'astro';
import { getClientById, IS_DEMO } from '../../../lib/db';
import { runRadarForClient } from '../../../lib/radar/run-radar';

const CRON_SECRET = import.meta.env?.CRON_SECRET || process.env.CRON_SECRET;

/**
 * POST /api/radar/run-client
 *
 * Runs Radar for a single client. Called by the fan-out dispatcher (/api/radar/run).
 * Each call runs in its own Vercel Function with its own 300s timeout.
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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { clientId } = await request.json();
    if (!clientId) {
      return new Response(JSON.stringify({ error: 'clientId required' }), { status: 400 });
    }

    const client = await getClientById(clientId);
    console.log(`[radar:single] Starting for ${client.name} (${client.domain})...`);

    const result = await runRadarForClient({
      id: client.id,
      name: client.name,
      domain: client.domain,
    });

    console.log(`[radar:single] ${client.domain}: ${result.success ? 'OK' : 'FAIL'} in ${result.durationMs}ms`);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
};
