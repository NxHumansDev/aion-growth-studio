import type {
  ScoreResult, ScoreBreakdown, ModuleResult,
  CrawlResult, SSLResult, PageSpeedResult, ContentResult,
  GeoResult, GBPResult, TrafficResult, InstagramResult,
  LinkedInResult, TechStackResult, ConversionResult, SEOResult,
} from '../types';

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

  // ── Pilar 1: Fundamentos técnicos (15%) ─────────────────────────
  let technical = 30; // baseline — site is live
  if (!ssl.skipped && ssl.valid) technical += 20;
  if (crawl.hasCanonical) technical += 10;
  if (crawl.hasSchemaMarkup) technical += 15;
  if (crawl.hasSitemap) technical += 10;
  if (crawl.hasRobots) technical += 5;
  if (!pagespeed.skipped && pagespeed.mobile) {
    if (pagespeed.mobile.performance >= 90) technical += 10;
    else if (pagespeed.mobile.performance >= 50) technical += 5;
  }
  technical = Math.min(100, technical);

  // ── Pilar 2: Visibilidad orgánica (25%) ─────────────────────────
  let seoVisibility = 15; // baseline — site exists
  if (!seo.skipped && seo.domainRank != null) {
    // Domain rank 0-100 → up to 40 pts
    seoVisibility += Math.round(seo.domainRank * 0.4);
    // Keyword top-10 volume
    const top10 = seo.keywordsTop10 ?? 0;
    if (top10 >= 100)   seoVisibility += 20;
    else if (top10 >= 20)  seoVisibility += 12;
    else if (top10 >= 5)   seoVisibility += 6;
    else if (top10 >= 1)   seoVisibility += 2;
    // Organic traffic estimate
    const etv = seo.organicTrafficEstimate ?? 0;
    if (etv >= 10000)  seoVisibility += 20;
    else if (etv >= 2000)  seoVisibility += 12;
    else if (etv >= 500)   seoVisibility += 6;
    else if (etv >= 50)    seoVisibility += 2;
    // Referring domains (link authority proxy)
    const rd = seo.referringDomains ?? 0;
    if (rd >= 200)    seoVisibility += 20;
    else if (rd >= 50)    seoVisibility += 12;
    else if (rd >= 10)    seoVisibility += 6;
    else if (rd >= 3)     seoVisibility += 2;
  } else if (!traffic.skipped && traffic.visits) {
    // Fallback: Similarweb total visits (annual) as traffic proxy
    if (traffic.visits >= 240000) seoVisibility += 40;
    else if (traffic.visits >= 60000)  seoVisibility += 25;
    else if (traffic.visits >= 12000)  seoVisibility += 12;
    else if (traffic.visits >= 1200)   seoVisibility += 5;
  }
  // GEO score adds up to 10 pts (brand is visible to AI = helps discoverability)
  if (!geo.skipped && geo.overallScore) {
    seoVisibility += Math.round(geo.overallScore * 0.10);
  }
  seoVisibility = Math.min(100, seoVisibility);

  // ── Pilar 3: Contenido y propuesta de valor (20%) ───────────────
  let contentScore = 50; // fallback
  if (!content.skipped && content.clarity != null) {
    contentScore = content.clarity;
  }

  // ── Pilar 4: Presencia social y reputación (15%) ────────────────
  let socialReputation = 10; // baseline
  if (!instagram.skipped && instagram.found === true) {
    const followers = instagram.followers ?? 0;
    if (followers > 50000)     socialReputation += 20;
    else if (followers > 5000) socialReputation += 14;
    else if (followers > 500)  socialReputation += 8;
    else                       socialReputation += 4;
    const er = instagram.engagementRate ?? 0;
    if (er >= 3)      socialReputation += 15;
    else if (er >= 1) socialReputation += 8;
    else              socialReputation += 2;
  }
  if (!linkedin.skipped && linkedin.found === true) {
    const liFollowers = linkedin.followers ?? 0;
    if (liFollowers > 5000)     socialReputation += 15;
    else if (liFollowers > 500) socialReputation += 8;
    else if (linkedin.url)      socialReputation += 4;
  }
  if (!gbp.skipped && gbp.found) {
    socialReputation += 15;
    const rating = gbp.rating ?? 0;
    if (rating >= 4.5)      socialReputation += 10;
    else if (rating >= 4.0) socialReputation += 5;
    const reviews = gbp.reviewCount ?? 0;
    if (reviews >= 100)    socialReputation += 5;
    else if (reviews >= 20) socialReputation += 2;
  }
  socialReputation = Math.min(100, socialReputation);

  // ── Pilar 5: Capacidad de conversión (15%) ──────────────────────
  const conversionScore = Math.min(100, conversion.funnelScore ?? 20);

  // ── Pilar 6: Datos y medición (10%) ─────────────────────────────
  const measurementScore = Math.min(100, techstack.maturityScore ?? 20);

  // ── Weighted total ───────────────────────────────────────────────
  // Weights: 15% + 25% + 20% + 15% + 15% + 10% = 100%
  const total = Math.round(
    technical       * 0.15 +
    seoVisibility   * 0.25 +
    contentScore    * 0.20 +
    socialReputation * 0.15 +
    conversionScore * 0.15 +
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
