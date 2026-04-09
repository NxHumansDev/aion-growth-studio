/**
 * Analytics ingestion — fetches GA4 + GSC data for a client
 * and returns a combined analytics object for pipeline_output.
 *
 * Called during the weekly Radar run if the client has Google connected.
 */

import { getIntegration, getValidAccessToken } from '../integrations';
import { fetchGA4Data, type GA4Report } from './fetch-ga4';
import { fetchGSCData, type GSCReport } from './fetch-gsc';

export interface AnalyticsData {
  ga4?: GA4Report;
  gsc?: GSCReport;
  source: 'google_analytics';
  fetchedAt: string;
  dataQualityScore?: number;
}

/**
 * Fetch analytics data for a client if they have Google connected.
 * Returns null if not connected or if fetching fails.
 */
export async function ingestAnalytics(clientId: string, domain: string): Promise<AnalyticsData | null> {
  const integration = await getIntegration(clientId, 'google_analytics');
  if (!integration || integration.status !== 'connected') return null;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(integration);
  } catch (err) {
    console.error(`[analytics] Token refresh failed for ${domain}:`, (err as Error).message);
    return null;
  }

  const result: AnalyticsData = {
    source: 'google_analytics',
    fetchedAt: new Date().toISOString(),
  };

  // GA4 — only if property is selected
  if (integration.property_id) {
    try {
      result.ga4 = await fetchGA4Data(integration.property_id, accessToken);
      console.log(`[analytics] GA4 OK for ${domain}: ${result.ga4.sessions} sessions, ${result.ga4.conversions} conversions`);
    } catch (err) {
      console.error(`[analytics] GA4 failed for ${domain}:`, (err as Error).message);
    }
  }

  // GSC — uses domain directly
  try {
    result.gsc = await fetchGSCData(domain, accessToken);
    console.log(`[analytics] GSC OK for ${domain}: ${result.gsc.totalClicks} clicks, ${result.gsc.topQueries.length} queries`);
  } catch (err) {
    console.error(`[analytics] GSC failed for ${domain}:`, (err as Error).message);
  }

  // Data quality score
  result.dataQualityScore = computeDataQualityScore(result);

  return (result.ga4 || result.gsc) ? result : null;
}

/**
 * Compute a 0-100 data quality score based on what's available and how it looks.
 */
function computeDataQualityScore(data: AnalyticsData): number {
  let score = 0;
  let checks = 0;

  if (data.ga4) {
    checks += 5;
    // Has sessions? (basic sanity)
    if (data.ga4.sessions > 0) score += 15;
    // Has conversions configured?
    if (data.ga4.conversions > 0) score += 20;
    else score += 5; // Penalty but not zero
    // Reasonable bounce rate (not 0% or 100% which indicates misconfiguration)
    if (data.ga4.bounceRate > 5 && data.ga4.bounceRate < 95) score += 15;
    // Has traffic sources (not all direct = probably no UTM tracking)
    const directPct = data.ga4.trafficSources.find(s => s.source === '(direct)')?.pct || 0;
    if (directPct < 80) score += 15;
    else score += 5;
    // Has enough data (>10 sessions/week minimum)
    if (data.ga4.sessions >= 10) score += 10;
  }

  if (data.gsc) {
    checks += 2;
    if (data.gsc.totalClicks > 0) score += 15;
    if (data.gsc.topQueries.length >= 5) score += 10;
  }

  if (checks === 0) return 0;
  return Math.min(100, score);
}
