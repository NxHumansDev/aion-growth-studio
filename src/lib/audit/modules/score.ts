import type {
  ScoreResult, ScoreBreakdown, ModuleResult,
  CrawlResult, SSLResult, PageSpeedResult, ContentResult,
  GeoResult, GBPResult, TrafficResult, InstagramResult,
  LinkedInResult, TechStackResult, ConversionResult, SEOResult,
  SectorResult, SectorBenchmarks,
} from '../types';

/**
 * Score a metric relative to sector/competitor reference points.
 *
 * Scale:
 *   value = 0          →   0  (absent)
 *   value = low        →  25  (below average)
 *   value = median     →  50  (sector average)
 *   value = high       →  75  (top performer)
 *   value ≥ 2× high   → 100  (sector leader)
 */
function scoreVsReference(
  value: number,
  low: number,
  median: number,
  high: number,
): number {
  if (value <= 0) return 0;
  if (low <= 0) low = 1;
  if (value >= high * 2) return 100;
  if (value >= high)   return 75 + Math.round(((value - high) / high) * 25);
  if (value >= median) return 50 + Math.round(((value - median) / (high - median)) * 25);
  if (value >= low)    return 25 + Math.round(((value - low) / (median - low)) * 25);
  return Math.max(5, Math.round((value / low) * 25));
}

export async function runScore(results: Record<string, ModuleResult>): Promise<ScoreResult> {
  const crawl      = (results.crawl      || {}) as CrawlResult;
  const ssl        = (results.ssl        || {}) as SSLResult;
  const pagespeed  = (results.pagespeed  || {}) as PageSpeedResult;
  const content    = (results.content    || {}) as ContentResult;
  const geo        = (results.geo        || {}) as GeoResult;
  const gbp        = (results.gbp        || {}) as GBPResult;
  const traffic    = (results.traffic    || {}) as TrafficResult;
  const seo        = (results.seo        || {}) as SEOResult;
  const instagram  = (results.instagram  || {}) as InstagramResult;
  const linkedin   = (results.linkedin   || {}) as LinkedInResult;
  const techstack  = (results.techstack  || {}) as TechStackResult;
  const conversion = (results.conversion || {}) as ConversionResult;
  const sector     = (results.sector     || {}) as SectorResult;

  const bm: SectorBenchmarks | undefined = sector.benchmarks;

  // Competitor traffic items with real data (require >0 values — zero-data fake
  // competitors would inflate the client's score to 100 via scoreVsReference)
  const ctItems: any[] = ((results.competitor_traffic as any)?.items || []).filter(
    (c: any) => !c.apiError && ((c.organicTrafficEstimate ?? 0) > 0 || (c.keywordsTop10 ?? 0) > 0),
  );
  const hasCompetitors = ctItems.length > 0;
  const hasBenchmarks  = bm != null;

  // ── Pilar 1: Fundamentos técnicos (15%) ─────────────────────────
  let technical = 30; // baseline — site is live
  if (!ssl.skipped && ssl.valid) technical += 20;
  if (crawl.hasCanonical)    technical += 10;
  if (crawl.hasSchemaMarkup) technical += 15;
  if (crawl.hasSitemap)      technical += 10;
  if (crawl.hasRobots)       technical += 5;
  if (!pagespeed.skipped && pagespeed.mobile) {
    if      (pagespeed.mobile.performance >= 90) technical += 10;
    else if (pagespeed.mobile.performance >= 50) technical += 5;
  }
  technical = Math.min(100, technical);

  // ── Pilar 2: Visibilidad orgánica (25%) — contextual ────────────
  let seoVisibility = 0;

  if (!seo.skipped && (seo.keywordsTop10 != null || seo.organicTrafficEstimate != null)) {
    const kw  = seo.keywordsTop10 ?? 0;
    const etv = seo.organicTrafficEstimate ?? 0;

    let kwScore      = 0;
    let trafficScore = 0;

    if (hasCompetitors) {
      // ── A: Competitor-relative (most accurate) ───────────────────
      const compKW      = ctItems.map((c: any) => c.keywordsTop10 ?? 0);
      const compTraffic = ctItems.map((c: any) => c.organicTrafficEstimate ?? 0);
      const avgKW      = compKW.reduce((s, v) => s + v, 0) / compKW.length;
      const avgTraffic = compTraffic.reduce((s, v) => s + v, 0) / compTraffic.length;
      const maxKW      = Math.max(...compKW, 1);
      const maxTraffic = Math.max(...compTraffic, 1);

      kwScore      = scoreVsReference(kw,  avgKW * 0.5,      avgKW,      maxKW);
      trafficScore = scoreVsReference(etv, avgTraffic * 0.5, avgTraffic, maxTraffic);

    } else if (hasBenchmarks) {
      // ── B: Sector benchmark-relative ─────────────────────────────
      kwScore      = scoreVsReference(kw,  bm!.keywordsTop10.low,         bm!.keywordsTop10.median,         bm!.keywordsTop10.high);
      trafficScore = scoreVsReference(etv, bm!.organicTrafficMonthly.low, bm!.organicTrafficMonthly.median, bm!.organicTrafficMonthly.high);

    } else {
      // ── C: Legacy absolute fallback ───────────────────────────────
      if      (kw >= 1000) kwScore = 85;
      else if (kw >= 300)  kwScore = 70;
      else if (kw >= 100)  kwScore = 55;
      else if (kw >= 20)   kwScore = 40;
      else if (kw >= 5)    kwScore = 25;
      else if (kw >= 1)    kwScore = 10;

      if      (etv >= 10000) trafficScore = 80;
      else if (etv >= 2000)  trafficScore = 60;
      else if (etv >= 500)   trafficScore = 40;
      else if (etv >= 50)    trafficScore = 20;
    }

    // Keywords weight 60%, traffic 40% (keywords are more reliable signal)
    seoVisibility = Math.round(kwScore * 0.6 + trafficScore * 0.4);

    // Top-3 bonus: strong positioning signals authority (up to +8 pts)
    const top3 = seo.keywordsTop3 ?? 0;
    if (top3 > 0) {
      const top3Ratio = kw > 0 ? top3 / kw : 0;
      seoVisibility += Math.round(Math.min(8, top3Ratio * 16));
    }

    // GEO boost (up to +8 pts): brand visible in AI = discoverability signal
    if (!geo.skipped && geo.overallScore) {
      seoVisibility += Math.round(geo.overallScore * 0.08);
    }

    seoVisibility = Math.min(100, seoVisibility);

  } else if (!traffic.skipped && traffic.visits) {
    // No keyword data from DataForSEO SEO API — use DataForSEO Traffic Analytics as proxy
    const annualVisits = traffic.visits;
    if (hasBenchmarks) {
      const monthly = bm!.organicTrafficMonthly;
      seoVisibility = scoreVsReference(annualVisits / 12, monthly.low, monthly.median, monthly.high);
    } else {
      if      (annualVisits >= 240000) seoVisibility = 70;
      else if (annualVisits >= 60000)  seoVisibility = 50;
      else if (annualVisits >= 12000)  seoVisibility = 30;
      else                             seoVisibility = 15;
    }
  } else {
    seoVisibility = 15; // site exists but no visibility data
  }

  // ── Pilar 3: Contenido y propuesta de valor (20%) ───────────────
  const contentScore: number = (!content.skipped && content.clarity != null)
    ? content.clarity
    : 50;

  // ── Pilar 4: Presencia social y reputación (15%) — contextual ───
  let socialReputation = 10; // baseline

  // Instagram
  if (!instagram.skipped && instagram.found === true) {
    const followers = instagram.followers ?? 0;
    const igBm = bm?.instagramFollowers;

    if (igBm) {
      socialReputation += Math.round(scoreVsReference(followers, igBm.low, igBm.median, igBm.high) * 0.2);
    } else {
      if      (followers > 50000) socialReputation += 20;
      else if (followers > 5000)  socialReputation += 14;
      else if (followers > 500)   socialReputation += 8;
      else                        socialReputation += 4;
    }
    const er = instagram.engagementRate ?? 0;
    if      (er >= 3) socialReputation += 15;
    else if (er >= 1) socialReputation += 8;
    else              socialReputation += 2;
  }

  // LinkedIn
  if (!linkedin.skipped && linkedin.found === true) {
    const liFollowers = linkedin.followers ?? 0;
    const liBm = bm?.linkedinFollowers;

    if (liBm) {
      socialReputation += Math.round(scoreVsReference(liFollowers, liBm.low, liBm.median, liBm.high) * 0.15);
    } else {
      if      (liFollowers > 5000) socialReputation += 15;
      else if (liFollowers > 500)  socialReputation += 8;
      else if (linkedin.url)       socialReputation += 4;
    }
  }

  // Google Business Profile
  if (!gbp.skipped && gbp.found) {
    socialReputation += 15;
    const rating  = gbp.rating ?? 0;
    const reviews = gbp.reviewCount ?? 0;
    if      (rating >= 4.5) socialReputation += 10;
    else if (rating >= 4.0) socialReputation += 5;
    if      (reviews >= 100) socialReputation += 5;
    else if (reviews >= 20)  socialReputation += 2;
  }

  socialReputation = Math.min(100, socialReputation);

  // ── Pilar 5: Capacidad de conversión (15%) ──────────────────────
  const conversionScore = Math.min(100, conversion.funnelScore ?? 20);

  // ── Pilar 6: Datos y medición (10%) ─────────────────────────────
  const measurementScore = Math.min(100, techstack.maturityScore ?? 20);

  // ── Weighted total ───────────────────────────────────────────────
  // Weights: 15% + 25% + 20% + 15% + 15% + 10% = 100%
  const total = Math.round(
    technical        * 0.15 +
    seoVisibility    * 0.25 +
    contentScore     * 0.20 +
    socialReputation * 0.15 +
    conversionScore  * 0.15 +
    measurementScore * 0.10,
  );

  const breakdown: ScoreBreakdown = {
    technical,
    seoVisibility,
    content:          contentScore,
    socialReputation,
    conversion:       conversionScore,
    measurement:      measurementScore,
  };

  return { total, breakdown };
}
