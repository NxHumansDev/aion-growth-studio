import { createClient } from '@supabase/supabase-js';
import {
  DEMO_CLIENT, DEMO_SNAPSHOTS, DEMO_ALERTS, DEMO_CONTEXT_ENTRIES,
  type Client, type Snapshot, type Alert, type ContextEntry, type Tier,
} from './demo-data';

export { type Client, type Snapshot, type Alert, type ContextEntry, type Tier };
export { DEMO_USERS } from './demo-data';

export const IS_DEMO = !import.meta.env.SUPABASE_URL;

// Tier access helpers (server-side freemium wall)
const TIER_LEVEL: Record<Tier, number> = { radar: 0, señales: 1, palancas: 2 };

export function hasTierAccess(currentTier: Tier, requiredTier: Tier): boolean {
  return TIER_LEVEL[currentTier] >= TIER_LEVEL[requiredTier];
}

function getSupabase() {
  const url = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}

export async function getClient(userId: string): Promise<Client> {
  if (IS_DEMO) return DEMO_CLIENT;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('client_users')
    .select('client_id, role, clients(id, name, domain, sector, tier)')
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('Client not found');
  const c = data.clients as any;
  return { id: c.id, name: c.name, domain: c.domain, sector: c.sector, tier: c.tier };
}

export async function getLatestSnapshot(clientId: string): Promise<Snapshot> {
  if (IS_DEMO) return DEMO_SNAPSHOTS[DEMO_SNAPSHOTS.length - 1];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('snapshots')
    .select('*')
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    // No snapshots yet — return empty placeholder
    return {
      id: 'empty',
      client_id: clientId,
      date: new Date().toISOString().slice(0, 10),
      month: 'sin-datos',
      score: 0,
      pipeline_output: {},
    } as Snapshot;
  }
  return data as Snapshot;
}

export async function getAllSnapshots(clientId: string): Promise<Snapshot[]> {
  if (IS_DEMO) return DEMO_SNAPSHOTS;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('snapshots')
    .select('*')
    .eq('client_id', clientId)
    .order('date', { ascending: true });
  if (error || !data) return [];
  return data as Snapshot[];
}

export async function getAlerts(clientId: string): Promise<Alert[]> {
  if (IS_DEMO) return DEMO_ALERTS;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('alerts')
    .select('*')
    .eq('client_id', clientId)
    .is('resolved_at', null)
    .order('timestamp', { ascending: false });
  if (error || !data) return [];
  return data as Alert[];
}

export async function getContextEntries(clientId: string): Promise<ContextEntry[]> {
  if (IS_DEMO) return DEMO_CONTEXT_ENTRIES;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('context_entries')
    .select('*')
    .eq('client_id', clientId)
    .order('date', { ascending: false });
  if (error || !data) return [];
  return data as ContextEntry[];
}

// ─── Audit → Snapshot bridge ──────────────────────────────────────────────────

const MONTH_NAMES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

/**
 * Creates a snapshot from a completed audit.
 * This is the bridge between the free audit (audits table) and the
 * dashboard experience (snapshots table).
 */
export async function createSnapshotFromAudit(auditId: string, clientId: string): Promise<string> {
  if (IS_DEMO) return 'demo-snapshot';
  const sb = getSupabase();

  // Read the completed audit
  const { data: audit, error: auditErr } = await sb
    .from('audits')
    .select('results, score, completed_at, url')
    .eq('id', auditId)
    .single();
  if (auditErr || !audit) throw new Error(`Audit not found: ${auditId}`);
  if (!audit.results || Object.keys(audit.results).length === 0) {
    throw new Error('Audit has no results — is it completed?');
  }

  const completedAt = audit.completed_at ? new Date(audit.completed_at) : new Date();
  const dateStr = completedAt.toISOString().slice(0, 10);
  const month = `${MONTH_NAMES[completedAt.getMonth()]}-${completedAt.getFullYear()}`;

  const { data: snap, error: snapErr } = await sb
    .from('snapshots')
    .upsert({
      client_id: clientId,
      date: dateStr,
      month,
      score: audit.score ?? 0,
      pipeline_output: audit.results,
    }, { onConflict: 'client_id,month' })
    .select('id')
    .single();
  if (snapErr) throw new Error(`Failed to create snapshot: ${snapErr.message}`);
  return snap?.id ?? 'created';
}

/**
 * Find a completed audit by email (for linking after registration).
 * Returns the most recent completed audit for that email.
 */
export async function findAuditByEmail(email: string): Promise<{ id: string; url: string; score: number } | null> {
  if (IS_DEMO) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('audits')
    .select('id, url, score')
    .eq('email', email)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return data;
}

export async function updateClientTier(clientId: string, tier: Tier): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  await sb.from('clients').update({ tier }).eq('id', clientId);
}

export async function getClientById(clientId: string): Promise<Client> {
  if (IS_DEMO) return DEMO_CLIENT;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('clients')
    .select('id, name, domain, sector, tier')
    .eq('id', clientId)
    .single();
  if (error || !data) throw new Error('Client not found');
  return data as Client;
}

export async function getUserRole(userId: string, clientId: string): Promise<'admin' | 'viewer'> {
  if (IS_DEMO) return 'admin';
  const sb = getSupabase();
  const { data, error } = await sb
    .from('client_users')
    .select('role')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .single();
  if (error || !data) return 'viewer';
  return data.role as 'admin' | 'viewer';
}

export async function listAllClients(): Promise<Client[]> {
  if (IS_DEMO) return [DEMO_CLIENT];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('clients')
    .select('id, name, domain, sector, tier')
    .order('name');
  if (error || !data) return [];
  return data as Client[];
}

export async function listClientUsers(clientId: string): Promise<import('./demo-data').User[]> {
  if (IS_DEMO) return DEMO_USERS.filter(u => u.clientId === clientId);
  const sb = getSupabase();
  // Fetch client_users rows; auth.users email requires admin API
  const { data, error } = await sb
    .from('client_users')
    .select('user_id, role')
    .eq('client_id', clientId);
  if (error || !data) return [];
  // Fetch emails via admin API
  const results: import('./demo-data').User[] = [];
  for (const row of data) {
    const { data: authUser } = await sb.auth.admin.getUserById(row.user_id);
    results.push({
      id: row.user_id,
      clientId,
      name: authUser?.user?.user_metadata?.full_name || authUser?.user?.email?.split('@')[0] || row.user_id,
      email: authUser?.user?.email || '',
      role: row.role as 'admin' | 'viewer',
    });
  }
  return results;
}

export async function createClientUser(
  clientId: string,
  email: string,
  role: 'admin' | 'viewer',
): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  // Invite user via Supabase Auth (creates auth.users row + sends invite email)
  const { data: invited, error: inviteError } = await sb.auth.admin.inviteUserByEmail(email);
  if (inviteError || !invited.user) throw new Error(inviteError?.message || 'Invite failed');
  await sb.from('client_users').insert({ client_id: clientId, user_id: invited.user.id, role });
}

export async function deleteClientUser(clientId: string, userId: string): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  await sb.from('client_users').delete().eq('client_id', clientId).eq('user_id', userId);
}

// ─── Client Onboarding Context ────────────────────────────────────────────────

export interface ClientOnboarding {
  id?: string;
  client_id: string;
  business_description?: string;
  primary_goal?: string;
  goal_detail?: string;
  geo_scope?: string;
  geo_detail?: string;
  url_architecture?: string;
  url_detail?: string;
  monthly_budget?: string;
  team_size?: string;
  competitors?: Array<{ url: string; name?: string }>;
  completed_at?: string;
}

export async function getClientOnboarding(clientId: string): Promise<ClientOnboarding | null> {
  if (IS_DEMO) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('client_onboarding')
    .select('*')
    .eq('client_id', clientId)
    .single();
  if (error || !data) return null;
  return data as ClientOnboarding;
}

export async function saveClientOnboarding(onboarding: ClientOnboarding): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  const { error } = await sb
    .from('client_onboarding')
    .upsert({
      ...onboarding,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' });
  if (error) throw new Error(`Failed to save onboarding: ${error.message}`);
}

export function isOnboardingComplete(onboarding: ClientOnboarding | null): boolean {
  if (!onboarding) return false;
  return !!(onboarding.business_description && onboarding.primary_goal && onboarding.geo_scope);
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export interface Lead {
  email: string;
  url: string;
  name?: string;
  company?: string;
  audit_id?: string;
  status?: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

export async function saveLead(lead: Lead): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  const { error } = await sb
    .from('leads')
    .upsert({
      ...lead,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email,url' });
  if (error) console.error('[leads] Save failed:', error.message);
}

export async function updateLeadStatus(email: string, url: string, status: string, auditId?: string): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  const update: Record<string, any> = { status, updated_at: new Date().toISOString() };
  if (auditId) update.audit_id = auditId;
  await sb.from('leads').update(update).eq('email', email).eq('url', url);
}
