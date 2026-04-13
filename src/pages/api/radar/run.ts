export const prerender = false;

import type { APIRoute } from 'astro';
import { listAllClients, IS_DEMO } from '../../../lib/db';

const CRON_SECRET = import.meta.env?.CRON_SECRET || process.env.CRON_SECRET;

/**
 * POST /api/radar/run
 *
 * Fan-out dispatcher: triggered by Vercel Cron every Monday 3:00 UTC (5:00 AM Spain).
 * Instead of running all clients sequentially (timeout risk),
 * fires one /api/radar/run-client call per client in parallel.
 * Each runs in its own Vercel Function with its own 300s timeout.
 */
// Vercel Cron sends GET requests — accept both GET and POST.
export const GET: APIRoute = async (ctx) => handler(ctx);
export const POST: APIRoute = async (ctx) => handler(ctx);

const handler: APIRoute = async ({ request }) => {
  if (IS_DEMO) {
    return new Response(JSON.stringify({ error: 'Radar not available in demo mode' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = request.headers.get('authorization');
  const cronAuth = authHeader === `Bearer ${CRON_SECRET}`;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';

  if (!cronAuth && !isVercelCron && CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const clients = await listAllClients();

    if (clients.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'No clients to process', dispatched: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[radar:cron] Dispatching Radar for ${clients.length} clients...`);

    // Determine base URL for internal calls
    const host = request.headers.get('host') || 'localhost:4321';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;

    // Fan-out: fire one request per client (don't await — fire and forget)
    // Each /api/radar/run-client runs in its own Function with 300s timeout
    const dispatched: string[] = [];

    for (const client of clients) {
      try {
        fetch(`${baseUrl}/api/radar/run-client`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CRON_SECRET}`,
          },
          body: JSON.stringify({ clientId: client.id }),
        }).catch(err => {
          console.error(`[radar:cron] Dispatch failed for ${client.name}:`, err.message);
        });
        dispatched.push(client.name);
        console.log(`[radar:cron] Dispatched: ${client.name} (${client.domain})`);
      } catch (err) {
        console.error(`[radar:cron] Failed to dispatch ${client.name}:`, (err as Error).message);
      }
    }

    console.log(`[radar:cron] Dispatched ${dispatched.length}/${clients.length} clients`);

    return new Response(JSON.stringify({
      ok: true,
      dispatched: dispatched.length,
      total: clients.length,
      clients: dispatched,
      message: `Dispatched ${dispatched.length} Radar runs in parallel`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[radar:cron] Error:', (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
