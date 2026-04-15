export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabase } from '../../../../lib/db';

/**
 * POST /api/dashboard/business-impact/manual-input
 *
 * Save or update a manual monthly business input (leads, sales_count,
 * revenue, activations, bookings). Admin only.
 *
 * Body: { month: 'YYYY-MM-01', metric_key: 'leads' | ..., value: number, notes?: string }
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if ((user.clientRole ?? user.role) !== 'admin' && user.role !== 'superuser') {
    return json({ error: 'Admin role required' }, 403);
  }

  let body: { month: string; metric_key: string; value: number; notes?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const VALID_KEYS = ['leads', 'sales_count', 'revenue', 'activations', 'bookings'];
  if (!VALID_KEYS.includes(body.metric_key)) {
    return json({ error: `metric_key must be one of ${VALID_KEYS.join(', ')}` }, 400);
  }
  if (!body.month || !/^\d{4}-\d{2}-\d{2}$/.test(body.month)) {
    return json({ error: 'month must be YYYY-MM-DD' }, 400);
  }
  if (typeof body.value !== 'number' || body.value < 0) {
    return json({ error: 'value must be a non-negative number' }, 400);
  }

  // Normalize month to first day
  const normalizedMonth = body.month.slice(0, 7) + '-01';

  const sb = getSupabase();
  const { data, error } = await sb.from('manual_business_inputs').upsert({
    client_id: client.id,
    month: normalizedMonth,
    metric_key: body.metric_key,
    value: body.value,
    notes: body.notes,
    created_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,month,metric_key' }).select().single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, input: data });
};

export const GET: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  if (!client?.id) return json({ error: 'Authentication required' }, 401);

  const url = new URL(request.url);
  const limit = Math.min(24, Number(url.searchParams.get('limit') ?? 12));

  const sb = getSupabase();
  const { data, error } = await sb
    .from('manual_business_inputs')
    .select('*')
    .eq('client_id', client.id)
    .order('month', { ascending: false })
    .limit(limit);
  if (error) return json({ error: error.message }, 500);
  return json({ inputs: data ?? [] });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
