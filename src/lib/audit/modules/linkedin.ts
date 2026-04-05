import axios from 'axios';
import * as cheerio from 'cheerio';
import type { LinkedInResult, LinkedInCompetitor, CrawlResult } from '../types';

const APIFY_TOKEN = import.meta.env?.APIFY_TOKEN || process.env.APIFY_TOKEN;
const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

/** Search Google for "site:linkedin.com/company {brand}" to find LinkedIn page */
async function searchLinkedInUrl(crawl: CrawlResult): Promise<string | null> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return null;

  const brand = crawl.title?.split(/[-|–—·:]/)[0]?.trim();
  if (!brand || brand.length < 2) return null;

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
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
): Promise<LinkedInResult> {
  let linkedinUrl = userLinkedinUrl || crawlData.linkedinUrl;

  // Fallback: try to extract LinkedIn URL from the site directly
  if (!linkedinUrl && crawlData.finalUrl) {
    const extracted = await extractLinkedInFromSite(crawlData.finalUrl);
    if (extracted) {
      return { found: true, ...extracted };
    }
  }

  // Fallback 2: search Google for "site:linkedin.com/company {brand}"
  if (!linkedinUrl) {
    linkedinUrl = await searchLinkedInUrl(crawlData) || undefined;
  }

  if (!linkedinUrl) {
    return { found: false, reason: 'No LinkedIn page found via website or search' };
  }

  // Normalise to absolute URL
  const url = linkedinUrl.startsWith('http') ? linkedinUrl : `https://${linkedinUrl}`;
  const profile = await fetchLinkedInProfile(url);

  // Try to find LinkedIn pages for up to 3 competitors
  const competitorResults: LinkedInCompetitor[] = [];
  if (competitorUrls.length > 0) {
    const found = await Promise.all(
      competitorUrls.slice(0, 3).map(extractLinkedInFromSite),
    );
    for (const cp of found) {
      if (cp) competitorResults.push(cp);
    }
  }

  return {
    ...profile,
    ...(competitorResults.length > 0 && { competitors: competitorResults }),
  };
}

async function fetchLinkedInProfile(url: string): Promise<LinkedInResult> {
  // Try with Apify residential proxy first (needed on Vercel/cloud)
  // Fall back to direct request (works on localhost)
  const attempts = [
    ...(APIFY_TOKEN
      ? [{ headers: HEADERS, timeout: 12000, maxRedirects: 3, validateStatus: (s: number) => s < 500, ...apifyProxyConfig() }]
      : []),
    { headers: HEADERS, timeout: 10000, maxRedirects: 3, validateStatus: (s: number) => s < 500 },
  ];

  let lastErr: any;

  for (const config of attempts) {
    try {
      const res = await axios.get(url, config);
      const $ = cheerio.load(res.data as string);

      // LinkedIn embeds rich data in og: meta tags for crawlers
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
      timeout: 6000,
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
