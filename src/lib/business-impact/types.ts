/**
 * Business Impact — shared types for the Business Impact KPI layer.
 */

export type KpiKey =
  // Local / foot-traffic
  | 'gbp_calls'
  | 'gbp_direction_requests'
  | 'gbp_website_clicks'
  | 'gbp_profile_views'
  // Reputation
  | 'reviews_new_google'
  | 'reviews_new_total'
  // Traffic
  | 'traffic_organic_estimate'
  | 'traffic_branded'
  | 'gsc_clicks'
  | 'keywords_indexed_top10'
  // Ecommerce
  | 'ecommerce_revenue'
  | 'ecommerce_transactions'
  | 'ecommerce_cpa'
  | 'ecommerce_roas'
  // Lead-gen / SaaS
  | 'leads_generated'
  | 'leads_manual'
  | 'cost_per_lead'
  | 'activations'
  | 'cost_per_activation'
  // Derived / pipeline
  | 'estimated_pipeline'
  // Engagement (only for media profile)
  | 'engagement_total';

/** Where the value comes from. Determines feasibility given client integrations. */
export type KpiSource =
  | 'gbp'         // Google Business Profile API
  | 'ga4'         // GA4 events / ecommerce
  | 'gsc'         // Google Search Console
  | 'dfs_seo'     // DataForSEO SEO module
  | 'reputation'  // Our reputation pipeline module
  | 'social'      // Instagram / LinkedIn via Apify
  | 'manual'      // User-entered in /settings
  | 'derived';    // Computed from other values (e.g. pipeline from leads × deal × close)

/** The unit hints how the UI should format the value. */
export type KpiUnit = 'count' | 'currency' | 'percentage' | 'ratio' | 'duration_ms';

/** Business profiles — mirrors the 7 we agreed on. */
export type BusinessProfile =
  | 'local_foot_traffic'
  | 'local_services'
  | 'ecommerce'
  | 'b2b_saas'
  | 'b2b_services'
  | 'media'
  | 'freelance_personal'
  | 'unknown';

/** Definition of a single KPI — metadata only, no value. */
export interface KpiDefinition {
  key: KpiKey;
  label: string;                          // "Llamadas desde Google Business"
  short_label: string;                    // "Llamadas GBP" — for tight card headers
  unit: KpiUnit;
  source: KpiSource;
  /** Which business profiles this KPI is appropriate for (empty = all). */
  profiles: BusinessProfile[] | 'all';
  /** Requires GA4 connected. */
  requires_ga4?: boolean;
  /** Requires GSC connected. */
  requires_gsc?: boolean;
  /** Requires GBP data present. */
  requires_gbp?: boolean;
  /** Requires the client to have filled avg_deal_value / close_rate / monthly_ad_spend. */
  requires_deal_value?: boolean;
  requires_close_rate?: boolean;
  requires_ad_spend?: boolean;
  /** Human-readable explanation for tooltip. */
  description: string;
  /** Direction: higher = better, lower = better, neutral. */
  better: 'up' | 'down' | 'neutral';
}

/** A resolved KPI — definition + current value + previous value + target. */
export interface KpiWithValue extends KpiDefinition {
  value: number | null;            // null = not available this period
  previous_value: number | null;   // null = no prior snapshot
  target: number | null;           // from client_onboarding.primary_kpis when matching
  delta: number | null;            // value - previous_value
  delta_pct: number | null;        // pct change (delta / previous_value × 100)
  is_estimate: boolean;            // true when the number is inferred (e.g. DFS traffic estimate)
  warning?: string;                // e.g. "conecta GA4 para valores reales"
}

/** Availability flags to pick the right KPI preset. */
export interface Availability {
  has_ga4: boolean;
  has_gsc: boolean;
  has_gbp: boolean;
  has_ad_spend: boolean;        // client provided monthly_ad_spend
  has_deal_value: boolean;      // client provided avg_deal_value
}

export type ManualMetricKey = 'leads' | 'sales_count' | 'revenue' | 'activations' | 'bookings';

export interface ManualBusinessInput {
  id: string;
  client_id: string;
  month: string;                // YYYY-MM-01
  metric_key: ManualMetricKey;
  value: number;
  notes?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}
