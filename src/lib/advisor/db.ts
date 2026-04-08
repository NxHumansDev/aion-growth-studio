import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}

// ── Threads ──────────────────────────────────────────────────────

export async function createThread(clientId: string, title?: string): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.from('advisor_threads')
    .insert({ client_id: clientId, title: title || 'Nueva conversación' })
    .select('id').single();
  if (error || !data) throw new Error(`Failed to create thread: ${error?.message}`);
  return data.id;
}

export async function getThreads(clientId: string, limit = 20) {
  const sb = getSupabase();
  const { data } = await sb.from('advisor_threads')
    .select('id, title, last_message_at, created_at')
    .eq('client_id', clientId)
    .order('last_message_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function updateThreadTitle(threadId: string, title: string) {
  const sb = getSupabase();
  await sb.from('advisor_threads').update({ title }).eq('id', threadId);
}

export async function touchThread(threadId: string) {
  const sb = getSupabase();
  await sb.from('advisor_threads')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', threadId);
}

// ── Messages ─────────────────────────────────────────────────────

export interface AdvisorMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'advisor';
  content: string;
  tokens_input?: number;
  tokens_output?: number;
  actions_created?: string[];
  created_at: string;
}

export async function saveMessage(
  threadId: string,
  clientId: string,
  role: 'user' | 'advisor',
  content: string,
  opts?: { tokensInput?: number; tokensOutput?: number; actionsCreated?: string[] },
): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.from('advisor_messages').insert({
    thread_id: threadId,
    client_id: clientId,
    role,
    content,
    tokens_input: opts?.tokensInput || 0,
    tokens_output: opts?.tokensOutput || 0,
    actions_created: opts?.actionsCreated || [],
  }).select('id').single();
  if (error || !data) throw new Error(`Failed to save message: ${error?.message}`);
  return data.id;
}

export async function getThreadMessages(threadId: string): Promise<AdvisorMessage[]> {
  const sb = getSupabase();
  const { data } = await sb.from('advisor_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  return (data || []) as AdvisorMessage[];
}

/** Get all messages from last N days for a client (for context window) */
export async function getRecentMessages(clientId: string, days = 60): Promise<AdvisorMessage[]> {
  const sb = getSupabase();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await sb.from('advisor_messages')
    .select('*')
    .eq('client_id', clientId)
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  return (data || []) as AdvisorMessage[];
}

// ── Usage & Budget ───────────────────────────────────────────────

const DAILY_BUDGET_CENTS = 50;   // €0.50/day
const MONTHLY_BUDGET_CENTS = 500; // €5.00/month

export interface BudgetCheck {
  allowed: boolean;
  reason?: string;
  renewsAt?: string;
  dailyUsed: number;
  monthlyUsed: number;
}

export async function checkBudget(clientId: string): Promise<BudgetCheck> {
  const sb = getSupabase();
  const month = new Date().toISOString().slice(0, 7); // '2026-04'
  const today = new Date().toISOString().slice(0, 10); // '2026-04-08'

  const { data } = await sb.from('client_usage')
    .select('*')
    .eq('client_id', clientId)
    .eq('month', month)
    .single();

  let dailyUsed = data?.cost_cents_daily || 0;
  let monthlyUsed = data?.tokens_used || 0; // we'll repurpose tokens_used as cost_cents_monthly
  const lastReset = data?.last_daily_reset;

  // Reset daily counter if date changed
  if (lastReset && lastReset !== today) {
    dailyUsed = 0;
  }

  // Check monthly limit
  if (monthlyUsed >= MONTHLY_BUDGET_CENTS) {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
    nextMonth.setHours(0, 0, 0, 0);
    return {
      allowed: false,
      reason: `Has alcanzado el límite mensual de €${(MONTHLY_BUDGET_CENTS / 100).toFixed(2)}. Tu cupo se renueva el ${nextMonth.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}.`,
      renewsAt: nextMonth.toISOString(),
      dailyUsed,
      monthlyUsed,
    };
  }

  // Check daily limit
  if (dailyUsed >= DAILY_BUDGET_CENTS) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return {
      allowed: false,
      reason: `Has alcanzado el límite diario de €${(DAILY_BUDGET_CENTS / 100).toFixed(2)}. Tu cupo se renueva mañana a las ${tomorrow.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} del ${tomorrow.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}.`,
      renewsAt: tomorrow.toISOString(),
      dailyUsed,
      monthlyUsed,
    };
  }

  return { allowed: true, dailyUsed, monthlyUsed };
}

export async function recordUsage(clientId: string, costCents: number, messagesCount = 1) {
  const sb = getSupabase();
  const month = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  // Upsert: create or update monthly row
  const { data: existing } = await sb.from('client_usage')
    .select('*')
    .eq('client_id', clientId)
    .eq('month', month)
    .single();

  if (existing) {
    // Reset daily if date changed
    const dailyCost = existing.last_daily_reset === today
      ? (existing.cost_cents_daily || 0) + costCents
      : costCents;

    await sb.from('client_usage')
      .update({
        tokens_used: (existing.tokens_used || 0) + costCents, // repurposed as cost_cents_monthly
        messages_count: (existing.messages_count || 0) + messagesCount,
        cost_cents_daily: dailyCost,
        last_daily_reset: today,
      })
      .eq('client_id', clientId)
      .eq('month', month);
  } else {
    await sb.from('client_usage').insert({
      client_id: clientId,
      month,
      tokens_used: costCents, // repurposed as cost_cents_monthly
      messages_count: messagesCount,
      cost_cents_daily: costCents,
      last_daily_reset: today,
    });
  }
}

// ── Learnings ────────────────────────────────────────────────────

export async function saveLearnings(
  clientId: string,
  learnings: Array<{ type: string; content: string }>,
  source = 'advisor',
) {
  if (!learnings.length) return;
  const sb = getSupabase();
  await sb.from('client_learnings').insert(
    learnings.map(l => ({
      client_id: clientId,
      type: l.type,
      content: l.content,
      source,
    })),
  );
}

export async function getLearnings(clientId: string, limit = 50) {
  const sb = getSupabase();
  const { data } = await sb.from('client_learnings')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// ── Documents ────────────────────────────────────────────────────

export async function getDocuments(clientId: string) {
  const sb = getSupabase();
  const { data } = await sb.from('client_documents')
    .select('id, filename, extracted_text, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  return data || [];
}
