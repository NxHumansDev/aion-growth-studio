/**
 * Contextual benchmarks — types.
 *
 * The scoring system must adapt to the business reality: a freelancer with
 * 800 Instagram followers is in a very different place than a B2C ecommerce
 * with 800. Rather than using global thresholds, every client is classified
 * into one of 8 business profiles, and the thresholds used to compute each
 * pillar's score come from that profile (optionally scaled by geo scope).
 */

export type BusinessProfile =
  | 'freelance'                 // independent consultant, lawyer, coach, designer (personal brand)
  | 'professional-services'     // agency, law firm, consultancy (small/mid company, not a person)
  | 'saas'                      // software, platform, app, digital tool
  | 'ecommerce'                 // B2C online store
  | 'local-single'              // physical business with 1 location (restaurant, clinic, shop)
  | 'local-chain'               // chain, franchise, multi-location
  | 'media-education'           // monetized blog, online academy, publisher, training
  | 'nonprofit-institutional';  // NGO, foundation, association, institution

export type GeoScope =
  | 'local'           // city / district (maps from client_onboarding.geo_scope = 'local_city')
  | 'national'        // single country (default / base multiplier = 1.0)
  | 'regional-multi'  // several countries, Europe, LATAM (maps from 'multi_country')
  | 'global';         // worldwide (maps from 'global')

/**
 * A single metric's thresholds. Values are the "ceiling" or breakpoint that
 * represents a strong result for THIS profile — the scoring function
 * transforms the raw value onto 0-100 using these as reference points.
 *
 * For logarithmic metrics (followers, traffic, keywords) only `ceiling` is
 * used: the raw value that maps to 100. For stepped metrics (posts/month,
 * press mentions) the consumer reads `strong | good | ok | weak`.
 */
export interface MetricThresholds {
  ceiling?: number;            // log-scale: raw value that maps to 100
  strong?: number;             // stepped: >= strong → 100
  good?: number;               // stepped: >= good → 70
  ok?: number;                 // stepped: >= ok → 40
  weak?: number;               // stepped: >= weak → 20 (below this → near 0)
}

/**
 * All per-metric thresholds used across the scoring pipeline.
 * Every hardcoded number in score.ts should be reachable through this.
 */
export interface ProfileThresholds {
  // SEO pillar
  keywordsTop10: MetricThresholds;       // log ceiling — what "100" means for kw in top10
  organicTrafficMonthly: MetricThresholds; // log ceiling — visits/month

  // Reputation pillar
  instagramFollowers: MetricThresholds;  // log ceiling
  linkedinFollowers: MetricThresholds;   // log ceiling
  pressMentionsQuarterly: MetricThresholds; // stepped — press/news items in last 90d
  blogPostsPerMonth: MetricThresholds;   // stepped — posts per month
  gbpReviews: MetricThresholds;          // log ceiling — review count for bonus

  // Content / engagement
  instagramEngagementRate: MetricThresholds; // stepped — ER %
  linkedinEngagementRate: MetricThresholds;  // stepped — ER %
}

/**
 * Relative pillar weights for a given profile. Missing pillars are
 * redistributed proportionally at score-time, so these are the "base"
 * priorities. Weights don't have to sum to 1.0 — they get normalized.
 *
 * Examples:
 * - ecommerce: conversion matters more (0.25) than for a freelancer (0.10)
 * - freelance: reputation matters a lot (0.25); conversion less (0.10)
 */
export interface PillarWeights {
  seo: number;
  geo: number;
  web: number;
  conversion: number;
  reputation: number;
}

/**
 * Playbook — what the scoring narrative and the agent should consider for
 * this profile. Drives the LLM prompt's "valora esto, ignora aquello".
 */
export interface ProfilePlaybook {
  label: string;                        // human-readable name in Spanish
  description: string;                  // 1-sentence definition for the agent
  valueSignals: string[];               // KPIs that MATTER for this profile (what good looks like)
  ignoreSignals: string[];              // what NOT to evaluate or penalize
  exampleClients: string[];             // real-world examples to ground the LLM
}

/**
 * The full benchmark profile. One per BusinessProfile value.
 */
export interface BenchmarkProfile {
  profile: BusinessProfile;
  weights: PillarWeights;
  thresholds: ProfileThresholds;
  playbook: ProfilePlaybook;
}

/**
 * Geo multipliers applied on top of the profile thresholds.
 * A global SaaS expects 5× the traffic of a national SaaS, etc.
 * Applied only to thresholds that make sense to scale — not to ER or ratings.
 */
export interface GeoMultipliers {
  scope: GeoScope;
  traffic: number;      // for organicTrafficMonthly
  social: number;       // for instagramFollowers, linkedinFollowers
  seo: number;          // for keywordsTop10
  reputation: number;   // for pressMentionsQuarterly, gbpReviews
  content: number;      // for blogPostsPerMonth (unchanged mostly)
}

/**
 * Output of resolve-profile.ts. Tells the rest of the pipeline what
 * benchmark context to use and where the resolution came from.
 */
export interface ResolvedProfile {
  profile: BusinessProfile;
  geoScope: GeoScope;
  source: 'onboarding' | 'sector-inference' | 'fallback';
  confidence: number;     // 0-1
}
