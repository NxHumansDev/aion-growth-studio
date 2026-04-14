/**
 * Resolve which benchmark profile + geo scope to use for a given client.
 *
 * Priority cascade:
 *   1. client_onboarding.business_profile + geo_scope  — user confirmed
 *   2. sector.ts inference with confidence > 0.7       — auto-detected
 *   3. fallback: professional-services + national      — safe default
 *
 * The confirmed onboarding values always win, even if sector.ts disagrees.
 */

import type { BusinessProfile, GeoScope, ResolvedProfile } from './types';
import { ALL_PROFILE_KEYS } from './profiles';
import { normalizeGeoScope } from './geo-multipliers';

const VALID_PROFILES = new Set<string>(ALL_PROFILE_KEYS as string[]);

function isValidProfile(p: unknown): p is BusinessProfile {
  return typeof p === 'string' && VALID_PROFILES.has(p);
}

export interface ResolveProfileInput {
  onboarding?: {
    business_profile?: string | null;
    geo_scope?: string | null;
  } | null;
  sectorResult?: {
    businessProfile?: string;
    geoScope?: string;
    confidence?: number;
  } | null;
}

export function resolveProfile(input: ResolveProfileInput): ResolvedProfile {
  const { onboarding, sectorResult } = input;

  // 1. Explicit user confirmation in onboarding wins
  if (onboarding?.business_profile && isValidProfile(onboarding.business_profile)) {
    return {
      profile: onboarding.business_profile,
      geoScope: normalizeGeoScope(onboarding.geo_scope),
      source: 'onboarding',
      confidence: 1.0,
    };
  }

  // 2. Sector classifier inference (from sector.ts), if confident enough
  if (sectorResult?.businessProfile && isValidProfile(sectorResult.businessProfile)) {
    const conf = typeof sectorResult.confidence === 'number' ? sectorResult.confidence : 0;
    if (conf >= 0.7) {
      return {
        profile: sectorResult.businessProfile,
        geoScope: normalizeGeoScope(sectorResult.geoScope),
        source: 'sector-inference',
        confidence: conf,
      };
    }
  }

  // 3. Safe fallback
  return {
    profile: 'professional-services',
    geoScope: 'national',
    source: 'fallback',
    confidence: 0,
  };
}
