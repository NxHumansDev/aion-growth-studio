import axios from 'axios';
import * as cheerio from 'cheerio';
import type { CrawlResult, HreflangAlternate } from '../types';

export async function runCrawl(url: string): Promise<CrawlResult> {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0; +https://aiongrowth.studio)',
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });

    const html = String(response.data);
    const $ = cheerio.load(html);

    const title = $('title').first().text().trim().slice(0, 100);
    const description = ($('meta[name="description"]').attr('content') || '').trim().slice(0, 200);
    const h1s = $('h1')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .slice(0, 5)
      .map((h) => h.slice(0, 100));
    const h2Count = $('h2').length;

    const images = $('img');
    const imageCount = images.length;
    const imagesWithAlt = images.filter((_, el) => !!$(el).attr('alt')).length;

    const hasCanonical = $('link[rel="canonical"]').length > 0;
    const hasRobots = $('meta[name="robots"]').length > 0;
    const hasSchemaMarkup = $('script[type="application/ld+json"]').length > 0;

    const hostname = new URL(url).hostname;
    const internalLinks = $('a[href]')
      .filter((_, el) => {
        const href = $(el).attr('href') || '';
        return href.startsWith('/') || href.includes(hostname);
      })
      .length;

    const bodyText = $('body').text().trim();
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

    // Quick sitemap check
    let hasSitemap = false;
    try {
      const sitemapUrl = new URL('/sitemap.xml', url).href;
      const sitemapRes = await axios.head(sitemapUrl, { timeout: 3000, validateStatus: () => true });
      hasSitemap = sitemapRes.status < 400;
    } catch {
      // no sitemap
    }

    // Extract hreflang alternates (multi-domain detection)
    const domain = hostname.replace(/^www\./, '');
    const hreflangAlternates: HreflangAlternate[] = [];
    $('link[rel="alternate"][hreflang]').each((_, el) => {
      const hreflang = $(el).attr('hreflang');
      const href = $(el).attr('href');
      if (hreflang && href && hreflang !== 'x-default') {
        try {
          const altDomain = new URL(href).hostname.replace(/^www\./, '');
          if (altDomain !== domain) {
            hreflangAlternates.push({ hreflang, href, domain: altDomain });
          }
        } catch { /* invalid URL, skip */ }
      }
    });

    // Extract social media handles — check <a href> first, then full HTML text
    const allLinks = $('a[href]').map((_, el) => $(el).attr('href') || '').get();

    let instagramHandle = extractHandle(allLinks, /instagram\.com\/([A-Za-z0-9_.]+)/);
    const twitterHandle = extractHandle(allLinks, /(?:twitter|x)\.com\/([A-Za-z0-9_]+)/);
    const linkedinRaw = allLinks.find((h) => h.includes('linkedin.com/company') || h.includes('linkedin.com/in'));
    let linkedinUrl = linkedinRaw ? linkedinRaw.split('?')[0] : undefined;

    // Fallback: search raw HTML for social patterns (catches JS-rendered links, data-href, etc.)
    const IG_BLACKLIST = ['explore', 'reels', 'stories', 'p', 'tv', 'share', 'sharer', 'reel'];
    if (!instagramHandle) {
      const igMatch = html.match(/instagram\.com\/([A-Za-z0-9_.]{3,30})(?:\/|\?|"|'|\s|\\)/);
      const igCandidate = igMatch?.[1];
      if (igCandidate && !IG_BLACKLIST.includes(igCandidate)) {
        instagramHandle = igCandidate;
      }
    }
    if (!linkedinUrl) {
      const liMatch = html.match(/linkedin\.com\/(company|in)\/([A-Za-z0-9_%\-]+)/);
      if (liMatch) {
        linkedinUrl = `https://www.linkedin.com/${liMatch[1]}/${liMatch[2]}`;
      }
    }

    return {
      title,
      description,
      h1s,
      h2Count,
      imageCount,
      imagesWithAlt,
      hasCanonical,
      hasRobots,
      hasSitemap,
      hasSchemaMarkup,
      internalLinks,
      wordCount,
      loadedOk: true,
      ...(instagramHandle && { instagramHandle }),
      ...(twitterHandle && { twitterHandle }),
      ...(linkedinUrl && { linkedinUrl }),
      ...(hreflangAlternates.length > 0 && { hreflangAlternates }),
    };
  } catch (err: any) {
    return {
      loadedOk: false,
      error: (err.message || 'Failed to crawl').slice(0, 150),
    };
  }
}

function extractHandle(links: string[], pattern: RegExp): string | undefined {
  for (const link of links) {
    const match = link.match(pattern);
    if (match?.[1] && !['explore', 'reels', 'stories', 'p', 'tv', 'share', 'sharer'].includes(match[1])) {
      return match[1];
    }
  }
  return undefined;
}
