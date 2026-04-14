import { createClient } from '@supabase/supabase-js';
import {
  DEMO_CLIENT, DEMO_SNAPSHOTS, DEMO_ALERTS, DEMO_CONTEXT_ENTRIES,
  DEMO_RECOMMENDATIONS, DEMO_ONBOARDING, DEMO_USERS,
  type Client, type Snapshot, type Alert, type ContextEntry, type Tier,
} from './demo-data';
import {
  logScore, steppedScore, ratingToScore, resolveThresholds, weightedTotal,
} from './benchmarks/score-with-profile';
import { getProfile } from './benchmarks/profiles';
import { getGeoMultipliers } from './benchmarks/geo-multipliers';
import { resolveProfile } from './benchmarks/resolve-profile';

export { type Client, type Snapshot, type Alert, type ContextEntry, type Tier };
export { DEMO_USERS };

export const IS_DEMO = !(import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL);

// Tier access helpers (server-side freemium wall)
const TIER_LEVEL: Record<Tier, number> = { radar: 0, señales: 1, palancas: 2 };

export function hasTierAccess(currentTier: Tier, requiredTier: Tier): boolean {
  return TIER_LEVEL[currentTier] >= TIER_LEVEL[requiredTier];
}

export function getSupabase() {
  const url = import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
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

// ─── Demo score hydration ────────────────────────────────────────────────
// The demo snapshots don't ship with a precomputed score.breakdown inside
// pipeline_output. Dashboard pages read r.score?.breakdown?.* as the single
// source of truth, so we compute it on-the-fly using the same benchmark
// helpers as the pipeline. The profile is inferred from the pipeline_output
// (sector.ts result) when present, defaulting to 'professional-services'.
function computeDemoBreakdown(po: Record<string, any>): { total: number; breakdown: Record<string, number> } {
  const seo = po.seo || {};
  const geo = po.geo || {};
  const ps = po.pagespeed || {};
  const crawl = po.crawl || {};
  const ssl = po.ssl || {};
  const conv = po.conversion || {};
  const rep = po.reputation || {};
  const gbp = po.gbp || {};
  const cc = po.content_cadence || {};
  const li = po.linkedin || {};
  const ig = po.instagram || {};
  const sectorRes = po.sector || {};

  const resolved = resolveProfile({
    sectorResult: {
      businessProfile: sectorRes.businessProfile,
      geoScope: sectorRes.geoScope,
      confidence: sectorRes.confidence,
    },
  });
  const profile = getProfile(resolved.profile);
  const multipliers = getGeoMultipliers(resolved.geoScope);
  const th = resolveThresholds(profile, multipliers);

  // SEO
  const kwScore = logScore(seo.keywordsTop10 ?? 0, th.keywordsTop10Ceiling);
  const trafficScore = logScore(seo.organicTrafficEstimate ?? 0, th.trafficCeiling);
  const seoScore = Math.round(kwScore * 0.6 + trafficScore * 0.4);

  // GEO
  const geoScore = geo.mentionRate ?? geo.overallScore ?? 0;

  // Web — pagespeed (60%) + techChecks (25%) + techstack maturity (15%)
  // techstack moved from Reputation to Web: it's a measurement / engineering
  // signal, not an external reputation signal.
  const tech = po.techstack || {};
  const psScore = ps.mobile?.performance ?? 0;
  let techChecks = 0;
  if (ssl.valid !== false) techChecks += 25;
  if (crawl.hasCanonical) techChecks += 20;
  if (crawl.hasSchemaMarkup) techChecks += 30;
  if (crawl.hasSitemap) techChecks += 20;
  if (crawl.hasRobots) techChecks += 5;
  const techstackMaturity = (tech.maturityScore != null && tech.maturityScore > 0) ? tech.maturityScore : null;
  const webScore = techstackMaturity != null
    ? Math.min(100, Math.round(psScore * 0.6 + techChecks * 0.25 + techstackMaturity * 0.15))
    : Math.min(100, Math.round(psScore * 0.7 + techChecks * 0.3));

  // Conversion
  const conversionScore = Math.min(100, conv.funnelScore ?? 20);

  // Reputation
  const repComponents: Array<{ value: number; weight: number }> = [];
  const rating = gbp.rating ?? rep.gbpRating;
  if (rating != null) {
    const ratingScore = ratingToScore(rating);
    const reviewBonus = Math.min(15, logScore(gbp.reviewCount ?? rep.totalReviews ?? 0, th.gbpReviewsCeiling) * 0.15);
    repComponents.push({ value: Math.min(100, ratingScore + reviewBonus), weight: 0.25 });
  }
  const news = rep.newsCount ?? 0;
  if (news > 0 || gbp.found) repComponents.push({ value: steppedScore(news, th.pressThresholds), weight: 0.20 });
  const postsPerMonth = (cc.postsLast90Days ?? 0) / 3;
  if (cc.totalPosts) {
    repComponents.push({ value: steppedScore(postsPerMonth, th.blogThresholds), weight: 0.15 });
  }
  if (li.followers) repComponents.push({ value: logScore(li.followers, th.linkedinCeiling), weight: 0.15 });
  if (ig.followers) repComponents.push({ value: logScore(ig.followers, th.instagramCeiling), weight: 0.15 });
  let reputationScore = 0;
  if (repComponents.length > 0) {
    const totalW = repComponents.reduce((s, c) => s + c.weight, 0);
    reputationScore = Math.min(100, Math.round(repComponents.reduce((s, c) => s + c.value * c.weight, 0) / totalW));
  }

  // Weighted total using the profile's own weights
  const { total } = weightedTotal([
    { key: 'seo',        value: seoScore },
    { key: 'geo',        value: geoScore },
    { key: 'web',        value: webScore },
    { key: 'conversion', value: conversionScore },
    { key: 'reputation', value: reputationScore },
  ], profile.weights);

  return {
    total,
    breakdown: {
      seo: seoScore,
      geo: geoScore,
      web: webScore,
      conversion: conversionScore,
      reputation: reputationScore,
    },
  };
}

function hydrateDemoSnapshot(s: Snapshot): Snapshot {
  const po = s.pipeline_output || {};
  if (po.score?.breakdown) return s; // already has breakdown — untouched
  const computed = computeDemoBreakdown(po);
  return {
    ...s,
    pipeline_output: { ...po, score: computed },
  };
}

export async function getLatestSnapshot(clientId: string): Promise<Snapshot> {
  if (IS_DEMO) return hydrateDemoSnapshot(DEMO_SNAPSHOTS[DEMO_SNAPSHOTS.length - 1]);
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
  if (IS_DEMO) return DEMO_SNAPSHOTS.map(hydrateDemoSnapshot);
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

  const snapshotId = snap?.id ?? 'created';

  // Write KPI time-series + materialized columns (fire-and-forget, non-blocking)
  if (snapshotId !== 'created') {
    const { writeKpiSeries, materializeSnapshotColumns } = await import('./data/kpi-extract');
    Promise.all([
      writeKpiSeries(clientId, snapshotId, dateStr, audit.results || {}),
      materializeSnapshotColumns(snapshotId, audit.results || {}),
    ]).catch(err => console.error('[snapshot] KPI/materialize failed:', (err as Error).message));
  }

  return snapshotId;
}

/**
 * Find a completed audit by email (for linking after registration).
 * Returns the most recent completed audit for that email.
 */
export async function findRecentAuditByDomain(domain: string, maxAgeHours: number = 12): Promise<{ id: string; url: string; score: number } | null> {
  if (IS_DEMO) return null;
  const sb = getSupabase();
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('audits')
    .select('id, url, score')
    .ilike('url', `%${domain}%`)
    .eq('status', 'completed')
    .gte('completed_at', cutoff)
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return data;
}

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

export interface PriorityKeyword {
  keyword: string;
  volume?: number;
  currentPosition?: number;
  difficulty?: number;
  feasibility?: 'high' | 'medium' | 'low';
  intent?: 'transactional' | 'commercial' | 'informational';
  rationale?: string;
  source?: 'current' | 'gap' | 'generated' | 'manual';
  opportunityScore?: number;
}

export interface KeywordStrategy {
  demandType?: 'existing' | 'create' | 'both';    // captar demanda vs crear demanda
  focus?: 'volume' | 'quality';                   // volumen vs cualificación
  growthService?: string;                         // servicio a hacer crecer los próximos 3 meses
  updatedAt?: string;
}

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
  sector?: string;
  instagram_handle?: string;
  linkedin_url?: string;
  primary_kpis?: Array<{ key: string; label: string; target?: number }>;
  priority_keywords?: PriorityKeyword[];
  keyword_strategy?: KeywordStrategy;
  completed_at?: string;
}

export async function getClientOnboarding(clientId: string): Promise<ClientOnboarding | null> {
  if (IS_DEMO) return DEMO_ONBOARDING as ClientOnboarding;
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
  if (IS_DEMO) {
    // Mutate demo object in place so subsequent reads reflect the save.
    // Persists across same warm serverless instance; lost on cold start — good enough for demos.
    Object.assign(DEMO_ONBOARDING, onboarding);
    return;
  }
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

export async function getLeadStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  last30Days: number;
  recentLeads: Lead[];
}> {
  if (IS_DEMO) return { total: 0, byStatus: {}, bySource: {}, last30Days: 0, recentLeads: [] };
  const sb = getSupabase();

  const { data: all, error } = await sb
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });
  if (error || !all) return { total: 0, byStatus: {}, bySource: {}, last30Days: 0, recentLeads: [] };

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const byStatus: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let last30Days = 0;

  for (const lead of all) {
    byStatus[lead.status || 'new'] = (byStatus[lead.status || 'new'] || 0) + 1;
    const src = lead.utm_source || lead.source || 'direct';
    bySource[src] = (bySource[src] || 0) + 1;
    if (lead.created_at >= thirtyDaysAgo) last30Days++;
  }

  return {
    total: all.length,
    byStatus,
    bySource,
    last30Days,
    recentLeads: all.slice(0, 20) as Lead[],
  };
}

export async function updateLeadStatus(email: string, url: string, status: string, auditId?: string): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  const update: Record<string, any> = { status, updated_at: new Date().toISOString() };
  if (auditId) update.audit_id = auditId;
  await sb.from('leads').update(update).eq('email', email).eq('url', url);
}

// ─── Recommendations (proposals from the system) ─────────────────────────────

export interface Recommendation {
  id?: string;
  client_id: string;
  source: string;
  pillar?: string;       // 'geo' | 'seo' | 'web' | 'conversión' | 'contenido' | 'reputación'
  title: string;
  description?: string;
  impact?: 'high' | 'medium' | 'low';
  status?: string;       // 'proposed' | 'accepted' | 'rejected'
  rejected_reason?: string;
  month_proposed?: string;
  times_proposed?: number;
  data?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

/** Create a new recommendation proposal.
 *
 *  Semantic dedup: if an existing NON-rejected recommendation for this client
 *  in the same pillar is ≥70% similar by Jaccard on normalized tokens, we
 *  skip the insert and bump `times_proposed` on the existing row instead.
 *  This prevents the weekly regenerations from accumulating copies like
 *  "Mejora tu PageSpeed móvil" / "Optimiza la velocidad móvil" under the
 *  same pillar.
 *
 *  Rejected recommendations are NOT treated as duplicates — if the client
 *  rejected one, the agent can re-propose a fresh variant later.
 */
export async function logRecommendation(rec: Omit<Recommendation, 'status'>): Promise<string | null> {
  if (IS_DEMO) return null;
  const sb = getSupabase();

  // Dedup check — compare against existing proposed / accepted / in-plan
  // rows for the same client. Lazy import to avoid a circular dependency.
  try {
    const { findSimilarRecommendation } = await import('./recommendations/dedupe');
    const { data: existing } = await sb
      .from('recommendations')
      .select('id, pillar, title, times_proposed')
      .eq('client_id', rec.client_id)
      .neq('status', 'rejected');
    if (existing && existing.length > 0) {
      const dup = findSimilarRecommendation(
        { pillar: rec.pillar ?? null, title: rec.title },
        existing.map(r => ({ id: r.id, pillar: r.pillar, title: r.title, times_proposed: r.times_proposed })),
      );
      if (dup) {
        const newCount = ((dup as any).times_proposed ?? 1) + 1;
        await sb.from('recommendations').update({ times_proposed: newCount }).eq('id', dup.id);
        console.log(`[recommendations] Dedup skipped "${rec.title.slice(0, 50)}" — similar to #${dup.id} (times_proposed → ${newCount})`);
        return dup.id ?? null;
      }
    }
  } catch (err) {
    console.warn(`[recommendations] Dedup check failed (proceeding with insert): ${(err as Error).message}`);
  }

  // NOTE: expected_kpis lives inside the `data` jsonb column (passed by callers
  // as `data: { expected_kpis: [...] }`) — NOT as a top-level column. The table
  // has no `expected_kpis` column, and inserting one breaks the call with
  // "Could not find the 'expected_kpis' column in the schema cache", which
  // made every logRecommendation fail silently for both the Growth Agent
  // and the Chat Advisor.
  const { data, error } = await sb
    .from('recommendations')
    .insert({
      ...rec,
      status: 'proposed',
      month_proposed: new Date().toISOString().slice(0, 7),
    })
    .select('id')
    .single();
  if (error) { console.error('[recommendations] Insert failed:', error.message); return null; }
  return data?.id ?? null;
}

/** Get proposed recommendations (not yet accepted/rejected) */
export async function getProposedRecommendations(clientId: string): Promise<Recommendation[]> {
  if (IS_DEMO) {
    // Derive from the latest snapshot's Growth Agent analysis so the demo
    // reflects the coherent, ranked plan from the unified agent.
    // Fall back to any hardcoded pending DEMO_RECOMMENDATIONS (legacy demo data).
    const latest = DEMO_SNAPSHOTS[DEMO_SNAPSHOTS.length - 1];
    const ga = latest?.pipeline_output?.growth_analysis;
    if (ga?.prioritizedActions?.length) {
      return ga.prioritizedActions.map((a: any, i: number): Recommendation => ({
        id: `demo-ga-${a.rank ?? i + 1}`,
        client_id: clientId,
        source: 'growth_agent',
        pillar: a.pillar,
        title: a.title,
        description: a.description,
        impact: a.businessImpact || 'medium',
        status: 'pending',
        data: {
          rank: a.rank,
          detail: a.detail,
          expectedOutcome: a.expectedOutcome,
          effort: a.effort,
          timeframe: a.timeframe,
          rationale: a.rationale,
          linkedGap: a.linkedGap,
        },
      }));
    }
    return DEMO_RECOMMENDATIONS.filter(r => r.status === 'pending') as Recommendation[];
  }
  const sb = getSupabase();
  const { data } = await sb
    .from('recommendations')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'proposed')
    .order('created_at', { ascending: false });
  return (data || []) as Recommendation[];
}

/** Get rejected recommendations (for potential re-proposal) */
export async function getRejectedRecommendations(clientId: string): Promise<Recommendation[]> {
  if (IS_DEMO) return [];
  const sb = getSupabase();
  const { data } = await sb
    .from('recommendations')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'rejected')
    .order('created_at', { ascending: false });
  return (data || []) as Recommendation[];
}

/** Get ALL recommendations (for context building / diff-engine) */
export async function getAllRecommendations(clientId: string): Promise<Recommendation[]> {
  if (IS_DEMO) return DEMO_RECOMMENDATIONS as Recommendation[];
  const sb = getSupabase();
  const { data } = await sb
    .from('recommendations')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  return (data || []) as Recommendation[];
}

/** Get proposed recommendations filtered by pillar */
export async function getRecommendationsByPillar(clientId: string, pillar: string): Promise<Recommendation[]> {
  if (IS_DEMO) {
    // Prefer Growth Agent actions filtered by pillar, fall back to legacy DEMO_RECOMMENDATIONS
    const all = await getProposedRecommendations(clientId);
    const filtered = all.filter(r => r.pillar === pillar);
    if (filtered.length > 0) return filtered;
    return DEMO_RECOMMENDATIONS.filter(r => r.status === 'pending' && r.pillar === pillar) as Recommendation[];
  }
  const sb = getSupabase();
  const { data } = await sb
    .from('recommendations')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'proposed')
    .eq('pillar', pillar)
    .order('created_at', { ascending: false });
  return (data || []) as Recommendation[];
}

/** Accept recommendation → creates action_plan entry */
export async function acceptRecommendation(recId: string, clientId: string, acceptedBy?: string): Promise<string | null> {
  if (IS_DEMO) return null;
  const sb = getSupabase();

  // 1. Get the recommendation
  const { data: rec } = await sb.from('recommendations').select('*').eq('id', recId).single();
  if (!rec) return null;

  // 2. Mark as accepted
  await sb.from('recommendations')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', recId);

  // 3. Build action.data — copy rec.data verbatim + parse subtasks from the
  // `detail` markdown so the client gets a checklist they can tick off.
  // If the caller later overrides data.subtasks (e.g. manual task with its
  // own subtasks) we never parse over it.
  const recData = (rec.data || {}) as Record<string, any>;
  const { parseSubtasks } = await import('./recommendations/parse-subtasks');
  const subtasks = Array.isArray(recData.subtasks) && recData.subtasks.length > 0
    ? recData.subtasks
    : parseSubtasks(recData.detail);

  // 4. Create action_plan entry
  const { data: action, error } = await sb.from('action_plan').insert({
    client_id: clientId,
    recommendation_id: recId,
    title: rec.title,
    description: rec.description,
    impact: rec.impact,
    source: rec.source || 'radar',
    status: 'pending',
    data: { ...recData, subtasks, accepted_by: acceptedBy || null },
  }).select('id').single();

  if (error) { console.error('[action_plan] Insert failed:', error.message); return null; }
  return action?.id ?? null;
}

/** Reject recommendation */
export async function rejectRecommendation(recId: string, reason?: string): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  await sb.from('recommendations').update({
    status: 'rejected',
    rejected_reason: reason || null,
    updated_at: new Date().toISOString(),
  }).eq('id', recId);
}

// ─── Action Plan (accepted actions the client commits to) ────────────────────

export interface ActionPlanItem {
  id: string;
  client_id: string;
  recommendation_id?: string;
  title: string;
  description?: string;
  impact?: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'done';
  source?: string;
  started_at?: string;
  completed_at?: string;
  feedback?: string;
  data?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

/** Get active action plan items */
export async function getActionPlan(clientId: string): Promise<ActionPlanItem[]> {
  if (IS_DEMO) return DEMO_RECOMMENDATIONS.filter(r => ['accepted', 'in_progress'].includes(r.status)).map(r => ({ ...r, status: r.status === 'accepted' ? 'pending' : r.status })) as unknown as ActionPlanItem[];
  const sb = getSupabase();
  const { data } = await sb
    .from('action_plan')
    .select('*')
    .eq('client_id', clientId)
    .in('status', ['pending', 'in_progress'])
    .order('created_at', { ascending: false });
  return (data || []) as ActionPlanItem[];
}

/** Get completed actions (for correlation tracking) */
export async function getCompletedActions(clientId: string): Promise<ActionPlanItem[]> {
  if (IS_DEMO) return DEMO_RECOMMENDATIONS.filter(r => r.status === 'done') as unknown as ActionPlanItem[];
  const sb = getSupabase();
  const { data } = await sb
    .from('action_plan')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'done')
    .order('completed_at', { ascending: false });
  return (data || []) as ActionPlanItem[];
}

/** Update action plan item status */
export async function updateActionStatus(
  actionId: string,
  status: 'pending' | 'in_progress' | 'done',
  feedback?: string,
): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  const update: Record<string, any> = { status, updated_at: new Date().toISOString() };
  if (status === 'in_progress') update.started_at = new Date().toISOString();
  if (status === 'done') update.completed_at = new Date().toISOString();
  if (feedback) update.feedback = feedback;
  await sb.from('action_plan').update(update).eq('id', actionId);
}

/** Create a manual action (not from a recommendation — client's own initiative) */
export async function createManualAction(
  clientId: string,
  title: string,
  description?: string,
  impact?: 'high' | 'medium' | 'low',
  createdBy?: string,
  expectedKpis?: Array<{ key: string; label: string; direction: string }>,
): Promise<string | null> {
  if (IS_DEMO) return null;
  const sb = getSupabase();
  const { data, error } = await sb.from('action_plan').insert({
    client_id: clientId,
    title,
    description: description || null,
    impact: impact || 'medium',
    source: 'manual',
    status: 'pending',
    accepted_by: createdBy || null,
    accepted_at: new Date().toISOString(),
    expected_kpis: expectedKpis || [],
  }).select('id').single();
  if (error) { console.error('[action_plan] Manual insert failed:', error.message); return null; }
  return data?.id ?? null;
}

// Legacy compatibility — used by old code paths
export const updateRecommendationStatus = updateActionStatus;
export const getActiveRecommendations = getActionPlan;

// ─── Interaction Log ──────────────────────────────────────────────────────────

export async function logInteraction(
  clientId: string,
  action: string,
  detail?: Record<string, any>,
  userId?: string,
): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  await sb.from('interaction_log').insert({
    client_id: clientId,
    user_id: userId || null,
    action,
    detail: detail || {},
  });
}

// ─── Briefing ─────────────────────────────────────────────────────────────────

export async function getActiveBriefing(clientId: string): Promise<Record<string, any> | null> {
  if (IS_DEMO) {
    const latest = DEMO_SNAPSHOTS[DEMO_SNAPSHOTS.length - 1];
    return latest?.pipeline_output?.briefing || null;
  }
  // Briefing is stored in the latest snapshot's pipeline_output.briefing
  const snapshot = await getLatestSnapshot(clientId);
  if (snapshot.id === 'empty') return null;
  return snapshot.pipeline_output?.briefing || null;
}

// ─── Client Documents ─────────────────────────────────────────────────────────

export interface ClientDocument {
  id?: string;
  client_id: string;
  filename: string;
  file_path: string;
  file_type?: string;
  file_size_bytes?: number;
  status?: 'uploading' | 'processing' | 'ready' | 'error';
  extracted_text?: string;
  summary?: string;
  category?: string;
  entities?: string[];
  key_facts?: string[];
  error_message?: string;
}

export async function getClientDocuments(clientId: string): Promise<ClientDocument[]> {
  if (IS_DEMO) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('client_documents')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as ClientDocument[];
}

export async function saveClientDocument(doc: ClientDocument): Promise<string | null> {
  if (IS_DEMO) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('client_documents')
    .insert(doc)
    .select('id')
    .single();
  if (error) { console.error('[documents] Insert failed:', error.message); return null; }
  return data?.id ?? null;
}

export async function updateDocumentStatus(
  docId: string,
  status: string,
  updates?: { extracted_text?: string; summary?: string; entities?: any; category?: string; error_message?: string },
): Promise<void> {
  if (IS_DEMO) return;
  const sb = getSupabase();
  await sb.from('client_documents').update({
    status,
    ...updates,
    updated_at: new Date().toISOString(),
  }).eq('id', docId);
}
