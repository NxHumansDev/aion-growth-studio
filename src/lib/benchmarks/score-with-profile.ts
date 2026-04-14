/**
 * Helpers that turn raw metrics into 0-100 pillar scores using the
 * resolved profile + geo-multiplier context.
 *
 * This is the single source of truth for every threshold that was
 * previously hardcoded in score.ts, db.ts and content-score.ts.
 *
 * Pure functions — no side effects, no I/O. Safe to call from the
 * pipeline runner and from the db.ts fallback alike.
 */

import type {
  BenchmarkProfile, GeoMultipliers, MetricThresholds, PillarWeights,
} from './types';

/**
 * Logarithmic score: 0 → 0, ceiling → 100. Mirrors the old logScore()
 * in score.ts so behaviour is identical when the ceiling matches the
 * old global value.
 */
export function logScore(value: number, ceiling: number): number {
  if (value <= 0 || ceiling <= 0) return 0;
  return Math.min(100, Math.round(
    (Math.log10(value + 1) / Math.log10(ceiling + 1)) * 100,
  ));
}

/**
 * Apply a geo multiplier to a log-scale ceiling and compute the score.
 * If the threshold has no `ceiling`, returns 0 (metric not applicable).
 */
export function logScoreWithMultiplier(
  value: number,
  thresholds: MetricThresholds,
  multiplier: number,
): number {
  if (!thresholds.ceiling) return 0;
  return logScore(value, thresholds.ceiling * multiplier);
}

/**
 * Stepped score: thresholds define the breakpoints for strong / good /
 * ok / weak. Values in between interpolate linearly so the score
 * doesn't jump abruptly.
 *
 * Breakpoints (when raw >= threshold):
 *   strong → 100
 *   good   → 70
 *   ok     → 40
 *   weak   → 20
 *   (below weak) → 0-20 linear to 0 at value=0
 */
export function steppedScore(
  value: number,
  thresholds: MetricThresholds,
  multiplier: number = 1,
): number {
  if (value <= 0) return 0;
  const strong = (thresholds.strong ?? 0) * multiplier;
  const good = (thresholds.good ?? 0) * multiplier;
  const ok = (thresholds.ok ?? 0) * multiplier;
  const weak = (thresholds.weak ?? 0) * multiplier;

  if (strong > 0 && value >= strong) return 100;
  if (good > 0 && value >= good) {
    // interpolate good → strong (70 → 100)
    if (strong > good) return Math.round(70 + ((value - good) / (strong - good)) * 30);
    return 70;
  }
  if (ok > 0 && value >= ok) {
    if (good > ok) return Math.round(40 + ((value - ok) / (good - ok)) * 30);
    return 40;
  }
  if (weak > 0 && value >= weak) {
    if (ok > weak) return Math.round(20 + ((value - weak) / (ok - weak)) * 20);
    return 20;
  }
  if (weak > 0) {
    // 0..weak linear 0..20
    return Math.round((value / weak) * 20);
  }
  return 0;
}

/**
 * Convert a 1-5 rating (GBP-style) to 0-100, with 2★ as the floor.
 * Not profile-dependent — the star scale is universal.
 */
export function ratingToScore(rating: number): number {
  return Math.min(100, Math.max(0, Math.round(((rating - 2) / 3) * 100)));
}

/**
 * Normalize pillar weights so they sum to 1. Skips pillars where the
 * value is null (no data available — don't penalize).
 * Returns {weighted, effectiveWeights, totalScore}.
 */
export function weightedTotal(
  pillars: Array<{ key: keyof PillarWeights; value: number | null }>,
  weights: PillarWeights,
): { total: number; effective: Partial<PillarWeights> } {
  const active = pillars.filter(p => p.value != null && p.value > 0);
  if (active.length === 0) return { total: 0, effective: {} };

  const totalW = active.reduce((s, p) => s + weights[p.key], 0);
  if (totalW === 0) return { total: 0, effective: {} };

  const total = Math.round(
    active.reduce((s, p) => s + (p.value as number) * weights[p.key], 0) / totalW,
  );

  const effective: Partial<PillarWeights> = {};
  for (const p of active) {
    effective[p.key] = Math.round((weights[p.key] / totalW) * 100) / 100;
  }

  return { total: Math.min(100, Math.max(0, total)), effective };
}

/**
 * Convenience: return every threshold the caller might need, already
 * multiplied by the appropriate geo multiplier for this client. Keeps
 * the caller from having to remember which metric uses which multiplier.
 */
export function resolveThresholds(
  profile: BenchmarkProfile,
  geo: GeoMultipliers,
): {
  keywordsTop10Ceiling: number;
  trafficCeiling: number;
  instagramCeiling: number;
  linkedinCeiling: number;
  pressThresholds: MetricThresholds;     // stepped
  blogThresholds: MetricThresholds;      // stepped
  gbpReviewsCeiling: number;
  instagramEngagement: MetricThresholds; // stepped — ER not multiplied
  linkedinEngagement: MetricThresholds;  // stepped — ER not multiplied
} {
  const t = profile.thresholds;
  return {
    keywordsTop10Ceiling: (t.keywordsTop10.ceiling ?? 2_000) * geo.seo,
    trafficCeiling: (t.organicTrafficMonthly.ceiling ?? 5_000_000) * geo.traffic,
    instagramCeiling: (t.instagramFollowers.ceiling ?? 50_000) * geo.social,
    linkedinCeiling: (t.linkedinFollowers.ceiling ?? 50_000) * geo.social,
    pressThresholds: scaleStepped(t.pressMentionsQuarterly, geo.reputation),
    blogThresholds: scaleStepped(t.blogPostsPerMonth, geo.content),
    gbpReviewsCeiling: (t.gbpReviews.ceiling ?? 500) * geo.reputation,
    instagramEngagement: t.instagramEngagementRate, // ratios don't scale
    linkedinEngagement: t.linkedinEngagementRate,
  };
}

function scaleStepped(t: MetricThresholds, multiplier: number): MetricThresholds {
  return {
    strong: t.strong != null ? t.strong * multiplier : undefined,
    good: t.good != null ? t.good * multiplier : undefined,
    ok: t.ok != null ? t.ok * multiplier : undefined,
    weak: t.weak != null ? t.weak * multiplier : undefined,
  };
}
