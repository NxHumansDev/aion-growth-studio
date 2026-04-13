export const prerender = false;

import type { APIRoute } from 'astro';

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = import.meta.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    || import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/** GET: list all workflows */
export const GET: APIRoute = async ({ locals }) => {
  const user = (locals as any).user;
  if (!user || user.role !== 'superuser') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const sb = getSupabase();
  const { data, error } = await sb.from('marketing_workflows').select('*').order('created_at');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify(data || []), { headers: { 'Content-Type': 'application/json' } });
};

/** POST: create or update a workflow */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = (locals as any).user;
  if (!user || user.role !== 'superuser') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();
  const { action, id, name, description, trigger_type, trigger_config, status, steps } = body;
  const sb = getSupabase();

  if (action === 'save') {
    if (id) {
      // Update
      const { error } = await sb.from('marketing_workflows').update({
        name, description, trigger_type, trigger_config, status, steps,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ ok: true, id }), { headers: { 'Content-Type': 'application/json' } });
    } else {
      // Create
      const { data, error } = await sb.from('marketing_workflows').insert({
        name: name || 'Nuevo workflow',
        description: description || '',
        trigger_type: trigger_type || 'manual',
        trigger_config: trigger_config || {},
        status: 'draft',
        steps: steps || [],
      }).select('id').single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ ok: true, id: data.id }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  if (action === 'delete') {
    const { error } = await sb.from('marketing_workflows').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (action === 'toggle-status') {
    const { data: current } = await sb.from('marketing_workflows').select('status').eq('id', id).single();
    const newStatus = current?.status === 'active' ? 'paused' : 'active';
    await sb.from('marketing_workflows').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id);
    return new Response(JSON.stringify({ ok: true, status: newStatus }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};
