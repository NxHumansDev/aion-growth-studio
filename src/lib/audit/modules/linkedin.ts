import axios from 'axios';
import * as cheerio from 'cheerio';
import type { LinkedInResult, LinkedInCompetitor, CrawlResult } from '../types';

const APIFY_TOKEN = import.meta.env?.APIFY_TOKEN || process.env.APIFY_TOKEN;
const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

interface PostMetrics {
  postsLast90Days: number; avgLikes: number; avgComments: number;
  engagementRate: number; lastPostDate?: string;
  _totalLikes: number; _totalComments: number; // raw totals for ER recalc
}

/** Minimal snapshot of the previous week's LinkedIn data used for poll-mode
 *  dedup. When this is provided, fetchLinkedInPosts calls the actor with
 *  maxPosts:3 first; if no post is newer than priorLastPostDate, the cached
 *  aggregates are reused and the Apify bill drops from 8 posts/week to 3.
 */
export interface PriorPostData {
  lastPostDate?: string;
  postsLast90Days?: number;
  avgLikes?: number;
  avgComments?: number;
  engagementRate?: number;
}

async function callLinkedInCompanyPosts(companyUrl: string, maxPosts: number): Promise<any[] | null> {
  try {
    const res = await axios.post(
      `https://api.apify.com/v2/acts/harvestapi~linkedin-company-posts/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=30`,
      { companyUrls: [companyUrl], maxPosts },
      { timeout: 180_000, headers: { 'Content-Type': 'application/json' } },
    );
    const posts = res.data;
    return Array.isArray(posts) ? posts : null;
  } catch (e) {
    console.log(`[linkedin] Posts Actor failed (maxPosts=${maxPosts}): ${(e as Error).message?.slice(0, 80)}`);
    return null;
  }
}

function aggregatePosts(posts: any[], followers: number): PostMetrics | null {
  if (!posts || posts.length === 0) return null;
  const now = Date.now();
  const MS_90D = 90 * 86_400_000;
  let count90 = 0, totalLikes = 0, totalComments = 0, latestTs = 0;
  for (const p of posts) {
    const ts = p.postedAt?.timestamp ?? 0;
    if (ts > latestTs) latestTs = ts;
    if (now - ts <= MS_90D) {
      count90++;
      totalLikes += p.engagement?.likes ?? 0;
      totalComments += p.engagement?.comments ?? 0;
    }
  }
  const avgLikes = count90 > 0 ? Math.round(totalLikes / count90) : 0;
  const avgComments = count90 > 0 ? Math.round((totalComments / count90) * 10) / 10 : 0;
  const engRate = count90 > 0 && followers > 0
    ? Math.round(((totalLikes + totalComments) / (count90 * followers)) * 10000) / 100
    : 0;
  return {
    postsLast90Days: count90, avgLikes, avgComments, engagementRate: engRate,
    lastPostDate: latestTs > 0 ? new Date(latestTs).toISOString() : undefined,
    _totalLikes: totalLikes, _totalComments: totalComments,
  };
}

/**
 * Fetch recent posts from a LinkedIn company page via Apify.
 *
 * Poll optimization: if `prior` is supplied (last week's aggregates),
 * we first call the actor with maxPosts:3 to check whether any new post
 * has been published. If the newest polled post isn't newer than the
 * cached lastPostDate, we return the cached aggregates — costs 3 credits
 * vs 8. If new activity is detected, we do a full fetch with maxPosts:8
 * to get accurate 90-day metrics.
 */
async function fetchLinkedInPosts(companyUrl: string, followers: number, prior?: PriorPostData): Promise<PostMetrics | null> {
  if (!APIFY_TOKEN) return null;
  const priorTs = prior?.lastPostDate ? new Date(prior.lastPostDate).getTime() : 0;
  const canPoll = priorTs > 0 && prior?.postsLast90Days != null;

  if (canPoll) {
    const polled = await callLinkedInCompanyPosts(companyUrl, 3);
    if (polled && polled.length > 0) {
      const newestTs = polled.reduce((m, p) => Math.max(m, p.postedAt?.timestamp ?? 0), 0);
      if (newestTs > 0 && newestTs <= priorTs) {
        // No new posts since last radar — reuse cached aggregates.
        console.log(`[linkedin] Poll hit cache: no new posts since ${new Date(priorTs).toISOString().slice(0, 10)}. Reusing aggregates.`);
        return {
          postsLast90Days: prior.postsLast90Days ?? 0,
          avgLikes: prior.avgLikes ?? 0,
          avgComments: prior.avgComments ?? 0,
          engagementRate: prior.engagementRate ?? 0,
          lastPostDate: prior.lastPostDate,
          _totalLikes: 0, _totalComments: 0, // not used downstream when reused
        };
      }
      console.log(`[linkedin] Poll detected new activity (newest ${new Date(newestTs).toISOString().slice(0, 10)} > prior ${new Date(priorTs).toISOString().slice(0, 10)}). Refetching full.`);
    } else {
      console.log(`[linkedin] Poll returned nothing, falling back to full fetch.`);
    }
  }

  const posts = await callLinkedInCompanyPosts(companyUrl, 8);
  const metrics = aggregatePosts(posts || [], followers);
  if (metrics) console.log(`[linkedin] Posts: ${metrics.postsLast90Days}/90d, avg ${metrics.avgLikes} likes, ER ${metrics.engagementRate}%`);
  return metrics;
}

/** Search Google for "site:linkedin.com/company {brand}" to find LinkedIn page */
async function searchLinkedInUrl(crawl: CrawlResult): Promise<string | null> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return null;

  let brand = crawl.title?.split(/[-|–—·:]/)[0]?.trim();
  // Fallback: use domain name if no title
  if (!brand || brand.length < 2) {
    const url = crawl.finalUrl || '';
    try { brand = new URL(url).hostname.replace(/^www\./, '').split('.')[0]; } catch {}
  }
  if (!brand || brand.length < 2) return null;

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{
        keyword: `site:linkedin.com/company ${brand}`,
        location_code: 2724,
        language_code: 'es',
        depth: 5,
      }]),
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.tasks?.[0]?.result?.[0]?.items || [];

    for (const item of items) {
      const url = item.url || '';
      if (url.includes('linkedin.com/company/') || url.includes('linkedin.com/in/')) {
        console.log(`[linkedin] Found via Google search: ${url} for "${brand}"`);
        return url.split('?')[0];
      }
    }
  } catch { /* ignore */ }
  return null;
}

// LinkedIn serves HTML to Googlebot — enough to extract og: meta tags
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Apify residential proxy config — bypasses cloud IP blocks on LinkedIn
function apifyProxyConfig() {
  if (!APIFY_TOKEN) return {};
  return {
    proxy: {
      protocol: 'http' as const,
      host: 'proxy.apify.com',
      port: 8000,
      auth: { username: 'auto', password: APIFY_TOKEN },
    },
  };
}

export async function runLinkedIn(
  crawlData: CrawlResult,
  competitorUrls: string[] = [],
  userLinkedinUrl?: string,
  priorLinkedIn?: LinkedInResult,
): Promise<LinkedInResult> {
  const prior: PriorPostData | undefined = priorLinkedIn?.found
    ? {
        lastPostDate: priorLinkedIn.lastPostDate,
        postsLast90Days: priorLinkedIn.postsLast90Days,
        avgLikes: priorLinkedIn.avgLikes,
        avgComments: priorLinkedIn.avgComments,
        engagementRate: priorLinkedIn.engagementRate,
      }
    : undefined;

  let linkedinUrl = userLinkedinUrl || crawlData.linkedinUrl;

  // ── Strategy 1: Extract LinkedIn URL from website HTML ─────────
  if (!linkedinUrl && crawlData.finalUrl) {
    const extracted = await extractLinkedInFromSite(crawlData.finalUrl);
    if (extracted) {
      return { found: true, ...extracted };
    }
  }

  // ── Strategy 2: Try Apify Actor directly with company name slug ─
  // This is the most reliable method — the Actor uses authenticated
  // proxies that bypass LinkedIn's login wall. Skip HTTP validation.
  if (!linkedinUrl && APIFY_TOKEN) {
    const slugCandidates: string[] = [];

    // Company name → slug (most likely: "Frutas Eloy" → "frutas-eloy")
    const companySlug = crawlData.companyName?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (companySlug) slugCandidates.push(companySlug);

    // Domain name as slug
    const domainName = crawlData.finalUrl
      ? new URL(crawlData.finalUrl).hostname.replace(/^www\./, '').split('.')[0]
      : '';
    if (domainName && !slugCandidates.includes(domainName)) slugCandidates.push(domainName);

    // Domain with hyphens at common word boundaries
    if (domainName && domainName.length > 6 && !domainName.includes('-') && domainName !== companySlug) {
      // Only try a few strategic splits, not every position
      for (let i = 4; i <= Math.min(domainName.length - 3, 8); i++) {
        const candidate = domainName.slice(0, i) + '-' + domainName.slice(i);
        if (!slugCandidates.includes(candidate)) slugCandidates.push(candidate);
      }
    }

    for (const slug of slugCandidates.slice(0, 5)) {
      const candidateUrl = `https://www.linkedin.com/company/${slug}`;
      console.log(`[linkedin] Trying Apify Actor with slug: ${slug}`);
      const profile = await fetchLinkedInProfile(candidateUrl, prior);
      if (profile.found && profile.followers && profile.followers > 0) {
        console.log(`[linkedin] Apify Actor success: ${profile.name} — ${profile.followers} followers (slug: ${slug})`);
        // Fetch competitors before returning
        const competitorResults = await fetchCompetitorLinkedIn(competitorUrls);
        return { ...profile, ...(competitorResults.length > 0 && { competitors: competitorResults }) };
      }
    }
  }

  // ── Strategy 3: Google search for LinkedIn URL ─────────────────
  if (!linkedinUrl) {
    linkedinUrl = await searchLinkedInUrl(crawlData) || undefined;
  }

  if (!linkedinUrl) {
    return { found: false, reason: 'No LinkedIn page found via website, Apify, or search' };
  }

  // Normalise to absolute URL
  const url = linkedinUrl.startsWith('http') ? linkedinUrl : `https://${linkedinUrl}`;
  const profile = await fetchLinkedInProfile(url, prior);

  const competitorResults = await fetchCompetitorLinkedIn(competitorUrls);
  return {
    ...profile,
    ...(competitorResults.length > 0 && { competitors: competitorResults }),
  };
}

async function fetchCompetitorLinkedIn(competitorUrls: string[]): Promise<LinkedInCompetitor[]> {
  if (competitorUrls.length === 0) return [];
  const found = await Promise.all(
    competitorUrls.slice(0, 3).map(extractLinkedInFromSite),
  );
  return found.filter(Boolean) as LinkedInCompetitor[];
}

async function callLinkedInProfilePosts(url: string, maxPosts: number): Promise<any[] | null> {
  try {
    const res = await axios.post(
      `https://api.apify.com/v2/acts/harvestapi~linkedin-profile-posts/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=30`,
      { profileUrls: [url], maxPosts },
      { timeout: 180_000, headers: { 'Content-Type': 'application/json' } },
    );
    return Array.isArray(res.data) ? res.data : null;
  } catch (e) {
    console.log(`[linkedin] Profile posts Actor failed (maxPosts=${maxPosts}): ${(e as Error).message?.slice(0, 80)}`);
    return null;
  }
}

async function fetchLinkedInProfile(url: string, prior?: PriorPostData): Promise<LinkedInResult> {
  const isPersonalProfile = url.includes('/in/');

  // ── Personal profiles (/in/username) — profile + posts in parallel ──
  if (isPersonalProfile && APIFY_TOKEN) {
    try {
      const priorTs = prior?.lastPostDate ? new Date(prior.lastPostDate).getTime() : 0;
      const canPoll = priorTs > 0 && prior?.postsLast90Days != null;
      // Profile scraper is always needed (follower count, connections, etc.)
      // Posts scraper poll-mode: start with maxPosts:3 to check for new activity.
      const postsMaxInitial = canPoll ? 3 : 8;
      const [profileRes, postsRes] = await Promise.allSettled([
        axios.post(
          `https://api.apify.com/v2/acts/harvestapi~linkedin-profile-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=30`,
          { urls: [url] },
          { timeout: 180_000, headers: { 'Content-Type': 'application/json' } },
        ),
        callLinkedInProfilePosts(url, postsMaxInitial).then(data => ({ data })),
      ]);

      if (profileRes.status === 'fulfilled') {
        const items = profileRes.value.data;
        if (Array.isArray(items) && items.length > 0) {
          const p = items[0];
          const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
          const followers = p.followerCount ?? 0;
          const connections = p.connectionsCount ?? 0;

          // Process posts for engagement metrics. Poll logic: if prior
          // aggregates exist and the polled batch has no post newer than
          // prior.lastPostDate, reuse the cache (3 credits instead of 8).
          // If new activity detected, fetch the full 8 for accurate 90-day
          // metrics.
          let postMetrics: Partial<PostMetrics> = {};
          const aggregatePostsList = (posts: any[]) => {
            const now = Date.now();
            const MS_90D = 90 * 86_400_000;
            let count90 = 0, totalLikes = 0, totalComments = 0, latestTs = 0;
            for (const post of posts) {
              const ts = post.postedAt?.timestamp ?? new Date(post.postedAt?.date || 0).getTime();
              if (ts > latestTs) latestTs = ts;
              if (now - ts <= MS_90D && !post.repostedBy) {
                count90++;
                totalLikes += post.engagement?.likes ?? 0;
                totalComments += post.engagement?.comments ?? 0;
              }
            }
            const avgLikes = count90 > 0 ? Math.round(totalLikes / count90) : 0;
            const avgComments = count90 > 0 ? Math.round(totalComments / count90) : 0;
            const engRate = count90 > 0 && followers > 0
              ? Math.round(((totalLikes + totalComments) / (count90 * followers)) * 10000) / 100
              : 0;
            return {
              postsLast90Days: count90,
              avgLikes,
              avgComments,
              engagementRate: engRate,
              lastPostDate: latestTs > 0 ? new Date(latestTs).toISOString() : undefined,
              _latestTs: latestTs,
            };
          };

          if (postsRes.status === 'fulfilled') {
            const initialPosts: any[] = (postsRes.value as any).data || [];
            const polled = aggregatePostsList(initialPosts);

            if (canPoll && polled._latestTs > 0 && polled._latestTs <= priorTs) {
              // No new posts since last radar — reuse cached aggregates.
              console.log(`[linkedin] Personal poll hit cache: no new posts since ${new Date(priorTs).toISOString().slice(0, 10)}. Reusing aggregates.`);
              postMetrics = {
                postsLast90Days: prior?.postsLast90Days ?? 0,
                avgLikes: prior?.avgLikes ?? 0,
                avgComments: prior?.avgComments ?? 0,
                engagementRate: prior?.engagementRate ?? 0,
                lastPostDate: prior?.lastPostDate,
              };
            } else if (canPoll) {
              // Activity detected during a poll — refetch full for accurate 90d.
              console.log(`[linkedin] Personal poll detected new activity. Refetching full.`);
              const full = await callLinkedInProfilePosts(url, 8);
              const aggregated = aggregatePostsList(full || []);
              postMetrics = {
                postsLast90Days: aggregated.postsLast90Days,
                avgLikes: aggregated.avgLikes,
                avgComments: aggregated.avgComments,
                engagementRate: aggregated.engagementRate,
                lastPostDate: aggregated.lastPostDate,
              };
              console.log(`[linkedin] Personal posts: ${aggregated.postsLast90Days}/90d original, avg ${aggregated.avgLikes} likes, ER ${aggregated.engagementRate}%`);
            } else {
              // First fetch ever (no prior cache) — use the maxPosts:8 batch.
              postMetrics = {
                postsLast90Days: polled.postsLast90Days,
                avgLikes: polled.avgLikes,
                avgComments: polled.avgComments,
                engagementRate: polled.engagementRate,
                lastPostDate: polled.lastPostDate,
              };
              console.log(`[linkedin] Personal posts: ${polled.postsLast90Days}/90d original, avg ${polled.avgLikes} likes, ER ${polled.engagementRate}%`);
            }
          }

          // Extract recent publications (media articles, not posts)
          const publications = (p.publications || []).slice(0, 6).map((pub: any) => ({
            title: pub.title,
            publishedAt: pub.publishedAt,
            link: pub.link,
          }));

          console.log(`[linkedin] Personal profile: ${fullName} — ${followers} followers, ${connections} connections, ${publications.length} publications`);
          return {
            found: true,
            url,
            name: fullName || undefined,
            followers: followers || undefined,
            employees: connections || undefined,
            description: (p.about || '').slice(0, 300) || undefined,
            industry: p.headline || undefined,
            headquarters: typeof p.location === 'object' ? p.location?.parsed?.text : p.location,
            isPersonal: true,
            isVerified: p.verified || false,
            isPremium: p.premium || false,
            experienceCount: p.experience?.length ?? 0,
            educationHighlight: p.education?.[0]?.schoolName || p.profileTopEducation?.[0]?.schoolName,
            skillsCount: p.skills?.length ?? 0,
            publicationsCount: publications.length,
            publications,
            ...postMetrics,
          };
        }
      }
      if (profileRes.status === 'rejected') {
        console.log(`[linkedin] Personal profile Actor failed: ${profileRes.reason?.message?.slice(0, 80)}`);
      }
    } catch (e) {
      console.log(`[linkedin] Personal profile failed: ${(e as Error).message?.slice(0, 80)}`);
    }
    // Fall through to HTML scraping
  }

  // ── Company pages (/company/slug) — use company data insights scraper ──
  if (APIFY_TOKEN) {
    try {
      const [actorRes, postsRes] = await Promise.allSettled([
        axios.post(
          `https://api.apify.com/v2/acts/riceman~linkedin-company-data-insights-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=30`,
          { company_linkedin_urls: [url] },
          { timeout: 180_000, headers: { 'Content-Type': 'application/json' } },
        ),
        // Posts Actor runs in parallel — doesn't add latency
        fetchLinkedInPosts(url, 0, prior), // followers=0 placeholder, recalc ER below
      ]);

      if (actorRes.status === 'fulfilled') {
        const items = actorRes.value.data;
        if (Array.isArray(items) && items.length > 0) {
          const p = items[0];
          const followers = p.follower_count || 0;
          console.log(`[linkedin] Profile: ${p.company_name} — ${followers} followers, ${p.employee_count} employees`);

          // Recalculate engagement rate with actual follower count
          let postData = postsRes.status === 'fulfilled' ? postsRes.value : null;
          if (postData && followers > 0 && postData.postsLast90Days > 0) {
            const er = Math.round(((postData._totalLikes + postData._totalComments) / (postData.postsLast90Days * followers)) * 10000) / 100;
            postData = { ...postData, engagementRate: er };
            console.log(`[linkedin] ER recalc with ${followers} followers: ${er}%`);
          }

          return {
            found: true,
            url,
            name: p.company_name || undefined,
            followers: followers || undefined,
            employees: p.employee_count || undefined,
            description: (p.description || '').slice(0, 300) || undefined,
            industry: p.industries?.[0] || undefined,
            specialties: p.specialties || undefined,
            headquarters: p.hq_full_address || undefined,
            website: p.website || undefined,
            yearFounded: p.year_founded || undefined,
            ...postData,
          };
        }
      }
      if (actorRes.status === 'rejected') {
        console.log(`[linkedin] Profile Actor failed: ${actorRes.reason?.message?.slice(0, 80)}`);
      }
    } catch (e) {
      console.log(`[linkedin] Apify failed: ${(e as Error).message?.slice(0, 80)}`);
    }
  }

  // Method 2: HTML scraping with Googlebot UA
  const attempts = [
    ...(APIFY_TOKEN
      ? [{ headers: HEADERS, timeout: 90_000, maxRedirects: 3, validateStatus: (s: number) => s < 500, ...apifyProxyConfig() }]
      : []),
    { headers: HEADERS, timeout: 90_000, maxRedirects: 3, validateStatus: (s: number) => s < 500 },
  ];

  let lastErr: any;

  for (const config of attempts) {
    try {
      const res = await axios.get(url, config);
      const $ = cheerio.load(res.data as string);

      const ogTitle = $('meta[property="og:title"]').attr('content') || '';
      const ogDesc = $('meta[property="og:description"]').attr('content') || '';
      const name = ogTitle.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();

      // og:description format examples:
      // "2,345 followers · Software company · Madrid, Spain"
      // "12,345 followers · 50-200 employees · Consulting"
      const followersMatch = ogDesc.match(/([\d,.]+)\s*followers?/i);
      const parts = ogDesc.split('·').map((s) => s.trim());

      const followers = followersMatch ? parseLinkedInNum(followersMatch[1]) : undefined;

      // Try to extract employee range, industry, location from the parts
      let employees: string | undefined;
      let industry: string | undefined;
      let headquarters: string | undefined;

      for (const part of parts) {
        if (/employee/i.test(part)) {
          employees = part.replace(/employees?/i, '').trim();
        } else if (/follower/i.test(part)) {
          // already handled
        } else if (part && !headquarters) {
          // heuristic: city/country patterns
          if (/,/.test(part) || /^[A-Z]/.test(part)) {
            if (!industry) industry = part;
            else headquarters = part;
          }
        }
      }

      // Also try structured data (JSON-LD)
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html() || '{}');
          if (json.numberOfEmployees?.value) {
            employees = employees || String(json.numberOfEmployees.value);
          }
          if (json.address?.addressLocality) {
            headquarters =
              headquarters ||
              [json.address.addressLocality, json.address.addressCountry]
                .filter(Boolean)
                .join(', ');
          }
          if (json.industry) industry = industry || json.industry;
        } catch {
          // ignore
        }
      });

      if (!name && !followers) {
        return {
          found: true,
          url,
          reason: 'LinkedIn profile found but content is behind login wall',
        };
      }

      return {
        found: true,
        url,
        ...(name && { name }),
        ...(followers !== undefined && { followers }),
        ...(employees && { employees }),
        ...(ogDesc && { description: ogDesc.slice(0, 200) }),
        ...(industry && { industry }),
        ...(headquarters && { headquarters }),
      };
    } catch (err: any) {
      lastErr = err;
      // try next attempt
    }
  }

  return {
    found: true,
    url,
    reason: `Could not fetch LinkedIn data: ${lastErr?.message?.slice(0, 80)}`,
  };
}

async function extractLinkedInFromSite(
  siteUrl: string,
): Promise<LinkedInCompetitor | null> {
  try {
    const normalized = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
    const res = await axios.get(normalized, {
      timeout: 60_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
      validateStatus: (s) => s < 500,
    });
    const $ = cheerio.load(res.data as string);

    const liLink = $('a[href*="linkedin.com/company"]')
      .map((_, el) => $(el).attr('href') || '')
      .get()
      .find((h) => h.includes('linkedin.com/company'));

    if (!liLink) return null;

    const liUrl = liLink.startsWith('http') ? liLink : `https://${liLink}`;
    const profile = await fetchLinkedInProfile(liUrl.split('?')[0]);

    if (!profile.found) return null;

    const companyName =
      profile.name ||
      liUrl.match(/linkedin\.com\/company\/([^/?#]+)/)?.[1]?.replace(/-/g, ' ') ||
      new URL(normalized).hostname.replace(/^www\./, '');

    return {
      name: companyName,
      url: liUrl,
      ...(profile.followers !== undefined && { followers: profile.followers }),
      ...(profile.employees && { employees: profile.employees }),
    };
  } catch {
    return null;
  }
}

function parseLinkedInNum(raw: string): number | undefined {
  const s = raw.replace(/,/g, '').trim();
  const n = parseInt(s, 10);
  return isNaN(n) ? undefined : n;
}
