/**
 * Business Impact — KPI resolver.
 *
 * Given a client, loads everything needed and returns a list of 4 KpiWithValue
 * objects ready to render in the dashboard:
 *   1. Load client_onboarding (profile + custom KPI picks + deal_value + close_rate + ad_spend)
 *   2. Load latest + previous snapshots (for deltas)
 *   3. Detect availability (ga4, gsc, gbp, deal_value, ad_spend)
 *   4. Pick the KPI key list: custom > preset(ga4) > preset(no ga4)
 *   5. For each KPI: extract current and previous values
 *   6. Attach target from primary_kpis when key matches
 *   7. Compute deltas + formatting metadata
 */

import { getSupabase, getAllSnapshots, getClientOnboarding } from '../db';
import { KPI_DEFINITIONS } from './definitions';
import { getDefaultKpis } from './presets';
import type {
  Availability, BusinessProfile, KpiKey, KpiWithValue, ManualBusinessInput,
} from './types';

const DEFAULT_CLOSE_RATE = 20;   // if client hasn't provided one

// ─── Helpers ─────────────────────────────────────────────────────────────

function firstOfCurrentMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function firstOfPreviousMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
}

function detectAvailability(
  snapshot: any | null,
  onboarding: any | null,
): Availability {
  const analytics = snapshot?.pipeline_output?.analytics ?? {};
  const gbp = snapshot?.pipeline_output?.gbp ?? {};
  return {
    has_ga4: !!analytics.ga4,
    has_gsc: !!analytics.gsc,
    has_gbp: !!(gbp.found || gbp.rating || gbp.reviewCount),
    has_ad_spend: typeof onboarding?.monthly_ad_spend === 'number' && onboarding.monthly_ad_spend > 0,
    has_deal_value: typeof onboarding?.avg_deal_value === 'number' && onboarding.avg_deal_value > 0,
  };
}

/** Normalize business_profile to our 7 canonical keys. */
function resolveBusinessProfile(
  onboarding: any | null,
  sectorResult: any | null,
): BusinessProfile {
  const raw = (onboarding?.business_profile || sectorResult?.businessProfile || 'unknown').toLowerCase();
  const mapping: Record<string, BusinessProfile> = {
    local_foot_traffic: 'local_foot_traffic',
    'local-foot-traffic': 'local_foot_traffic',
    'retail-local': 'local_foot_traffic',
    restaurant: 'local_foot_traffic',
    local_services: 'local_services',
    'local-services': 'local_services',
    'professional-services': 'local_services',
    ecommerce: 'ecommerce',
    'e-commerce': 'ecommerce',
    retail: 'ecommerce',
    b2b_saas: 'b2b_saas',
    saas: 'b2b_saas',
    'b2b-saas': 'b2b_saas',
    b2b_services: 'b2b_services',
    'b2b-services': 'b2b_services',
    consulting: 'b2b_services',
    agency: 'b2b_services',
    media: 'media',
    blog: 'media',
    publisher: 'media',
    freelance_personal: 'freelance_personal',
    'freelance-personal': 'freelance_personal',
    freelance: 'freelance_personal',
    personal_brand: 'freelance_personal',
  };
  return mapping[raw] ?? 'unknown';
}

// ─── Extractors — one per KPI source ─────────────────────────────────────

type Extractor = (ctx: ExtractorContext) => number | null;

interface ExtractorContext {
  current: any | null;        // latest snapshot pipeline_output
  previous: any | null;       // previous snapshot pipeline_output
  onboarding: any | null;
  manualCurrent: Record<string, number>;   // { leads: 12, sales_count: 34 }
  manualPrevious: Record<string, number>;
  useCurrent: boolean;        // true = extract current value, false = previous
}

function pick(ctx: ExtractorContext): any {
  return ctx.useCurrent ? ctx.current : ctx.previous;
}

const EXTRACTORS: Record<KpiKey, Extractor> = {
  // GBP
  gbp_calls: ctx => pick(ctx)?.gbp?.insights?.callClicks ?? pick(ctx)?.gbp?.callClicks ?? null,
  gbp_direction_requests: ctx => pick(ctx)?.gbp?.insights?.directionRequests ?? pick(ctx)?.gbp?.directionRequests ?? null,
  gbp_website_clicks: ctx => pick(ctx)?.gbp?.insights?.websiteClicks ?? pick(ctx)?.gbp?.websiteClicks ?? null,
  gbp_profile_views: ctx => pick(ctx)?.gbp?.insights?.profileViews ?? pick(ctx)?.gbp?.profileViews ?? null,

  // Reviews
  reviews_new_google: ctx => {
    const cur = ctx.current?.gbp?.reviewCount ?? 0;
    const prev = ctx.previous?.gbp?.reviewCount ?? 0;
    const newCount = Math.max(0, cur - prev);
    return ctx.useCurrent ? newCount : 0;  // delta already; previous delta = 0
  },
  reviews_new_total: ctx => {
    const curGoogle = ctx.current?.gbp?.reviewCount ?? 0;
    const prevGoogle = ctx.previous?.gbp?.reviewCount ?? 0;
    const curTp = ctx.current?.reputation?.trustpilotReviews ?? 0;
    const prevTp = ctx.previous?.reputation?.trustpilotReviews ?? 0;
    const newCount = Math.max(0, (curGoogle + curTp) - (prevGoogle + prevTp));
    return ctx.useCurrent ? newCount : 0;
  },

  // Traffic
  traffic_organic_estimate: ctx => pick(ctx)?.seo?.organicTrafficEstimate ?? null,
  traffic_branded: ctx => {
    const s = pick(ctx)?.seo;
    if (!s) return null;
    if (typeof s.brandedTraffic === 'number') return s.brandedTraffic;
    // Derived: if we have brandTrafficPct and organicTrafficEstimate
    if (typeof s.brandTrafficPct === 'number' && typeof s.organicTrafficEstimate === 'number') {
      return Math.round(s.organicTrafficEstimate * (s.brandTrafficPct / 100));
    }
    return null;
  },
  gsc_clicks: ctx => pick(ctx)?.analytics?.gsc?.totalClicks ?? null,
  keywords_indexed_top10: ctx => pick(ctx)?.seo?.keywordsTop10 ?? null,

  // Ecommerce
  ecommerce_revenue: ctx => pick(ctx)?.analytics?.ga4?.revenue ?? null,
  ecommerce_transactions: ctx => pick(ctx)?.analytics?.ga4?.transactions ?? pick(ctx)?.analytics?.ga4?.conversions ?? null,
  ecommerce_cpa: ctx => {
    const txs = pick(ctx)?.analytics?.ga4?.transactions ?? pick(ctx)?.analytics?.ga4?.conversions ?? 0;
    const spend = ctx.onboarding?.monthly_ad_spend ?? 0;
    if (!txs || !spend) return null;
    return +(spend / txs).toFixed(2);
  },
  ecommerce_roas: ctx => {
    const revenue = pick(ctx)?.analytics?.ga4?.revenue ?? 0;
    const spend = ctx.onboarding?.monthly_ad_spend ?? 0;
    if (!revenue || !spend) return null;
    return +(revenue / spend).toFixed(2);
  },

  // Lead-gen / SaaS
  leads_generated: ctx => pick(ctx)?.analytics?.ga4?.conversions ?? null,
  leads_manual: ctx => {
    const source = ctx.useCurrent ? ctx.manualCurrent : ctx.manualPrevious;
    return source?.leads ?? null;
  },
  cost_per_lead: ctx => {
    const leads = pick(ctx)?.analytics?.ga4?.conversions
      ?? (ctx.useCurrent ? ctx.manualCurrent : ctx.manualPrevious)?.leads
      ?? 0;
    const spend = ctx.onboarding?.monthly_ad_spend ?? 0;
    if (!leads || !spend) return null;
    return +(spend / leads).toFixed(2);
  },
  activations: ctx => {
    const source = ctx.useCurrent ? ctx.manualCurrent : ctx.manualPrevious;
    return pick(ctx)?.analytics?.ga4?.conversions ?? source?.activations ?? null;
  },
  cost_per_activation: ctx => {
    const activations = pick(ctx)?.analytics?.ga4?.conversions
      ?? (ctx.useCurrent ? ctx.manualCurrent : ctx.manualPrevious)?.activations
      ?? 0;
    const spend = ctx.onboarding?.monthly_ad_spend ?? 0;
    if (!activations || !spend) return null;
    return +(spend / activations).toFixed(2);
  },

  // Derived
  estimated_pipeline: ctx => {
    const leads = pick(ctx)?.analytics?.ga4?.conversions
      ?? (ctx.useCurrent ? ctx.manualCurrent : ctx.manualPrevious)?.leads
      ?? 0;
    const dealValue = ctx.onboarding?.avg_deal_value ?? 0;
    const closeRate = (ctx.onboarding?.close_rate ?? DEFAULT_CLOSE_RATE) / 100;
    if (!leads || !dealValue) return null;
    return Math.round(leads * dealValue * closeRate);
  },

  // Engagement (media)
  engagement_total: ctx => {
    const s = pick(ctx);
    if (!s) return null;
    const ig = (s.instagram?.avgLikes ?? 0) + (s.instagram?.avgComments ?? 0);
    const li = (s.linkedin?.avgLikes ?? 0) + (s.linkedin?.avgComments ?? 0);
    const posts = (s.instagram?.postsLast90Days ?? 0) + (s.linkedin?.postsLast90Days ?? 0);
    if (posts === 0) return null;
    // Rough monthly reach approximation: (avg engagement per post) × (posts/month)
    const postsPerMonth = posts / 3;   // 90-day window → 3 months
    return Math.round((ig + li) * postsPerMonth);
  },
};

/** Fetch manual inputs for the current + previous months as two key→value maps. */
async function fetchManualInputs(clientId: string): Promise<{
  current: Record<string, number>;
  previous: Record<string, number>;
}> {
  const sb = getSupabase();
  const months = [firstOfCurrentMonth(), firstOfPreviousMonth()];
  const { data } = await sb.from('manual_business_inputs')
    .select('month, metric_key, value')
    .eq('client_id', clientId)
    .in('month', months);
  const result = { current: {} as Record<string, number>, previous: {} as Record<string, number> };
  for (const row of (data ?? []) as ManualBusinessInput[]) {
    const bucket = row.month === months[0] ? result.current : result.previous;
    bucket[row.metric_key] = row.value;
  }
  return result;
}

/** Target lookup from client_onboarding.primary_kpis if the key matches. */
function findTarget(onboarding: any | null, kpiKey: KpiKey): number | null {
  const kpis: Array<{ key: string; target?: number }> = onboarding?.primary_kpis ?? [];
  const match = kpis.find(k => k.key === kpiKey);
  return match?.target ?? null;
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function resolveBusinessKpis(clientId: string): Promise<{
  kpis: KpiWithValue[];
  profile: BusinessProfile;
  availability: Availability;
}> {
  const [onboarding, snapshots, manual] = await Promise.all([
    getClientOnboarding(clientId),
    getAllSnapshots(clientId),
    fetchManualInputs(clientId),
  ]);
  const latest = snapshots?.[snapshots.length - 1] ?? null;
  const previous = snapshots && snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const latestPo = (latest as any)?.pipeline_output ?? null;
  const prevPo = (previous as any)?.pipeline_output ?? null;

  const availability = detectAvailability(latest, onboarding);
  const profile = resolveBusinessProfile(onboarding, latestPo?.sector);

  // Custom selection wins over presets
  const custom = (onboarding as any)?.business_impact_kpis;
  const kpiKeys: KpiKey[] = Array.isArray(custom) && custom.length > 0
    ? (custom as KpiKey[])
    : getDefaultKpis(profile, availability.has_ga4);

  const ctx = {
    current: latestPo,
    previous: prevPo,
    onboarding,
    manualCurrent: manual.current,
    manualPrevious: manual.previous,
  };

  const kpis: KpiWithValue[] = kpiKeys.map((key) => {
    const def = KPI_DEFINITIONS[key];
    if (!def) {
      return null as any;  // filtered out below
    }
    const extractor = EXTRACTORS[key];
    const value = extractor ? extractor({ ...ctx, useCurrent: true }) : null;
    const previous_value = extractor ? extractor({ ...ctx, useCurrent: false }) : null;
    const target = findTarget(onboarding, key);
    const delta = (value != null && previous_value != null) ? +(value - previous_value).toFixed(2) : null;
    const delta_pct = (value != null && previous_value != null && previous_value !== 0)
      ? +((delta! / Math.abs(previous_value)) * 100).toFixed(1) : null;

    // Warnings about data quality / missing inputs
    let warning: string | undefined;
    if (def.requires_ga4 && !availability.has_ga4) warning = 'Conecta GA4 para valores reales';
    else if (def.requires_gsc && !availability.has_gsc) warning = 'Conecta Search Console para datos reales';
    else if (def.requires_gbp && !availability.has_gbp) warning = 'Perfil de Google Business no detectado';
    else if (def.requires_deal_value && !availability.has_deal_value) warning = 'Configura el valor medio por cliente en Ajustes';
    else if (def.requires_ad_spend && !availability.has_ad_spend) warning = 'Configura la inversión mensual en ads';

    return {
      ...def,
      value,
      previous_value,
      target,
      delta,
      delta_pct,
      is_estimate: def.source === 'dfs_seo' || def.source === 'derived',
      warning,
    };
  }).filter(Boolean) as KpiWithValue[];

  return { kpis, profile, availability };
}
