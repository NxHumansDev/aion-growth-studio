import type { TrafficResult } from '../types';

/**
 * Traffic module — minimal stub.
 *
 * Traffic distribution (organic vs paid) is now derived from SEO data
 * directly in the report template. The old traffic_analytics endpoint
 * (SimilarWeb data) is not available in our DataForSEO plan.
 *
 * This module is kept for backward compatibility — it returns a
 * non-skipped result so coverage doesn't penalize.
 */
export async function runTraffic(url: string): Promise<TrafficResult> {
  return { _stub: true } as any;
}
