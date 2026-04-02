import axios from 'axios';
import * as cheerio from 'cheerio';
import type { InstagramResult, InstagramCompetitor, CrawlResult } from '../types';

const APIFY_TOKEN = import.meta.env?.APIFY_TOKEN || process.env.APIFY_TOKEN;

// Instagram internal web API headers
const IG_HEADERS = {
  'x-ig-app-id': '936619743392459',
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram/303.0.0.11.118',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: 'https://www.instagram.com/',
};

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

export async function runInstagram(
  crawlData: CrawlResult,
  competitorUrls: string[] = [],
  userHandle?: string,
): Promise<InstagramResult> {
  let handle = userHandle || crawlData.instagramHandle;

  // Fallback: try to extract handle from the site directly
  if (!handle && crawlData.finalUrl) {
    handle = await extractHandleFromSite(crawlData.finalUrl) || undefined;
  }

  if (!handle) {
    return { found: false, reason: 'No Instagram account link found on the website' };
  }

  const profileData = await fetchProfile(handle);

  // Try to find Instagram for up to 3 competitors
  const competitorResults: InstagramCompetitor[] = [];
  if (competitorUrls.length > 0) {
    const competitorHandles = await Promise.all(
      competitorUrls.slice(0, 3).map(extractHandleFromSite),
    );
    for (const ch of competitorHandles) {
      if (!ch) continue;
      const cp = await fetchProfile(ch);
      if (cp.found) {
        competitorResults.push({
          handle: ch,
          followers: cp.followers,
          posts: cp.posts,
          engagementRate: cp.engagementRate,
          url: `https://www.instagram.com/${ch}/`,
        });
      }
    }
  }

  return {
    ...profileData,
    ...(competitorResults.length > 0 && { competitors: competitorResults }),
  };
}

async function fetchProfile(handle: string): Promise<InstagramResult> {
  const igApiUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;

  // Try Apify residential proxy first (bypasses cloud IP blocks), then direct
  const attempts: object[] = [
    ...(APIFY_TOKEN ? [{ headers: IG_HEADERS, timeout: 15000, ...apifyProxyConfig() }] : []),
    { headers: IG_HEADERS, timeout: 10000 },
  ];

  for (const config of attempts) {
    try {
      const res = await axios.get(igApiUrl, config as any);
      const user = res.data?.data?.user;
      if (!user) throw new Error('empty user');
      return parseUserData(handle, user);
    } catch {
      // try next attempt
    }
  }

  // Final fallback: HTML scraping (limited data, but better than nothing)
  return await fetchProfileFallback(handle);
}

function parseUserData(handle: string, user: any): InstagramResult {
  const recentPosts: any[] = user.edge_owner_to_timeline_media?.edges?.slice(0, 12) || [];
  const followers = user.edge_followed_by?.count ?? 0;

  let avgLikes: number | undefined;
  let avgComments: number | undefined;
  let engagementRate: number | undefined;

  if (recentPosts.length > 0 && followers > 0) {
    const totalLikes = recentPosts.reduce(
      (s: number, p: any) => s + (p.node?.edge_liked_by?.count ?? 0),
      0,
    );
    const totalComments = recentPosts.reduce(
      (s: number, p: any) => s + (p.node?.edge_media_to_comment?.count ?? 0),
      0,
    );
    avgLikes = Math.round(totalLikes / recentPosts.length);
    avgComments = Math.round(totalComments / recentPosts.length);
    engagementRate = Math.round(((avgLikes + avgComments) / followers) * 10000) / 100;
  }

  return {
    found: true,
    handle,
    url: `https://www.instagram.com/${handle}/`,
    followers,
    following: user.edge_follow?.count,
    posts: user.edge_owner_to_timeline_media?.count,
    bio: user.biography?.slice(0, 200),
    isVerified: user.is_verified,
    isBusinessAccount: user.is_business_account,
    businessCategory: user.business_category_name || undefined,
    ...(avgLikes !== undefined && { avgLikes }),
    ...(avgComments !== undefined && { avgComments }),
    ...(engagementRate !== undefined && { engagementRate }),
  };
}

async function fetchProfileFallback(handle: string): Promise<InstagramResult> {
  try {
    const res = await axios.get(`https://www.instagram.com/${handle}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        Accept: 'text/html',
      },
      timeout: 8000,
      ...(APIFY_TOKEN ? apifyProxyConfig() : {}),
    });

    const $ = cheerio.load(res.data as string);
    const description = $('meta[name="description"]').attr('content') || '';
    const followersMatch = description.match(/([\d,.KkMm]+)\s*Followers/i);
    const postsMatch = description.match(/([\d,.KkMm]+)\s*Posts/i);

    return {
      found: true,
      handle,
      url: `https://www.instagram.com/${handle}/`,
      ...(followersMatch && { followers: parseCount(followersMatch[1]) }),
      ...(postsMatch && { posts: parseCount(postsMatch[1]) }),
      reason: 'Limited data — Instagram API access restricted',
    };
  } catch {
    return {
      found: true,
      handle,
      url: `https://www.instagram.com/${handle}/`,
      reason: 'Profile detected but data access blocked by Instagram',
    };
  }
}

async function extractHandleFromSite(siteUrl: string): Promise<string | null> {
  try {
    const normalized = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
    const res = await axios.get(normalized, {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
      validateStatus: (s) => s < 500,
    });
    const html = String(res.data);
    const $ = cheerio.load(html);

    // Check <a href> links first
    const links = $('a[href*="instagram.com"]')
      .map((_, el) => $(el).attr('href') || '')
      .get();
    const BLACKLIST = ['explore', 'reels', 'stories', 'p', 'tv', 'share', 'reel'];
    for (const link of links) {
      const match = link.match(/instagram\.com\/([A-Za-z0-9_.]+)/);
      if (match?.[1] && !BLACKLIST.includes(match[1])) {
        return match[1];
      }
    }

    // Fallback: search raw HTML text
    const igMatch = html.match(/instagram\.com\/([A-Za-z0-9_.]{3,30})(?:\/|\?|"|'|\s|\\)/);
    const igCandidate = igMatch?.[1];
    if (igCandidate && !BLACKLIST.includes(igCandidate)) {
      return igCandidate;
    }
  } catch {
    // ignore
  }
  return null;
}

function parseCount(raw: string): number | undefined {
  const s = raw.replace(/,/g, '').toUpperCase();
  if (s.endsWith('M')) return Math.round(parseFloat(s) * 1_000_000);
  if (s.endsWith('K')) return Math.round(parseFloat(s) * 1_000);
  const n = parseInt(s, 10);
  return isNaN(n) ? undefined : n;
}
