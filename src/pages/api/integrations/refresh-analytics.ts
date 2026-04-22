export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabase, getLatestSnapshot } from '../../../lib/db';
import { ingestAnalytics } from '../../../lib/analytics/ingest';

/**
 * POST /api/integrations/refresh-analytics
 *
 * Called right after connecting GA4/GSC to immediately fetch analytics
 * data and patch the current snapshot. Without this, the user wouldn't
 * see real GA4/GSC data until the next weekly Radar run.
 *
 * Body: { clientId: string, domain: string }
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any)?.client;
  const body = await request.json().catch(() => ({}));
  const clientId = body.clientId || client?.id;
  const domain = body.domain || client?.domain;

  if (!clientId || !domain) {
    return new Response(JSON.stringify({ error: 'Missing clientId or domain' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const analytics = await ingestAnalytics(clientId, domain);
    if (!analytics) {
      return new Response(JSON.stringify({ ok: false, reason: 'No analytics data available (integration missing or no property selected)' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Patch the latest snapshot's pipeline_output with fresh analytics
    const snapshot = await getLatestSnapshot(clientId);
    if (snapshot.id && snapshot.id !== 'empty') {
      const sb = getSupabase();
      const po = snapshot.pipeline_output || {};
      const updatedPo = { ...po, analytics };

      await sb.from('snapshots')
        .update({
          pipeline_output: updatedPo,
          updated_at: new Date().toISOString(),
        })
        .eq('id', snapshot.id);

      console.log(`[refresh-analytics] Patched snapshot ${snapshot.id} for ${domain} with GA4+GSC data`);
    }

    return new Response(JSON.stringify({
      ok: true,
      ga4: !!analytics.ga4,
      gsc: !!analytics.gsc,
      sessions: analytics.ga4?.sessions ?? null,
      clicks: analytics.gsc?.totalClicks ?? null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[refresh-analytics] Error:`, (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
