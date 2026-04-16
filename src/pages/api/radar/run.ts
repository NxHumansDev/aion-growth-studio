export const prerender = false;

import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
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

    // Fan-out: fire each run-client asynchronously. Each runs the full
    // pipeline (~200-300s) in its own 300s Function invocation. The
    // dispatcher must NOT await them — with 300s shared budget, a single
    // slow client would timeout the dispatcher and lose all logs.
    //
    // Each fetch is wrapped in waitUntil() so Vercel keeps the dispatcher
    // Function alive until the fetches settle — otherwise the TCP requests
    // can be dropped when we return the Response.
    //
    // We previously tried awaited Promise.allSettled; it worked in theory
    // but the slowest client kept pushing dispatcher past 300s, killing
    // the log stream mid-run.
    const dispatched: string[] = [];
    for (const client of clients) {
      const fetchPromise = fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({ clientId: client.id }),
      })
        .then((res) => {
          console.log(`[radar:cron] ${client.name} → ${res.status}`);
          return res;
        })
        .catch((err) => {
          console.error(`[radar:cron] ${client.name} → ERROR: ${err.message}`);
        });
      waitUntil(fetchPromise);
      dispatched.push(client.name);
      console.log(`[radar:cron] Dispatched: ${client.name}`);
    }

    console.log(`[radar:cron] Dispatched ${dispatched.length}/${clients.length} (pipelines run in background, check run-client logs for results)`);

    return new Response(JSON.stringify({
      ok: true,
      dispatched: dispatched.length,
      total: clients.length,
      message: `Dispatched ${dispatched.length} run-client invocations in parallel. Each runs ~200-300s; check /api/radar/run-client logs for results.`,
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
