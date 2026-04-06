/**
 * Content Pillar Score: Blog + Instagram + LinkedIn with sector-based weights.
 *
 * Weights adapt to business type:
 * - B2B: blog + LinkedIn heavy (authority channels)
 * - B2C: Instagram heavy (visual engagement)
 * - Mixed: balanced across all three
 */

export interface ContentWeights {
  blog: number;
  instagram: number;
  linkedin: number;
  businessType: string;
}

export function getContentWeights(
  sector?: string,
  primaryGoal?: string,
  businessType?: string,
): ContentWeights {
  const s = (sector || '').toLowerCase();
  const g = (primaryGoal || '').toLowerCase();
  const bt = (businessType || '').toLowerCase();

  // B2C local (restaurant, clinic, salon, gym)
  if (bt === 'local' || g === 'local_traffic' ||
      /restauran|peluquer|clinica|gimnasio|fisio|dental|veterinar|salon|spa|bar\b|cafeter/i.test(s)) {
    return { blog: 0.20, instagram: 0.60, linkedin: 0.10, businessType: 'b2c_local' };
  }

  // Ecommerce
  if (bt === 'ecommerce' || g === 'sell_online' ||
      /ecommerce|tienda|shop|retail|moda|fashion|cosmetic|beauty|joyer/i.test(s)) {
    return { blog: 0.30, instagram: 0.50, linkedin: 0.15, businessType: 'ecommerce' };
  }

  // B2C pure (hospitality, food, entertainment, fitness)
  if (/hosteleria|hospitality|turismo|hotel|ocio|entertainment|fitness|deporte|aliment|fruta|food|beverage/i.test(s)) {
    return { blog: 0.25, instagram: 0.55, linkedin: 0.10, businessType: 'b2c' };
  }

  // B2B pure (software, consulting, industrial, legal, financial)
  if (bt === 'b2b' || g === 'generate_leads' ||
      /software|saas|consul|industrial|legal|abogad|financ|banca|seguros|logistic|tecnolog|erp|crm/i.test(s)) {
    return { blog: 0.45, instagram: 0.10, linkedin: 0.45, businessType: 'b2b' };
  }

  // Default: mixed B2B/B2C
  return { blog: 0.35, instagram: 0.25, linkedin: 0.40, businessType: 'mixed' };
}

// ── Individual source scores ──────────────────────────────────────

function frequencyScore(postsLast90Days: number): number {
  if (postsLast90Days >= 8) return 85;
  if (postsLast90Days >= 6) return 70;
  if (postsLast90Days >= 4) return 55;
  if (postsLast90Days >= 2) return 35;
  if (postsLast90Days >= 1) return 20;
  return 5;
}

function freshnessBonus(lastPostDate?: string): number {
  if (!lastPostDate) return 0;
  const daysSince = Math.floor((Date.now() - new Date(lastPostDate).getTime()) / 86_400_000);
  if (daysSince <= 7) return 15;
  if (daysSince <= 14) return 8;
  return 0;
}

function freshnessPenalty(daysSinceLastPost?: number): number {
  if (daysSinceLastPost == null) return 1;
  if (daysSinceLastPost > 60) return 0.3;
  if (daysSinceLastPost > 30) return 0.5;
  return 1;
}

export function blogScore(data: {
  postsLast90Days?: number;
  lastPostDate?: string;
  daysSinceLastPost?: number;
}): number {
  const freq = frequencyScore(data.postsLast90Days ?? 0);
  const bonus = freshnessBonus(data.lastPostDate);
  const penalty = freshnessPenalty(data.daysSinceLastPost);
  return Math.min(100, Math.round((freq + bonus) * penalty));
}

export function instagramScore(data: {
  found?: boolean;
  postsLast90Days?: number;
  lastPostDate?: string;
  engagementRate?: number;
  followers?: number;
}): number {
  if (!data.found) return 0;

  let score = 0;

  // Frequency (if we have post dates)
  if (data.postsLast90Days != null) {
    score = frequencyScore(data.postsLast90Days);
    score += freshnessBonus(data.lastPostDate);
  } else {
    // No post frequency data — estimate from followers
    score = data.followers ? (data.followers > 10000 ? 50 : data.followers > 1000 ? 30 : 15) : 10;
  }

  // Engagement bonus
  if (data.engagementRate != null) {
    if (data.engagementRate >= 3) score += 20;
    else if (data.engagementRate >= 1.5) score += 10;
    else if (data.engagementRate < 0.5) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export function linkedinScore(data: {
  found?: boolean;
  postsLast90Days?: number;
  lastPostDate?: string;
  followers?: number;
}): number {
  if (!data.found) return 0;

  let score = 0;

  // Frequency
  if (data.postsLast90Days != null) {
    score = frequencyScore(data.postsLast90Days);
    score += freshnessBonus(data.lastPostDate);
  } else {
    // No post data — estimate from followers
    score = data.followers ? (data.followers > 5000 ? 50 : data.followers > 1000 ? 35 : 20) : 10;
  }

  // Follower bonus
  if (data.followers) {
    if (data.followers > 5000) score += 20;
    else if (data.followers > 1000) score += 10;
  }

  return Math.min(100, score);
}

// ── Composite score ──────────────────────────────────────────────

export interface ContentScoreResult {
  total: number;
  blog: number;
  instagram: number;
  linkedin: number;
  weights: ContentWeights;
  breakdown: string;
}

export function computeContentScore(
  blogData: { postsLast90Days?: number; lastPostDate?: string; daysSinceLastPost?: number },
  igData: { found?: boolean; postsLast90Days?: number; lastPostDate?: string; engagementRate?: number; followers?: number },
  liData: { found?: boolean; postsLast90Days?: number; lastPostDate?: string; followers?: number },
  sector?: string,
  primaryGoal?: string,
  businessType?: string,
): ContentScoreResult {
  const weights = getContentWeights(sector, primaryGoal, businessType);

  const blog = blogScore(blogData);
  const ig = instagramScore(igData);
  const li = linkedinScore(liData);

  // If a channel doesn't exist, redistribute its weight
  let wBlog = weights.blog;
  let wIg = weights.instagram;
  let wLi = weights.linkedin;

  if (!igData.found && !liData.found) {
    // Only blog available
    wBlog = 1; wIg = 0; wLi = 0;
  } else if (!igData.found) {
    // Redistribute IG weight to blog and LinkedIn proportionally
    const redistrib = wIg;
    const ratio = wBlog / (wBlog + wLi);
    wBlog += redistrib * ratio;
    wLi += redistrib * (1 - ratio);
    wIg = 0;
  } else if (!liData.found) {
    const redistrib = wLi;
    const ratio = wBlog / (wBlog + wIg);
    wBlog += redistrib * ratio;
    wIg += redistrib * (1 - ratio);
    wLi = 0;
  }

  const total = Math.round(blog * wBlog + ig * wIg + li * wLi);

  // Build breakdown description
  const parts = [];
  if (wBlog > 0) parts.push(`Blog ${blog}/100 (${Math.round(wBlog * 100)}%)`);
  if (wIg > 0) parts.push(`IG ${ig}/100 (${Math.round(wIg * 100)}%)`);
  if (wLi > 0) parts.push(`LI ${li}/100 (${Math.round(wLi * 100)}%)`);

  return {
    total,
    blog,
    instagram: ig,
    linkedin: li,
    weights: { ...weights, blog: wBlog, instagram: wIg, linkedin: wLi },
    breakdown: parts.join(' · '),
  };
}
