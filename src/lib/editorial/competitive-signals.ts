/**
 * Editorial AI — competitive signals & rising keyword detection.
 *
 * Two weekly jobs that feed the Growth Agent with external visibility signals:
 *
 *   1. Competitor content mining
 *      For each configured competitor URL, fetch its sitemap.xml, find
 *      articles published in the last 30 days, extract topics, and cross
 *      against the client's priority_keywords. Matches become "respond to
 *      this" recommendations.
 *
 *   2. Rising keywords (Google Trends proxy via DataForSEO)
 *      Query the keyword_data endpoint for client.priority_keywords and
 *      sector-related terms. Detect keywords whose current monthly search
 *      volume is significantly above their 12-month average — these are
 *      trending topics the client should ride.
 *
 * Both produce lightweight signals objects that run-radar.ts passes to the
 * Growth Agent. The agent decides whether to convert them into
 * contentGeneration recommendations.
 */

import axios from 'axios';
import { embed, cosineSimilarity } from './embeddings';

const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

// ─── 1. Competitor content mining ──────────────────────────────────────

export interface CompetitorNewArticle {
  competitor_domain: string;
  url: string;
  title: string;
  published_at?: string;
  matched_keyword?: string;
  similarity?: number;   // cosine vs client priority_keywords
}

/**
 * Fetch a competitor's sitemap.xml (or /sitemap_index.xml) and extract all
 * article URLs published in the last 30 days. Uses <lastmod> to filter.
 * Falls back to the first 50 URLs if <lastmod> isn't present.
 */
async function fetchCompetitorRecentUrls(domain: string): Promise<Array<{ url: string; lastmod?: string }>> {
  const candidates = [
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://${domain}/blog/sitemap.xml`,
    `https://${domain}/news/sitemap.xml`,
  ];

  for (const sitemapUrl of candidates) {
    try {
      const res = await axios.get(sitemapUrl, {
        timeout: 10_000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONBot/1.0)' },
        validateStatus: s => s < 500,
      });
      if (res.status >= 400) continue;
      const xml = String(res.data ?? '');
      if (!xml.includes('<urlset') && !xml.includes('<sitemapindex')) continue;

      // If it's a sitemap index, we'd have to recurse. For MVP just pick URLs
      // directly from the first sitemap that has <loc> + optionally <lastmod>.
      const urlRegex = /<url>([\s\S]*?)<\/url>/g;
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      const found: Array<{ url: string; lastmod?: string }> = [];
      let match: RegExpExecArray | null;
      while ((match = urlRegex.exec(xml)) !== null) {
        const block = match[1];
        const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/);
        const lastmodMatch = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/);
        if (!locMatch) continue;
        const url = locMatch[1].trim();
        const lastmod = lastmodMatch?.[1]?.trim();

        // Heuristic: only consider URLs that look like articles, not static pages
        // (i.e. path depth >= 2 or contains "blog|news|articles|post")
        try {
          const u = new URL(url);
          const path = u.pathname.toLowerCase();
          const depthOk = path.split('/').filter(Boolean).length >= 2;
          const blogPath = /(blog|news|articles?|posts?|insights|press)/.test(path);
          if (!depthOk && !blogPath) continue;
        } catch { continue; }

        if (lastmod) {
          const ts = Date.parse(lastmod);
          if (!isNaN(ts) && ts >= cutoff) {
            found.push({ url, lastmod });
          }
        } else {
          // No lastmod — keep first 50 as best-effort candidates
          if (found.length < 50) found.push({ url });
        }
      }
      if (found.length > 0) return found.slice(0, 100);
    } catch { /* try next candidate */ }
  }
  return [];
}

/** Extract article title from the URL by a quick HEAD/GET of the <title> tag. */
async function fetchArticleTitle(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: 8_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONBot/1.0)' },
      validateStatus: s => s < 500,
      maxContentLength: 500_000,  // stop after 500KB — only need <title>
    });
    if (res.status >= 400) return null;
    const html = String(res.data ?? '');
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) return null;
    // Strip whitespace, decode basic HTML entities
    return titleMatch[1]
      .replace(/\s+/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim()
      .slice(0, 200);
  } catch { return null; }
}

export async function mineCompetitorContent(args: {
  competitorDomains: string[];
  clientPriorityKeywords: string[];
}): Promise<CompetitorNewArticle[]> {
  const { competitorDomains, clientPriorityKeywords } = args;
  if (competitorDomains.length === 0 || clientPriorityKeywords.length === 0) return [];

  // Embed client's priority_keywords once — reused to score every competitor article
  const kwEmbeddings: Array<{ kw: string; vec: number[] }> = [];
  for (const kw of clientPriorityKeywords.slice(0, 20)) {
    const e = await embed(kw);
    if (e.success && e.embedding) kwEmbeddings.push({ kw, vec: e.embedding });
  }
  if (kwEmbeddings.length === 0) return [];

  const results: CompetitorNewArticle[] = [];

  for (const domain of competitorDomains.slice(0, 5)) {  // cap 5 competitors
    const recentUrls = await fetchCompetitorRecentUrls(domain);
    if (recentUrls.length === 0) continue;

    // Only process top 15 per competitor to control cost
    for (const { url, lastmod } of recentUrls.slice(0, 15)) {
      const title = await fetchArticleTitle(url);
      if (!title || title.length < 10) continue;

      // Embed title + match against priority_keywords
      const titleEmb = await embed(title);
      if (!titleEmb.success || !titleEmb.embedding) continue;

      let best: { kw: string; similarity: number } | null = null;
      for (const { kw, vec } of kwEmbeddings) {
        const sim = cosineSimilarity(titleEmb.embedding, vec);
        if (sim >= 0.45 && (!best || sim > best.similarity)) {
          best = { kw, similarity: sim };
        }
      }

      if (best) {
        results.push({
          competitor_domain: domain,
          url,
          title,
          published_at: lastmod,
          matched_keyword: best.kw,
          similarity: +best.similarity.toFixed(3),
        });
      }
    }
  }

  return results.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)).slice(0, 10);
}

// ─── 2. Rising keywords (via DataForSEO keyword_data) ──────────────────

export interface RisingKeyword {
  keyword: string;
  current_search_volume: number;
  avg_12m_search_volume: number;
  growth_ratio: number;   // current / 12m avg; > 1.5 = trending
}

async function fetchSearchVolumeData(
  keywords: string[],
  language: 'es' | 'en',
): Promise<Array<{ keyword: string; search_volume: number; monthly_searches?: Array<{ year: number; month: number; search_volume: number }> }>> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return [];
  if (keywords.length === 0) return [];

  try {
    const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
    const locationCode = language === 'es' ? 2724 : 2840;
    const languageCode = language === 'es' ? 'es' : 'en';

    const res = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify([{
        keywords: keywords.slice(0, 200),
        location_code: locationCode,
        language_code: languageCode,
      }]),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.tasks?.[0]?.result ?? [];
  } catch { return []; }
}

export async function detectRisingKeywords(args: {
  priorityKeywords: string[];
  language: 'es' | 'en';
}): Promise<RisingKeyword[]> {
  const { priorityKeywords, language } = args;
  if (priorityKeywords.length === 0) return [];

  const data = await fetchSearchVolumeData(priorityKeywords, language);
  const rising: RisingKeyword[] = [];

  for (const row of data) {
    if (!row.monthly_searches || !Array.isArray(row.monthly_searches) || row.monthly_searches.length < 3) continue;

    // DFS returns monthly_searches sorted DESC by date. Most recent first.
    const recent = row.monthly_searches[0]?.search_volume ?? 0;
    const monthsN = row.monthly_searches.slice(1, 13);  // months 2-13 = 12 months avg
    if (monthsN.length === 0) continue;
    const avgPrior = monthsN.reduce((s, m) => s + (m.search_volume ?? 0), 0) / monthsN.length;
    if (avgPrior === 0) continue;

    const ratio = recent / avgPrior;
    if (ratio >= 1.5 && recent >= 100) {
      rising.push({
        keyword: row.keyword,
        current_search_volume: recent,
        avg_12m_search_volume: Math.round(avgPrior),
        growth_ratio: +ratio.toFixed(2),
      });
    }
  }

  return rising.sort((a, b) => b.growth_ratio - a.growth_ratio).slice(0, 8);
}

// ─── Combined: fetch all competitive signals for a client ──────────────

export interface CompetitiveSignals {
  competitor_articles: CompetitorNewArticle[];
  rising_keywords: RisingKeyword[];
  unlinked_mentions: Array<{ title: string; source: string; url?: string }>;
}

/**
 * Pull all three signal types in one call. Called from run-radar.ts
 * post-pipeline. Non-fatal: each sub-fetch fails gracefully.
 */
export async function gatherCompetitiveSignals(args: {
  competitorDomains: string[];
  priorityKeywords: string[];
  language: 'es' | 'en';
  newsHeadlines?: Array<{ title: string; source: string; url?: string; linksBack?: boolean }>;
}): Promise<CompetitiveSignals> {
  const [competitorArticles, risingKeywords] = await Promise.all([
    mineCompetitorContent({
      competitorDomains: args.competitorDomains,
      clientPriorityKeywords: args.priorityKeywords,
    }).catch(() => [] as CompetitorNewArticle[]),
    detectRisingKeywords({
      priorityKeywords: args.priorityKeywords,
      language: args.language,
    }).catch(() => [] as RisingKeyword[]),
  ]);

  const unlinkedMentions = (args.newsHeadlines ?? [])
    .filter(h => h.linksBack === false)
    .slice(0, 5)
    .map(h => ({ title: h.title, source: h.source, url: h.url }));

  return {
    competitor_articles: competitorArticles,
    rising_keywords: risingKeywords,
    unlinked_mentions: unlinkedMentions,
  };
}
