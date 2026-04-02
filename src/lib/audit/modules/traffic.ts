import type { TrafficResult } from '../types';

/**
 * Traffic module — derives traffic estimate from SEO data.
 *
 * The old traffic_analytics endpoint (SimilarWeb data) is not available
 * in our DataForSEO plan. Traffic is estimated from organic SEO metrics
 * which are already fetched by the SEO module.
 *
 * This module runs in Phase 1 (before SEO data is available), so it
 * returns a marker. The report template reads traffic from SEO results.
 */
export async function runTraffic(_url: string): Promise<TrafficResult> {
  return {
    source: 'derived_from_seo',
    note: 'Traffic estimates derived from organic SEO data (DataForSEO). No SimilarWeb data available.',
  } as any;
}
