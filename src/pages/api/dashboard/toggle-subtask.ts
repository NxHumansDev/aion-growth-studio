export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabase, IS_DEMO } from '../../../lib/db';

/**
 * POST /api/dashboard/toggle-subtask
 *
 * Body: { actionId: string, subtaskId: string, done: boolean }
 *
 * Toggles the `done` flag on a single subtask inside action_plan.data.subtasks.
 * Updates done_at to the current timestamp when checking, or null when
 * unchecking. Returns the new list so the client can re-render progress.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  if (!client?.id) return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
  if (IS_DEMO) return new Response(JSON.stringify({ ok: true, demo: true }), { status: 200 });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }
  const { actionId, subtaskId, done } = body || {};
  if (!actionId || !subtaskId || typeof done !== 'boolean') {
    return new Response(JSON.stringify({ error: 'actionId, subtaskId, done required' }), { status: 400 });
  }

  const sb = getSupabase();

  // Load current action (scoped to client to prevent cross-client writes)
  const { data: action, error: loadErr } = await sb
    .from('action_plan')
    .select('id, data')
    .eq('id', actionId)
    .eq('client_id', client.id)
    .single();
  if (loadErr || !action) return new Response(JSON.stringify({ error: 'Action not found' }), { status: 404 });

  const data = (action.data || {}) as Record<string, any>;
  const subtasks = Array.isArray(data.subtasks) ? data.subtasks : [];
  const idx = subtasks.findIndex((s: any) => s && s.id === subtaskId);
  if (idx === -1) return new Response(JSON.stringify({ error: 'Subtask not found' }), { status: 404 });

  subtasks[idx] = {
    ...subtasks[idx],
    done,
    done_at: done ? new Date().toISOString() : null,
  };

  const totalSubtasks = subtasks.length;
  const doneSubtasks = subtasks.filter((s: any) => s?.done).length;
  const progressPct = totalSubtasks > 0 ? Math.round((doneSubtasks / totalSubtasks) * 100) : 0;

  const { error: updErr } = await sb
    .from('action_plan')
    .update({ data: { ...data, subtasks } })
    .eq('id', actionId);
  if (updErr) return new Response(JSON.stringify({ error: updErr.message }), { status: 500 });

  return new Response(JSON.stringify({
    ok: true,
    subtasks,
    progress: { done: doneSubtasks, total: totalSubtasks, pct: progressPct },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
