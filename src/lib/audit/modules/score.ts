import type {
  ScoreResult, ScoreBreakdown, ModuleResult,
  CrawlResult, SSLResult, PageSpeedResult,
  GeoResult, GBPResult, TrafficResult,
  LinkedInResult, TechStackResult, ConversionResult, SEOResult,
} from '../types';

/**
 * Logarithmic scale — values the journey, not absolute position.
 * ceiling is the value that maps to 100.
 * Examples with ceiling=2000: 10→32, 69→56, 500→82, 2000→100
 * Examples with ceiling=5_000_000: 1K→43, 7K→55, 50K→67, 500K→81
 */
function logScore(value: number, ceiling: number): number {
  if (value <= 0) return 0;
  return Math.min(100, Math.round(
    (Math.log10(value + 1) / Math.log10(ceiling + 1)) * 100,
  ));
}

export async function runScore(results: Record<string, ModuleResult>): Promise<ScoreResult> {
  const crawl      = (results.crawl      || {}) as CrawlResult;
  const ssl        = (results.ssl        || {}) as SSLResult;
  const pagespeed  = (results.pagespeed  || {}) as PageSpeedResult;
  const geo        = (results.geo        || {}) as GeoResult;
  const gbp        = (results.gbp        || {}) as GBPResult;
  const seo        = (results.seo        || {}) as SEOResult;
  const linkedin   = (results.linkedin   || {}) as LinkedInResult;
  const techstack  = (results.techstack  || {}) as TechStackResult;
  const conversion = (results.conversion || {}) as ConversionResult;
  const reputation = (results.reputation || {}) as any;
  const cc         = (results.content_cadence || {}) as any;

  // ── Pilar 1: SEO orgánico (35%) — escala logarítmica ────────────
  // Logarithmic scale removes the cliff-edge from competitor comparison.
  // A domain with 69 kw gets ~56 (reasonable) not ~1 (penalized by Sabadell's 7K).
  let seoScore: number | null = null;

  if (!seo.skipped && (seo.keywordsTop10 != null || seo.organicTrafficEstimate != null)) {
    const kw  = seo.keywordsTop10 ?? 0;
    const etv = seo.organicTrafficEstimate ?? 0;

    const kwScore      = logScore(kw, 2000);        // 2000 kw = perfect
    const trafficScore = logScore(etv, 5_000_000);  // 5M visits/month = perfect

    let s = Math.round(kwScore * 0.6 + trafficScore * 0.4);

    // Top-3 bonus: strong positioning signals authority (up to +8 pts)
    const top3 = seo.keywordsTop3 ?? 0;
    if (top3 > 0 && kw > 0) {
      s = Math.min(100, s + Math.round((top3 / kw) * 10));
    }

    seoScore = s;
  }

  // ── Pilar 2: Visibilidad IA / GEO (25%) ─────────────────────────
  // mentionRate is already 0-100 (% of queries the brand is mentioned)
  let geoScore: number | null = null;
  if (!geo.skipped && geo.mentionRate != null) {
    geoScore = geo.mentionRate;
  } else if (!geo.skipped && geo.overallScore != null) {
    geoScore = geo.overallScore;
  }

  // ── Pilar 3: Web & técnico (15%) ─────────────────────────────────
  // PageSpeed is the dominant signal — users experience it directly.
  // Technical checks (SSL, schema, sitemap, canonical) add reliability bonus.
  const psScore = pagespeed.mobile?.performance ?? 0;
  let techChecks = 0;
  if (!ssl.skipped && ssl.valid)  techChecks += 25;
  if (crawl.hasCanonical)         techChecks += 20;
  if (crawl.hasSchemaMarkup)      techChecks += 30;
  if (crawl.hasSitemap)           techChecks += 20;
  if (crawl.hasRobots)            techChecks += 5;
  // PageSpeed 70% + technical checks 30%
  const webScore = Math.min(100, Math.round(psScore * 0.7 + techChecks * 0.3));

  // ── Pilar 4: Conversión (15%) ────────────────────────────────────
  const conversionScore = Math.min(100, conversion.funnelScore ?? 20);

  // ── Pilar 5: Reputación (10%) ─────────────────────────────────────
  // Composite from available signals. LinkedIn is graceful — if Apify
  // fails the score still runs, just slightly less precise.
  const repComponents: { value: number; weight: number }[] = [];

  // Domain authority (when available — not always indexed by backlink API)
  if (seo.domainRank != null && seo.domainRank > 0) {
    repComponents.push({ value: Math.min(100, seo.domainRank), weight: 0.25 });
  }

  // Google Business Profile rating
  if (gbp.rating != null) {
    // 2.0 → 0, 3.0 → 33, 4.0 → 67, 4.5 → 83, 5.0 → 100
    const ratingScore = Math.min(100, Math.max(0, Math.round((gbp.rating - 2) / 3 * 100)));
    const reviewBonus = Math.min(15, logScore(gbp.reviewCount ?? 0, 500) * 0.15);
    repComponents.push({ value: Math.min(100, ratingScore + reviewBonus), weight: 0.25 });
  } else if (reputation.combinedRating != null) {
    const ratingScore = Math.min(100, Math.max(0, Math.round((reputation.combinedRating - 2) / 3 * 100)));
    repComponents.push({ value: ratingScore, weight: 0.25 });
  }

  // Press / Google News
  const pressCount = reputation.newsCount ?? 0;
  if (pressCount > 0 || gbp.found || reputation.reputationLevel) {
    // 0→0, 3→40, 5→60, 10→80, 20+→100
    repComponents.push({ value: Math.min(100, pressCount * 8), weight: 0.20 });
  }

  // Blog activity — only include if blog detected (don't penalize for no blog)
  const hasBlog = !!(crawl.hasBlog || (cc.totalPosts ?? 0) >= 1);
  if (hasBlog) {
    const postsLast90 = cc.postsLast90Days ?? 0;
    const postsPerMonth = postsLast90 / 3;
    const blogScore = postsPerMonth >= 2 ? 100 : postsPerMonth >= 1 ? 70 : postsPerMonth >= 0.33 ? 40 : 20;
    repComponents.push({ value: blogScore, weight: 0.15 });
  }

  // LinkedIn followers — ONLY if scraped successfully (never penalizes if Apify fails)
  if (!linkedin.skipped && linkedin.found && (linkedin.followers ?? 0) > 0) {
    // <500→20, 1K→40, 5K→60, 10K→80, 50K+→100
    const liScore = logScore(linkedin.followers!, 50000);
    repComponents.push({ value: liScore, weight: 0.15 });
  }

  // Tech stack maturity feeds into reputation (measurement = trustworthiness signal)
  if (techstack.maturityScore != null && techstack.maturityScore > 0) {
    repComponents.push({ value: techstack.maturityScore, weight: 0.10 });
  }

  let reputationScore: number | null = null;
  if (repComponents.length > 0) {
    const totalW = repComponents.reduce((s, c) => s + c.weight, 0);
    reputationScore = Math.min(100, Math.round(
      repComponents.reduce((s, c) => s + c.value * c.weight, 0) / totalW,
    ));
  }

  // ── Weighted total with normalized weights ───────────────────────
  // Normalize so missing pillars don't penalize — they simply redistribute weight.
  const BASE_WEIGHTS = { seo: 0.35, geo: 0.25, web: 0.15, conversion: 0.15, reputation: 0.10 };

  const pillars: { key: keyof typeof BASE_WEIGHTS; value: number | null }[] = [
    { key: 'seo',        value: seoScore },
    { key: 'geo',        value: geoScore },
    { key: 'web',        value: webScore },          // always present
    { key: 'conversion', value: conversionScore },   // always present (defaults to 20)
    { key: 'reputation', value: reputationScore },
  ];

  const active = pillars.filter((p) => p.value !== null) as { key: keyof typeof BASE_WEIGHTS; value: number }[];
  const totalWeight = active.reduce((s, p) => s + BASE_WEIGHTS[p.key], 0);
  const total = totalWeight > 0
    ? Math.round(active.reduce((s, p) => s + p.value * BASE_WEIGHTS[p.key], 0) / totalWeight)
    : 0;

  // Guardrail: if we get 0 with real data, something is wrong — use simple mean
  if (total === 0 && active.length >= 2) {
    const mean = Math.round(active.reduce((s, p) => s + p.value, 0) / active.length);
    console.error('[SCORE BUG] Score 0 with data, using mean', JSON.stringify(active));
    return {
      total: mean,
      breakdown: {
        seo: seoScore ?? 0,
        geo: geoScore ?? 0,
        web: webScore,
        conversion: conversionScore,
        reputation: reputationScore ?? 0,
      },
    };
  }

  // ── Content pillar (informational — not in main total yet) ──────
  const { computeContentScore } = await import('../content-score');
  const instagram = (results.instagram || {}) as any;
  const contentScore = computeContentScore(
    { postsLast90Days: cc.postsLast90Days, lastPostDate: cc.lastPostDate, daysSinceLastPost: cc.daysSinceLastPost },
    { found: instagram.found, postsLast90Days: instagram.postsLast90Days, lastPostDate: instagram.lastPostDate, engagementRate: instagram.engagementRate, followers: instagram.followers },
    { found: linkedin.found, followers: linkedin.followers, postsLast90Days: linkedin.postsLast90Days, lastPostDate: linkedin.lastPostDate },
    (results.sector as any)?.sector,
  );

  const breakdown: ScoreBreakdown = {
    seo:        seoScore ?? 0,
    geo:        geoScore ?? 0,
    web:        webScore,
    conversion: conversionScore,
    reputation: reputationScore ?? 0,
  };

  return { total, breakdown, content: contentScore };
}
