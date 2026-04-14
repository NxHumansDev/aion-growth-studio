import type {
  ScoreResult, ScoreBreakdown, ScoreComputation, ModuleResult,
  CrawlResult, SSLResult, PageSpeedResult,
  GeoResult, GBPResult,
  LinkedInResult, TechStackResult, ConversionResult, SEOResult,
} from '../types';
import { resolveProfile } from '../../benchmarks/resolve-profile';
import { getProfile } from '../../benchmarks/profiles';
import { getGeoMultipliers } from '../../benchmarks/geo-multipliers';
import {
  logScore, logScoreWithMultiplier, steppedScore, ratingToScore,
  resolveThresholds, weightedTotal,
} from '../../benchmarks/score-with-profile';

export async function runScore(
  results: Record<string, ModuleResult>,
  onboarding?: { business_profile?: string | null; geo_scope?: string | null } | null,
): Promise<ScoreResult> {
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
  const instagram  = (results.instagram  || {}) as any;
  const cc         = (results.content_cadence || {}) as any;
  const sectorRes  = (results.sector     || {}) as any;
  const isCrawlerBlocked = !!(crawl as any).crawlerBlocked;

  // ── Resolve benchmark profile + geo scope ────────────────────────
  // Priority: confirmed onboarding → sector.ts inference → fallback.
  const resolved = resolveProfile({
    onboarding: onboarding || null,
    sectorResult: {
      businessProfile: sectorRes.businessProfile,
      geoScope: sectorRes.geoScope,
      confidence: sectorRes.confidence,
    },
  });
  const profile = getProfile(resolved.profile);
  const multipliers = getGeoMultipliers(resolved.geoScope);
  const th = resolveThresholds(profile, multipliers);

  const computation: ScoreComputation = {
    weights: {
      base: profile.weights,
      effective: {},
      inactivePillars: [],
    },
    totalFormula: '',
    profile: {
      profile: resolved.profile,
      geoScope: resolved.geoScope,
      source: resolved.source,
      confidence: resolved.confidence,
    },
  } as any;

  // ── Pilar 1: SEO orgánico ─────────────────────────────────────────
  let seoScore: number | null = null;

  if (!seo.skipped && (seo.keywordsTop10 != null || seo.organicTrafficEstimate != null)) {
    const kw  = seo.keywordsTop10 ?? 0;
    const etv = seo.organicTrafficEstimate ?? 0;

    const kwScore      = logScore(kw, th.keywordsTop10Ceiling);
    const trafficScore = logScore(etv, th.trafficCeiling);

    let s = Math.round(kwScore * 0.6 + trafficScore * 0.4);

    const top3 = seo.keywordsTop3 ?? 0;
    let top3Bonus = 0;
    if (top3 > 0 && kw > 0) {
      top3Bonus = Math.round((top3 / kw) * 10);
      s = Math.min(100, s + top3Bonus);
    }

    seoScore = s;
    computation.seo = {
      kwCount: kw,
      kwScore,
      traffic: etv,
      trafficScore,
      top3,
      top3Bonus,
      formula: `kwScore(${kw} kw → ${kwScore}, ceiling ${th.keywordsTop10Ceiling}) × 0.6 + trafficScore(${etv} visits → ${trafficScore}, ceiling ${th.trafficCeiling}) × 0.4${top3Bonus > 0 ? ` + top3Bonus(${top3}/${kw} → +${top3Bonus})` : ''} = ${s}`,
      final: s,
    } as any;
  }

  // ── Pilar 2: GEO / visibilidad IA ─────────────────────────────────
  let geoScore: number | null = null;
  if (!geo.skipped && geo.mentionRate != null) {
    geoScore = geo.mentionRate;
    computation.geo = {
      mentionRate: geo.mentionRate,
      overallScore: geo.overallScore ?? null,
      source: 'mentionRate',
      final: geoScore,
    };
  } else if (!geo.skipped && geo.overallScore != null) {
    geoScore = geo.overallScore;
    computation.geo = {
      mentionRate: null,
      overallScore: geo.overallScore,
      source: 'overallScore',
      final: geoScore,
    };
  }

  // ── Pilar 3: Web & técnico ───────────────────────────────────────
  const psScore = pagespeed.mobile?.performance ?? 0;
  const techCheckDefs = isCrawlerBlocked
    ? [
        { label: 'SSL válido', points: 50, applied: !ssl.skipped && !!ssl.valid },
        { label: 'Sitemap.xml', points: 30, applied: !!crawl.hasSitemap },
        { label: 'Robots.txt', points: 20, applied: !!crawl.hasRobotsTxt },
      ]
    : [
        { label: 'SSL válido', points: 25, applied: !ssl.skipped && !!ssl.valid },
        { label: 'Canonical tags', points: 20, applied: !!crawl.hasCanonical },
        { label: 'Schema markup', points: 30, applied: !!crawl.hasSchemaMarkup },
        { label: 'Sitemap.xml', points: 20, applied: !!crawl.hasSitemap },
        { label: 'Robots.txt', points: 5, applied: !!crawl.hasRobots },
      ];
  const techChecks = techCheckDefs.reduce((s, c) => s + (c.applied ? c.points : 0), 0);
  const webScore = Math.min(100, Math.round(psScore * 0.7 + techChecks * 0.3));
  computation.web = {
    pagespeedMobile: psScore,
    techChecks: techCheckDefs,
    techChecksTotal: techChecks,
    formula: `pagespeed(${psScore}) × 0.7 + techChecks(${techChecks}/100) × 0.3 = ${webScore}${isCrawlerBlocked ? ' [checks limitados: crawler bloqueado]' : ''}`,
    final: webScore,
  };

  // ── Pilar 4: Conversión ───────────────────────────────────────────
  const conversionScore = isCrawlerBlocked ? null : Math.min(100, conversion.funnelScore ?? 20);
  computation.conversion = {
    funnelScore: isCrawlerBlocked ? 0 : (conversion.funnelScore ?? 20),
    final: conversionScore ?? 0,
  };

  // ── Pilar 5: Reputación ───────────────────────────────────────────
  const repComponents: Array<{ label: string; value: number; weight: number }> = [];

  if (gbp.rating != null) {
    const ratingScore = ratingToScore(gbp.rating);
    const reviewBonus = Math.min(15, logScore(gbp.reviewCount ?? 0, th.gbpReviewsCeiling) * 0.15);
    repComponents.push({
      label: `GBP rating ${gbp.rating}★ (${gbp.reviewCount ?? 0} reseñas)`,
      value: Math.min(100, ratingScore + reviewBonus),
      weight: 0.25,
    });
  } else if (reputation.combinedRating != null) {
    const ratingScore = ratingToScore(reputation.combinedRating);
    repComponents.push({
      label: `Rating combinado ${reputation.combinedRating}★`,
      value: ratingScore,
      weight: 0.25,
    });
  }

  // Press — stepped score against profile thresholds (quarterly)
  const pressCount = reputation.newsCount ?? 0;
  if (pressCount > 0 || gbp.found || reputation.reputationLevel) {
    const pressVal = steppedScore(pressCount, th.pressThresholds);
    repComponents.push({
      label: `Prensa (${pressCount} menciones)`,
      value: pressVal,
      weight: 0.20,
    });
  }

  // Blog posts per month — stepped against profile thresholds
  const hasBlog = !!(crawl.hasBlog || (cc.totalPosts ?? 0) >= 1);
  if (hasBlog) {
    const postsLast90 = cc.postsLast90Days ?? 0;
    const postsPerMonth = postsLast90 / 3;
    const blogVal = steppedScore(postsPerMonth, th.blogThresholds);
    repComponents.push({
      label: `Blog (${postsLast90} posts 90d)`,
      value: blogVal,
      weight: 0.15,
    });
  }

  if (!linkedin.skipped && linkedin.found && (linkedin.followers ?? 0) > 0) {
    const liVal = logScore(linkedin.followers!, th.linkedinCeiling);
    repComponents.push({
      label: `LinkedIn (${linkedin.followers} seguidores)`,
      value: liVal,
      weight: 0.15,
    });
  }

  if (!instagram.skipped && instagram.found && (instagram.followers ?? 0) > 0) {
    const igVal = logScore(instagram.followers!, th.instagramCeiling);
    repComponents.push({
      label: `Instagram (${instagram.followers} seguidores)`,
      value: igVal,
      weight: 0.15,
    });
  }

  if (techstack.maturityScore != null && techstack.maturityScore > 0) {
    repComponents.push({ label: `Techstack maturity`, value: techstack.maturityScore, weight: 0.10 });
  }

  let reputationScore: number | null = null;
  if (repComponents.length > 0) {
    const totalW = repComponents.reduce((s, c) => s + c.weight, 0);
    reputationScore = Math.min(100, Math.round(
      repComponents.reduce((s, c) => s + c.value * c.weight, 0) / totalW,
    ));
    computation.reputation = {
      components: repComponents,
      totalWeight: Math.round(totalW * 100) / 100,
      formula: repComponents.map(c => `${c.label}(${c.value}) × ${c.weight}`).join(' + ') + ` = ${reputationScore}`,
      final: reputationScore,
    };
  }

  // ── Weighted total — uses profile.weights ────────────────────────
  const pillars: Array<{ key: keyof typeof profile.weights; value: number | null }> = [
    { key: 'seo',        value: seoScore },
    { key: 'geo',        value: geoScore },
    { key: 'web',        value: webScore },
    { key: 'conversion', value: conversionScore },
    { key: 'reputation', value: reputationScore },
  ];

  const { total, effective } = weightedTotal(pillars, profile.weights);
  const inactive = pillars.filter(p => p.value == null || p.value <= 0).map(p => p.key as string);

  computation.weights.effective = effective as any;
  computation.weights.inactivePillars = inactive;
  computation.totalFormula = `[${resolved.profile}/${resolved.geoScope}] ` +
    `(${pillars.filter(p => p.value != null && p.value > 0).map(p => `${p.key} ${p.value} × ${profile.weights[p.key]}`).join(' + ')}) = ${total}`;

  // ── Content pillar (informational) ───────────────────────────────
  const { computeContentScore } = await import('../content-score');
  const contentScore = computeContentScore(
    { postsLast90Days: cc.postsLast90Days, lastPostDate: cc.lastPostDate, daysSinceLastPost: cc.daysSinceLastPost },
    { found: instagram.found, postsLast90Days: instagram.postsLast90Days, lastPostDate: instagram.lastPostDate, engagementRate: instagram.engagementRate, followers: instagram.followers },
    { found: linkedin.found, followers: linkedin.followers, postsLast90Days: linkedin.postsLast90Days, lastPostDate: linkedin.lastPostDate },
    sectorRes.sector,
  );

  const breakdown: ScoreBreakdown = {
    seo:        seoScore ?? 0,
    geo:        geoScore ?? 0,
    web:        webScore,
    conversion: conversionScore ?? 0,
    reputation: reputationScore ?? 0,
  };

  const result: ScoreResult = { total, breakdown, content: contentScore, computation };

  if (isCrawlerBlocked) {
    (result as any).crawlerBlocked = true;
    (result as any).crawlerNote = `Score calculado sobre los pilares accesibles — las secciones que dependen del HTML (${inactive.join(', ') || 'ninguna'}) no se incluyen porque el sitio bloqueó el acceso al crawler.`;
  }

  return result;
}
