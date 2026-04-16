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
// Vercel Cron sends GET — shared handler for both methods.
async function handler({ request }: { request: Request }): Promise<Response> {
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

    // Determine base URL for internal calls.
    //
    // Vercel's internal deployment URL (aion-growth-studio-XXX.vercel.app)
    // has Deployment Protection enabled by default, which rejects internal
    // fetches with 401 before our auth code even runs. Using the public
    // production domain routes through Vercel's edge to the current
    // production deployment with no protection challenge.
    const host = request.headers.get('host') || 'localhost:4321';
    const isVercelDeploymentUrl = host.endsWith('.vercel.app');
    const publicSiteUrl = import.meta.env?.PUBLIC_SITE_URL
      || process.env.PUBLIC_SITE_URL
      || 'https://aiongrowth.studio';
    const baseUrl = host.includes('localhost')
      ? `http://${host}`
      : isVercelDeploymentUrl
        ? publicSiteUrl.replace(/\/$/, '')
        : `https://${host}`;
    const targetUrl = `${baseUrl}/api/radar/run-client`;

    console.log(`[radar:cron] Internal fetch target: ${targetUrl}`);

    // Parallel fan-out WITH await. Each run-client call runs the full
    // pipeline in its own 300s Function invocation, then returns.
    // Dispatcher waits for all to settle via Promise.allSettled.
    //
    // waitUntil is intentionally NOT used here — instead of backgrounding
    // the fetches and hoping Vercel keeps the function alive, we await
    // them directly. Each run-client responds when its pipeline completes.
    // With 7 clients in parallel and ~200-280s per pipeline, dispatcher
    // fits within 300s limit (slowest client determines total).
    const results = await Promise.allSettled(
      clients.map(async (client) => {
        const t0 = Date.now();
        try {
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${CRON_SECRET}`,
            },
            body: JSON.stringify({ clientId: client.id }),
          });
          const durMs = Date.now() - t0;
          const ok = res.status >= 200 && res.status < 300;
          console.log(`[radar:cron] ${client.name} → ${res.status} in ${durMs}ms`);
          return { client: client.name, status: res.status, ok, durMs };
        } catch (err) {
          const durMs = Date.now() - t0;
          console.error(`[radar:cron] ${client.name} → ERROR in ${durMs}ms: ${(err as Error).message}`);
          return { client: client.name, status: 0, ok: false, durMs, error: (err as Error).message };
        }
      }),
    );

    const summary = results.map(r =>
      r.status === 'fulfilled'
        ? r.value
        : { client: '?', status: 0, ok: false, error: String(r.reason) },
    );
    const okCount = summary.filter(s => s.ok).length;

    console.log(`[radar:cron] Completed ${okCount}/${clients.length} clients`);

    return new Response(JSON.stringify({
      ok: true,
      completed: okCount,
      total: clients.length,
      results: summary,
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
}

export const GET: APIRoute = async (ctx) => handler(ctx);
export const POST: APIRoute = async (ctx) => handler(ctx);
