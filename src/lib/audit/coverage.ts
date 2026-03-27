import type { ModuleResult } from './types';

/**
 * Data coverage evaluation.
 * Counts individual data points, not just modules.
 * Competitor data points are counted per-competitor.
 */

interface DataPoint {
  id: string;
  label: string;
  critical: boolean;
  check: (r: Record<string, any>) => boolean;
}

const DATA_POINTS: DataPoint[] = [
  // ── Brand data (25 points) ──
  { id: 'crawl.html', label: 'HTML crawl', critical: true, check: r => r.crawl?.loadedOk === true },
  { id: 'crawl.title', label: 'Title + description', critical: false, check: r => !!r.crawl?.title },
  { id: 'ssl.valid', label: 'SSL certificate', critical: true, check: r => r.ssl && !r.ssl.skipped },
  { id: 'pagespeed.mobile', label: 'PageSpeed mobile', critical: true, check: r => r.pagespeed?.mobile?.performance != null },
  { id: 'pagespeed.desktop', label: 'PageSpeed desktop', critical: false, check: r => r.pagespeed?.desktop?.performance != null },
  { id: 'sector.detected', label: 'Sector detection', critical: true, check: r => !!r.sector?.sector },
  { id: 'seo.keywords', label: 'SEO keywords', critical: true, check: r => r.seo && !r.seo.skipped && r.seo.keywordsTop10 != null },
  { id: 'seo.traffic', label: 'Organic traffic', critical: true, check: r => r.seo?.organicTrafficEstimate != null },
  { id: 'seo.domainRank', label: 'Domain rank', critical: false, check: r => r.seo?.domainRank != null },
  { id: 'seo.topKeywords', label: 'Top keywords list', critical: false, check: r => (r.seo?.topKeywords?.length ?? 0) > 0 },
  { id: 'seo.history', label: 'Organic trend (12m)', critical: false, check: r => (r.seo?.organicHistory?.length ?? 0) >= 3 },
  { id: 'seo.brand', label: 'Brand vs non-brand', critical: false, check: r => r.seo?.brandTrafficPct != null },
  { id: 'traffic.channels', label: 'Traffic channels', critical: false, check: r => r.traffic && !r.traffic.skipped && r.traffic.visits > 0 },
  { id: 'content.analysis', label: 'Content analysis', critical: false, check: r => r.content && !r.content.skipped },
  { id: 'content.blog', label: 'Blog detection', critical: false, check: r => r.content_cadence && !r.content_cadence.skipped },
  { id: 'conversion.funnel', label: 'Conversion funnel', critical: true, check: r => r.conversion && !r.conversion.skipped && r.conversion.funnelScore != null },
  { id: 'techstack.maturity', label: 'Tech stack', critical: true, check: r => r.techstack && !r.techstack.skipped },
  { id: 'reputation.rating', label: 'Reputation rating', critical: false, check: r => r.reputation?.combinedRating != null || r.reputation?.gbpRating != null },
  { id: 'reputation.news', label: 'News coverage', critical: false, check: r => (r.reputation?.newsCount ?? 0) > 0 || r.reputation?.newsHeadlines?.length > 0 },
  { id: 'geo.queries', label: 'AI visibility queries', critical: true, check: r => (r.geo?.queries?.length ?? 0) >= 10 },
  { id: 'geo.mentionRate', label: 'AI mention rate', critical: true, check: r => r.geo?.mentionRate != null },
  { id: 'geo.categories', label: 'AI category breakdown', critical: false, check: r => Object.keys(r.geo?.categoryBreakdown ?? {}).length >= 3 },
  { id: 'geo.narrative', label: 'AI executive narrative', critical: false, check: r => !!r.geo?.executiveNarrative },
  { id: 'score.total', label: 'Health score', critical: true, check: r => r.score?.total != null },
  { id: 'insights.bullets', label: 'Executive insights', critical: true, check: r => (r.insights?.bullets?.length ?? 0) >= 1 },

  // ── Competitor data (per competitor — dynamically counted) ──
  { id: 'competitors.identified', label: 'Competitors identified', critical: true, check: r => (r.competitors?.competitors?.length ?? 0) >= 2 },
  { id: 'competitor_traffic.data', label: 'Competitor SEO data', critical: true, check: r => {
    const items = r.competitor_traffic?.items || [];
    const valid = items.filter((c: any) => !c.apiError && c.keywordsTop10 != null);
    return valid.length >= 2;
  }},
  { id: 'keyword_gap.items', label: 'Keyword gap analysis', critical: false, check: r => r.keyword_gap && !r.keyword_gap.skipped },
  { id: 'geo.compMentions', label: 'Competitor AI mentions', critical: false, check: r => (r.geo?.competitorMentions?.length ?? 0) >= 1 },
  { id: 'social.linkedin', label: 'LinkedIn data', critical: false, check: r => r.linkedin?.found === true },
  { id: 'social.instagram', label: 'Instagram data', critical: false, check: r => r.instagram?.found === true },
];

export interface CoverageResult {
  totalPoints: number;
  successfulPoints: number;
  coveragePct: number;
  criticalTotal: number;
  criticalOk: number;
  criticalMissing: string[];
  allMissing: string[];
  meetsThreshold: boolean;
}

export function evaluateCoverage(results: Record<string, any>): CoverageResult {
  let successful = 0;
  let criticalOk = 0;
  let criticalTotal = 0;
  const allMissing: string[] = [];
  const criticalMissing: string[] = [];

  for (const dp of DATA_POINTS) {
    if (dp.critical) criticalTotal++;
    try {
      if (dp.check(results)) {
        successful++;
        if (dp.critical) criticalOk++;
      } else {
        allMissing.push(dp.label);
        if (dp.critical) criticalMissing.push(dp.label);
      }
    } catch {
      allMissing.push(dp.label);
      if (dp.critical) criticalMissing.push(dp.label);
    }
  }

  const coveragePct = Math.round((successful / DATA_POINTS.length) * 100);

  return {
    totalPoints: DATA_POINTS.length,
    successfulPoints: successful,
    coveragePct,
    criticalTotal,
    criticalOk,
    criticalMissing,
    allMissing,
    meetsThreshold: coveragePct >= 90 && criticalMissing.length <= 2,
  };
}

/** Get module names that should be retried for missing critical data */
export function getRetryModules(results: Record<string, any>): string[] {
  const retry = new Set<string>();

  for (const dp of DATA_POINTS) {
    if (!dp.critical) continue;
    try { if (dp.check(results)) continue; } catch { /* missing */ }

    // Map data point to module name
    const mod = dp.id.split('.')[0];
    if (mod === 'crawl' || mod === 'score' || mod === 'insights') continue; // can't retry these independently
    if (mod === 'competitor_traffic' || mod === 'competitors') { retry.add('competitor_traffic'); retry.add('competitors'); }
    else retry.add(mod);
  }

  return [...retry];
}
