import axios from 'axios';
import * as cheerio from 'cheerio';
import type { InstagramResult, InstagramCompetitor, CrawlResult } from '../types';

const APIFY_TOKEN = import.meta.env?.APIFY_TOKEN || process.env.APIFY_TOKEN;
const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

const IG_BLACKLIST_HANDLES = ['explore', 'reels', 'stories', 'p', 'tv', 'share', 'reel', 'accounts', 'about', 'directory'];

// Titles that indicate the crawl was blocked (not real company names)
const BAD_TITLE_RE = /^(access denied|just a moment|attention required|403|404|blocked|captcha|challenge|verifying|please wait|one moment|checking your browser|cloudflare|ddos protection|forbidden|not found)/i;

/**
 * Check if a found Instagram handle plausibly matches the brand.
 * Prevents cases like finding @accessdeniedpod for elcorteingles.
 */
function handleMatchesBrand(handle: string, domain: string, companyName?: string): boolean {
  const h = handle.toLowerCase().replace(/[._]/g, '');
  const d = domain.split('.')[0].replace(/-/g, '');
  // Direct match: handle contains domain or domain contains handle
  if (h.includes(d) || d.includes(h)) return true;
  // Company name match
  if (companyName) {
    const cn = companyName.toLowerCase().replace(/[\s._-]/g, '');
    if (h.includes(cn) || cn.includes(h)) return true;
    // Word overlap: at least one significant word matches
    const words = companyName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.some(w => h.includes(w))) return true;
  }
  return false;
}

/** Search Google for "site:instagram.com {brand}" to find IG handle */
async function searchInstagramHandle(crawl: CrawlResult): Promise<string | null> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return null;

  const domain = (() => {
    try { return new URL(crawl.finalUrl || '').hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; }
  })();

  // Use companyName first, then title (only if not a bot-block page), then domain
  const titleClean = crawl.title?.split(/[-|–—·:]/)[0]?.trim();
  const brand = crawl.companyName
    || (titleClean && !BAD_TITLE_RE.test(titleClean) && titleClean.length > 2 ? titleClean : null)
    || domain;
  if (!brand || brand.length < 2) return null;

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{
        keyword: `site:instagram.com ${brand}`,
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
      const match = url.match(/instagram\.com\/([A-Za-z0-9_.]{3,30})\/?$/);
      if (match && !IG_BLACKLIST_HANDLES.includes(match[1].toLowerCase())) {
        const handle = match[1];
        // Validate: handle must match brand/domain to prevent false positives
        if (handleMatchesBrand(handle, domain, crawl.companyName)) {
          console.log(`[instagram] Found via Google: @${handle} for "${brand}" ✓`);
          return handle;
        } else {
          console.log(`[instagram] Rejected @${handle} — doesn't match "${domain}" or "${crawl.companyName}"`);
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Broader Google search: "{brand} instagram" (catches third-party mentions) */
async function searchInstagramHandleBroad(crawl: CrawlResult): Promise<string | null> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return null;

  const domain = (() => {
    try { return new URL(crawl.finalUrl || '').hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; }
  })();

  const titleClean = crawl.title?.split(/[-|–—·:]/)[0]?.trim();
  const brand = crawl.companyName
    || (titleClean && !BAD_TITLE_RE.test(titleClean) && titleClean.length > 2 ? titleClean : null)
    || domain;
  if (!brand || brand.length < 2) return null;

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{
        keyword: `${brand} instagram`,
        location_code: 2724,
        language_code: 'es',
        depth: 10,
      }]),
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.tasks?.[0]?.result?.[0]?.items || [];

    for (const item of items) {
      const url = item.url || '';
      const match = url.match(/instagram\.com\/([A-Za-z0-9_.]{3,30})\/?$/);
      if (match && !IG_BLACKLIST_HANDLES.includes(match[1].toLowerCase())) {
        const handle = match[1];
        if (handleMatchesBrand(handle, domain, crawl.companyName)) {
          console.log(`[instagram] Found via broad Google search: @${handle} for "${brand}" ✓`);
          return handle;
        } else {
          console.log(`[instagram] Broad search rejected @${handle} — doesn't match "${domain}" or "${crawl.companyName}"`);
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

export async function runInstagram(
  crawlData: CrawlResult,
  competitorUrls: string[] = [],
  userHandle?: string,
): Promise<InstagramResult> {
  const domain = (() => {
    try { return new URL(crawlData.finalUrl || '').hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; }
  })();

  // Helper: accept handle only if it passes brand match validation.
  // userHandle (explicitly set by the client) is trusted — no validation.
  const validate = (h: string | null | undefined): string | undefined => {
    if (!h) return undefined;
    if (handleMatchesBrand(h, domain, crawlData.companyName)) return h;
    console.log(`[instagram] Rejected @${h} — doesn't match domain "${domain}" or company "${crawlData.companyName}"`);
    return undefined;
  };

  // Priority 0: user explicitly set handle (trusted)
  let handle: string | undefined = userHandle;

  // Priority 1: handle detected during crawl (needs validation — crawl may
  // have picked up a third-party account in footer/testimonials/credits)
  if (!handle) handle = validate(crawlData.instagramHandle);

  // Fallback 1: extract handle from the site HTML (needs validation for
  // the same reason — any instagram.com link in the page qualifies)
  if (!handle && crawlData.finalUrl) {
    handle = validate(await extractHandleFromSite(crawlData.finalUrl));
  }

  // Fallback 2: search Google for "site:instagram.com {brand}"
  if (!handle) {
    handle = await searchInstagramHandle(crawlData) || undefined;
  }

  // Fallback 3: broader Google search "{brand} instagram" (catches third-party mentions)
  if (!handle) {
    handle = await searchInstagramHandleBroad(crawlData) || undefined;
  }

  if (!handle) {
    return { found: false, reason: 'No Instagram account matching the brand found via website or search' };
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
  // Method 1: Apify Instagram Profile Scraper Actor (most reliable)
  if (APIFY_TOKEN) {
    try {
      const actorRes = await axios.post(
        `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=45`,
        { usernames: [handle] },
        { timeout: 200_000, headers: { 'Content-Type': 'application/json' } },
      );
      const items = actorRes.data;
      if (Array.isArray(items) && items.length > 0) {
        const p = items[0];
        // Extract post frequency from latestPosts
        const latestPosts: any[] = p.latestPosts || [];
        const now = Date.now();
        const ninetyDaysAgo = now - 90 * 86_400_000;
        const sevenDaysAgo = now - 7 * 86_400_000;

        const postsWithDates = latestPosts
          .map((post: any) => ({ ...post, ts: new Date(post.timestamp || 0).getTime() }))
          .filter((post: any) => post.ts > 0);

        const postsLast90Days = postsWithDates.filter((post: any) => post.ts >= ninetyDaysAgo).length;
        const postsLast7Days = postsWithDates.filter((post: any) => post.ts >= sevenDaysAgo).length;
        const lastPostDate = postsWithDates.length > 0
          ? new Date(Math.max(...postsWithDates.map((p: any) => p.ts))).toISOString()
          : undefined;

        // Calculate engagement from recent posts
        let engagementRate: number | undefined;
        let avgLikes: number | undefined;
        let avgComments: number | undefined;
        if (postsWithDates.length > 0 && (p.followersCount ?? 0) > 0) {
          const totalLikes = postsWithDates.reduce((s: number, post: any) => s + (post.likesCount || 0), 0);
          const totalComments = postsWithDates.reduce((s: number, post: any) => s + (post.commentsCount || 0), 0);
          avgLikes = Math.round(totalLikes / postsWithDates.length);
          avgComments = Math.round(totalComments / postsWithDates.length);
          engagementRate = Math.round(((avgLikes + avgComments) / p.followersCount) * 10000) / 100;
        }

        console.log(`[instagram] Apify Actor: @${handle} — ${p.followersCount} followers, ${postsLast90Days} posts/90d, ER ${engagementRate ?? '?'}%`);
        return {
          found: true,
          handle,
          url: `https://www.instagram.com/${handle}/`,
          followers: p.followersCount,
          following: p.followsCount,
          posts: p.postsCount,
          bio: (p.biography || '').slice(0, 200),
          isVerified: p.verified,
          isBusinessAccount: p.isBusinessAccount,
          businessCategory: p.businessCategoryName || undefined,
          externalUrl: p.externalUrl || undefined,
          // Content pillar data
          postsLast90Days,
          postsLast7Days,
          lastPostDate,
          engagementRate,
          avgLikes,
          avgComments,
        };
      }
    } catch (e) {
      console.log(`[instagram] Apify Actor failed for @${handle}: ${(e as Error).message?.slice(0, 80)}`);
    }
  }

  // Apify failed or unavailable — return handle+URL only
  // (Instagram blocks direct API and HTML scraping from serverless IPs;
  //  Methods 2 & 3 removed — they never succeeded and wasted ~23s)
  console.log(`[instagram] No data for @${handle} — returning handle+URL only`);
  return {
    found: true,
    handle,
    url: `https://www.instagram.com/${handle}/`,
    reason: APIFY_TOKEN
      ? 'Apify scraper could not retrieve profile data'
      : 'No APIFY_TOKEN configured — Instagram data unavailable',
  };
}

async function extractHandleFromSite(siteUrl: string): Promise<string | null> {
  try {
    const normalized = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
    const res = await axios.get(normalized, {
      timeout: 60_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
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

