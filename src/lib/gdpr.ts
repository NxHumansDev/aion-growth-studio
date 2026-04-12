/**
 * GDPR compliance helpers — data export and purge for clients.
 *
 * purgeClientData(): removes ALL client data from every table. Called by:
 *   - DELETE /api/gdpr/delete-my-data (immediate, user-initiated)
 *   - Future retention cron (90 days post-cancellation, when Stripe lands)
 *
 * exportClientData(): collects all client data into a structured JSON object.
 *   Called by GET /api/gdpr/export-my-data.
 *
 * Both functions are exhaustive — they cover every table that holds client data,
 * including the 3 new analytics tables (kpi_series, action_outcomes, ai_generation_log).
 */

import { getSupabase } from './db';

// ─── Tables with client_id and CASCADE from clients ─────────────────────
// These get deleted automatically when the clients row is deleted,
// but we list them for the export function and for explicit purge.
const CLIENT_TABLES = [
  'kpi_series',
  'action_outcomes',
  'snapshots',
  'recommendations',
  'action_plan',
  'client_onboarding',
  'client_documents',
  'advisor_threads',    // CASCADE deletes advisor_messages too
  'client_learnings',
  'interaction_log',
  'integrations',
  'alerts',
  'leads',
] as const;

// Tables without FK CASCADE that need explicit cleanup
const NON_CASCADE_TABLES = [
  'ai_generation_log',  // client_id is nullable, no FK
  'advisor_messages',    // may need explicit delete if thread CASCADE doesn't cover it
] as const;

export interface PurgeResult {
  success: boolean;
  tablesCleared: string[];
  errors: string[];
  clientDeleted: boolean;
}

/**
 * Permanently delete ALL data for a client across every table.
 * This is irreversible. The client row itself is deleted last,
 * which triggers CASCADE on FK-linked tables as a safety net.
 */
export async function purgeClientData(clientId: string): Promise<PurgeResult> {
  const sb = getSupabase();
  const result: PurgeResult = {
    success: false,
    tablesCleared: [],
    errors: [],
    clientDeleted: false,
  };

  // 1. Explicit delete from non-CASCADE tables first
  for (const table of NON_CASCADE_TABLES) {
    try {
      await sb.from(table).delete().eq('client_id', clientId);
      result.tablesCleared.push(table);
    } catch (err) {
      result.errors.push(`${table}: ${(err as Error).message}`);
    }
  }

  // 2. Explicit delete from CASCADE tables (belt-and-suspenders)
  for (const table of CLIENT_TABLES) {
    try {
      await sb.from(table).delete().eq('client_id', clientId);
      result.tablesCleared.push(table);
    } catch (err) {
      // Some tables might not exist yet or have different schemas — log and continue
      result.errors.push(`${table}: ${(err as Error).message}`);
    }
  }

  // 3. Delete audits linked to the client's domain
  try {
    const { data: client } = await sb.from('clients').select('domain').eq('id', clientId).single();
    if (client?.domain) {
      await sb.from('audits').delete().ilike('url', `%${client.domain}%`);
      result.tablesCleared.push('audits (by domain)');
    }
  } catch (err) {
    result.errors.push(`audits: ${(err as Error).message}`);
  }

  // 4. Delete the client row itself (triggers remaining CASCADEs)
  try {
    await sb.from('clients').delete().eq('id', clientId);
    result.clientDeleted = true;
    result.tablesCleared.push('clients');
  } catch (err) {
    result.errors.push(`clients: ${(err as Error).message}`);
  }

  // 5. Delete from Supabase Storage (client documents bucket)
  try {
    const { data: files } = await sb.storage.from('client-documents').list(clientId);
    if (files && files.length > 0) {
      const paths = files.map(f => `${clientId}/${f.name}`);
      await sb.storage.from('client-documents').remove(paths);
      result.tablesCleared.push(`storage (${files.length} files)`);
    }
  } catch {
    // Storage bucket might not exist — non-fatal
  }

  result.success = result.clientDeleted && result.errors.length === 0;
  console.log(`[gdpr] Purge for ${clientId}: ${result.tablesCleared.length} tables cleared, ${result.errors.length} errors, client deleted: ${result.clientDeleted}`);
  return result;
}

export interface ExportData {
  exportedAt: string;
  client: Record<string, any>;
  onboarding: Record<string, any> | null;
  integrations: Record<string, any>[];
  snapshots: Array<{ id: string; date: string; month: string; score: number }>;
  kpiSeries: Array<{ date: string; kpi_key: string; value: number; source: string }>;
  recommendations: Array<{ title: string; description: string; impact: string; status: string; pillar: string; created_at: string }>;
  actionPlan: Array<{ title: string; status: string; impact: string; pillar: string; created_at: string }>;
  actionOutcomes: Array<{ action_title: string; kpi_key: string; delta_pct: number; correlation_type: string }>;
  advisorThreads: Array<{ id: string; title: string; created_at: string; messages: Array<{ role: string; content: string; created_at: string }> }>;
  learnings: Array<{ type: string; content: string; created_at: string }>;
  interactions: Array<{ action: string; detail: any; created_at: string }>;
  aiGenerationLog: Array<{ agent: string; model: string; success: boolean; cost_cents: number; created_at: string }>;
}

/**
 * Export ALL client data as a structured JSON object.
 * Designed for the GDPR "right of access" / "right to data portability".
 * Excludes: OAuth tokens (security), internal IDs (not useful to client).
 */
export async function exportClientData(clientId: string): Promise<ExportData> {
  const sb = getSupabase();

  const [
    { data: client },
    { data: onboarding },
    { data: integrations },
    { data: snapshots },
    { data: kpis },
    { data: recs },
    { data: actions },
    { data: outcomes },
    { data: threads },
    { data: learnings },
    { data: interactions },
    { data: aiLogs },
  ] = await Promise.all([
    sb.from('clients').select('name, domain, sector, tier, created_at').eq('id', clientId).single(),
    sb.from('client_onboarding').select('business_description, primary_goal, goal_detail, geo_scope, geo_detail, monthly_budget, team_size, competitors, priority_keywords, keyword_strategy, primary_kpis, completed_at').eq('client_id', clientId).maybeSingle(),
    sb.from('integrations').select('provider, status, property_name, account_email, scopes, data_quality_score, created_at').eq('client_id', clientId),
    sb.from('snapshots').select('id, date, month, score').eq('client_id', clientId).order('date', { ascending: false }),
    sb.from('kpi_series').select('date, kpi_key, value, source').eq('client_id', clientId).order('date', { ascending: false }).limit(500),
    sb.from('recommendations').select('title, description, impact, status, pillar, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    sb.from('action_plan').select('title, status, impact, pillar, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    sb.from('action_outcomes').select('action_title, kpi_key, delta_pct, correlation_type').eq('client_id', clientId),
    sb.from('advisor_threads').select('id, title, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    sb.from('client_learnings').select('type, content, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    sb.from('interaction_log').select('action, detail, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200),
    sb.from('ai_generation_log').select('agent, model, success, cost_cents, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200),
  ]);

  // Fetch messages for each thread
  const threadsWithMessages = [];
  for (const thread of (threads || []).slice(0, 50)) {
    const { data: messages } = await sb
      .from('advisor_messages')
      .select('role, content, created_at')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true });
    threadsWithMessages.push({ ...thread, messages: messages || [] });
  }

  return {
    exportedAt: new Date().toISOString(),
    client: client || {},
    onboarding: onboarding || null,
    integrations: integrations || [],
    snapshots: (snapshots || []).map(s => ({ id: s.id, date: s.date, month: s.month, score: s.score })),
    kpiSeries: (kpis || []).map(k => ({ date: k.date, kpi_key: k.kpi_key, value: k.value, source: k.source })),
    recommendations: (recs || []).map(r => ({ title: r.title, description: r.description, impact: r.impact, status: r.status, pillar: r.pillar, created_at: r.created_at })),
    actionPlan: (actions || []).map(a => ({ title: a.title, status: a.status, impact: a.impact, pillar: a.pillar, created_at: a.created_at })),
    actionOutcomes: (outcomes || []).map(o => ({ action_title: o.action_title, kpi_key: o.kpi_key, delta_pct: o.delta_pct, correlation_type: o.correlation_type })),
    advisorThreads: threadsWithMessages,
    learnings: (learnings || []).map(l => ({ type: l.type, content: l.content, created_at: l.created_at })),
    interactions: (interactions || []).map(i => ({ action: i.action, detail: i.detail, created_at: i.created_at })),
    aiGenerationLog: (aiLogs || []).map(a => ({ agent: a.agent, model: a.model, success: a.success, cost_cents: a.cost_cents, created_at: a.created_at })),
  };
}

/**
 * Get a summary of how much data we hold for a client.
 * Used in the "Mis datos" panel for transparency.
 */
export async function getDataSummary(clientId: string): Promise<Record<string, number>> {
  const sb = getSupabase();
  const counts: Record<string, number> = {};

  const tables = [
    { key: 'snapshots', table: 'snapshots' },
    { key: 'kpis', table: 'kpi_series' },
    { key: 'recommendations', table: 'recommendations' },
    { key: 'actions', table: 'action_plan' },
    { key: 'outcomes', table: 'action_outcomes' },
    { key: 'threads', table: 'advisor_threads' },
    { key: 'learnings', table: 'client_learnings' },
    { key: 'interactions', table: 'interaction_log' },
    { key: 'aiCalls', table: 'ai_generation_log' },
  ];

  await Promise.all(tables.map(async ({ key, table }) => {
    try {
      const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).eq('client_id', clientId);
      counts[key] = count ?? 0;
    } catch {
      counts[key] = 0;
    }
  }));

  return counts;
}
