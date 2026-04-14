/**
 * Geo scope multipliers.
 *
 * Applied on top of the profile thresholds from profiles.ts. A SaaS
 * selling globally needs 5× the traffic of a national SaaS to score the
 * same, so the "ceiling" that maps to 100 moves accordingly.
 *
 * Not every metric scales the same way:
 * - Traffic scales the hardest (global vs national is literally orders
 *   of magnitude of TAM)
 * - Social follower counts scale moderately
 * - Engagement rate and GBP rating don't scale at all (they're quality
 *   ratios, not volume)
 * - Press mentions scale less than followers (press cycles are finite
 *   per market)
 */

import type { GeoMultipliers, GeoScope } from './types';

export const GEO_MULTIPLIERS: Record<GeoScope, GeoMultipliers> = {
  local: {
    scope: 'local',
    traffic: 0.3,
    social: 0.3,
    seo: 0.3,
    reputation: 0.5,    // GBP reviews still matter; just smaller scale
    content: 0.6,
  },
  national: {
    scope: 'national',
    traffic: 1.0,       // base
    social: 1.0,
    seo: 1.0,
    reputation: 1.0,
    content: 1.0,
  },
  'regional-multi': {
    scope: 'regional-multi',
    traffic: 2.5,
    social: 2.0,
    seo: 2.0,
    reputation: 1.5,
    content: 1.2,
  },
  global: {
    scope: 'global',
    traffic: 5.0,
    social: 4.0,
    seo: 3.0,
    reputation: 2.0,
    content: 1.5,
  },
};

export function getGeoMultipliers(scope: GeoScope): GeoMultipliers {
  return GEO_MULTIPLIERS[scope] || GEO_MULTIPLIERS.national;
}

/**
 * Map the DB's client_onboarding.geo_scope string to the canonical GeoScope.
 * DB uses: 'local_city' | 'national' | 'multi_country' | 'global'
 * Module uses: 'local' | 'national' | 'regional-multi' | 'global'
 */
export function normalizeGeoScope(raw: string | null | undefined): GeoScope {
  if (!raw) return 'national';
  const map: Record<string, GeoScope> = {
    local_city: 'local',
    national: 'national',
    multi_country: 'regional-multi',
    global: 'global',
    // also accept the canonical form directly
    local: 'local',
    'regional-multi': 'regional-multi',
  };
  return map[raw] || 'national';
}
