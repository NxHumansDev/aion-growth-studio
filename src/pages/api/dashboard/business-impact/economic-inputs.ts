export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabase } from '../../../../lib/db';

/**
 * POST /api/dashboard/business-impact/economic-inputs
 *
 * Saves avg_deal_value, close_rate, and monthly_ad_spend on client_onboarding.
 * These power the derived KPIs (CPA, CPL, ROAS, estimated_pipeline).
 *
 * Body: { avg_deal_value?, close_rate?, monthly_ad_spend? }   (all optional — only provided are updated)
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if ((user.clientRole ?? user.role) !== 'admin' && user.role !== 'superuser') {
    return json({ error: 'Admin role required' }, 403);
  }

  let body: { avg_deal_value?: number; close_rate?: number; monthly_ad_spend?: number };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const patch: Record<string, number | null> = {};
  if ('avg_deal_value' in body) {
    if (body.avg_deal_value === null) patch.avg_deal_value = null;
    else if (typeof body.avg_deal_value === 'number' && body.avg_deal_value >= 0) patch.avg_deal_value = body.avg_deal_value;
    else return json({ error: 'avg_deal_value must be a non-negative number or null' }, 400);
  }
  if ('close_rate' in body) {
    if (body.close_rate === null) patch.close_rate = null;
    else if (typeof body.close_rate === 'number' && body.close_rate >= 0 && body.close_rate <= 100) patch.close_rate = body.close_rate;
    else return json({ error: 'close_rate must be between 0 and 100 or null' }, 400);
  }
  if ('monthly_ad_spend' in body) {
    if (body.monthly_ad_spend === null) patch.monthly_ad_spend = null;
    else if (typeof body.monthly_ad_spend === 'number' && body.monthly_ad_spend >= 0) patch.monthly_ad_spend = body.monthly_ad_spend;
    else return json({ error: 'monthly_ad_spend must be a non-negative number or null' }, 400);
  }

  if (Object.keys(patch).length === 0) return json({ error: 'No fields to update' }, 400);

  const sb = getSupabase();
  const { error } = await sb.from('client_onboarding').update(patch).eq('client_id', client.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, updated: patch });
};

export const GET: APIRoute = async ({ locals }) => {
  const client = (locals as any).client;
  if (!client?.id) return json({ error: 'Authentication required' }, 401);

  const sb = getSupabase();
  const { data, error } = await sb
    .from('client_onboarding')
    .select('avg_deal_value, close_rate, monthly_ad_spend')
    .eq('client_id', client.id)
    .single();
  if (error) return json({ error: error.message }, 500);
  return json({
    avg_deal_value: (data as any)?.avg_deal_value ?? null,
    close_rate: (data as any)?.close_rate ?? null,
    monthly_ad_spend: (data as any)?.monthly_ad_spend ?? null,
  });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
