export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabase } from '../../../../lib/db';
import { KPI_DEFINITIONS } from '../../../../lib/business-impact/definitions';

/**
 * POST /api/dashboard/business-impact/save-kpis
 *
 * Saves the user's custom KPI selection to client_onboarding.business_impact_kpis.
 * Body: { kpi_keys: string[] }  (array of 3-6 KpiKey strings in display order)
 *
 * To reset to profile defaults, pass an empty array.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if ((user.clientRole ?? user.role) !== 'admin' && user.role !== 'superuser') {
    return json({ error: 'Admin role required' }, 403);
  }

  let body: { kpi_keys: string[] };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!Array.isArray(body.kpi_keys)) return json({ error: 'kpi_keys array required' }, 400);
  if (body.kpi_keys.length > 6) return json({ error: 'Maximum 6 KPIs allowed' }, 400);

  // Validate every key is a known KpiKey
  for (const k of body.kpi_keys) {
    if (!(k in KPI_DEFINITIONS)) return json({ error: `Unknown KPI key: ${k}` }, 400);
  }

  const sb = getSupabase();
  const { error } = await sb
    .from('client_onboarding')
    .update({ business_impact_kpis: body.kpi_keys })
    .eq('client_id', client.id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, saved: body.kpi_keys });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
