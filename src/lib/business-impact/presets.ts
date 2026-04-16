/**
 * Business Impact — default KPI presets per business profile.
 *
 * Each profile has two presets: `with_ga4` (rich, conversion-focused) and
 * `without_ga4` (proxies from DFS + GBP + GSC + manual inputs). The resolver
 * picks the preset based on runtime availability.
 *
 * Matches the matrix agreed with the user:
 *   - local_foot_traffic: same with/without GA4 (all GBP-based)
 *   - local_services: leads from GA4 if available, manual otherwise
 *   - ecommerce: revenue/transactions with GA4, traffic proxies without
 *   - b2b_saas: activations + CPA with GA4, traffic + GSC without
 *   - b2b_services: leads + CPL with GA4, manual + traffic without
 *   - media: traffic + engagement
 *   - freelance_personal: traffic + branded + GSC + keywords
 */

import type { BusinessProfile, KpiKey } from './types';

interface Preset {
  with_ga4: KpiKey[];
  without_ga4: KpiKey[];
}

export const KPI_PRESETS: Record<BusinessProfile, Preset> = {
  local_foot_traffic: {
    // GBP is the king for local foot-traffic whether GA4 is connected or not
    with_ga4: ['gbp_calls', 'gbp_direction_requests', 'reviews_new_total', 'gbp_profile_views'],
    without_ga4: ['gbp_calls', 'gbp_direction_requests', 'reviews_new_total', 'gbp_profile_views'],
  },
  local_services: {
    with_ga4: ['gbp_calls', 'leads_generated', 'traffic_sessions', 'reviews_new_total'],
    without_ga4: ['gbp_calls', 'leads_manual', 'gbp_website_clicks', 'reviews_new_total'],
  },
  ecommerce: {
    with_ga4: ['ecommerce_transactions', 'ecommerce_revenue', 'ecommerce_cpa', 'traffic_sessions'],
    without_ga4: ['traffic_organic_estimate', 'traffic_branded', 'reviews_new_total', 'gsc_clicks'],
  },
  b2b_saas: {
    with_ga4: ['activations', 'cost_per_activation', 'traffic_sessions', 'gsc_clicks'],
    without_ga4: ['traffic_organic_estimate', 'gsc_clicks', 'keywords_indexed_top10', 'leads_manual'],
  },
  b2b_services: {
    with_ga4: ['leads_generated', 'cost_per_lead', 'traffic_sessions', 'gsc_clicks'],
    without_ga4: ['leads_manual', 'traffic_organic_estimate', 'gsc_clicks', 'keywords_indexed_top10'],
  },
  media: {
    with_ga4: ['traffic_sessions', 'traffic_users', 'engagement_total', 'gsc_clicks'],
    without_ga4: ['traffic_organic_estimate', 'gsc_clicks', 'engagement_total', 'keywords_indexed_top10'],
  },
  freelance_personal: {
    with_ga4: ['traffic_sessions', 'traffic_new_users', 'gsc_clicks', 'keywords_indexed_top10'],
    without_ga4: ['traffic_organic_estimate', 'traffic_branded', 'gsc_clicks', 'keywords_indexed_top10'],
  },
  unknown: {
    with_ga4: ['traffic_sessions', 'traffic_users', 'gsc_clicks', 'reviews_new_total'],
    without_ga4: ['traffic_organic_estimate', 'traffic_branded', 'reviews_new_total', 'gbp_calls'],
  },
};

/** Get the 4 default KPIs for a profile given availability. */
export function getDefaultKpis(profile: BusinessProfile, hasGa4: boolean): KpiKey[] {
  const preset = KPI_PRESETS[profile] ?? KPI_PRESETS.unknown;
  return hasGa4 ? preset.with_ga4 : preset.without_ga4;
}
