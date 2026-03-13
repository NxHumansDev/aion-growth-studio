import axios from 'axios';
import * as cheerio from 'cheerio';
import type { BusinessType, CrawlResult, HreflangAlternate } from '../types';

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

    const businessType = detectBusinessType(html, $, allLinks);

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
      businessType,
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

/**
 * Detect the business model from HTML signals.
 * Uses a scoring approach — highest score wins.
 * Operates on first 80KB only to avoid regex slowness on large pages.
 */
function detectBusinessType(html: string, links: string[]): BusinessType {
  try {
    // Cap input to avoid slow regexes on large HTML
    const text = html.slice(0, 80_000).toLowerCase();
    const scores: Record<BusinessType, number> = { ecommerce: 0, saas: 0, b2b: 0, local: 0, media: 0, unknown: 0 };

    // ── Ecommerce ──────────────────────────────────────────────────
    if (/shopify|woocommerce|magento|prestashop|bigcommerce|tiendanube/.test(text)) scores.ecommerce += 4;
    if (links.some(l => /\/(cart|carrito|checkout|cesta|bag|basket)/.test(l))) scores.ecommerce += 3;
    if (/"@type"\s*:\s*"product"|"@type"\s*:\s*"offer"/.test(text)) scores.ecommerce += 3;
    if (/a\u00f1adir al carrito|add to cart|comprar ahora|buy now|agregar al carrito/.test(text)) scores.ecommerce += 3;

    // ── SaaS ───────────────────────────────────────────────────────
    if (/free trial|prueba gratis|start for free|empieza gratis/.test(text)) scores.saas += 4;
    if (/\/pricing|\/precios|\/planes|\/plans|\/subscription/.test(text)) scores.saas += 3;
    if (/intercom|segment\.com|mixpanel|heap\.io|amplitude|stripe\.js/.test(text)) scores.saas += 3;
    if (/monthly|annually|por mes|al mes|per seat/.test(text)) scores.saas += 2;

    // ── B2B ────────────────────────────────────────────────────────
    if (/pedir demo|request a demo|solicitar demo|book a demo|contact sales/.test(text)) scores.b2b += 4;
    if (/caso de.*xito|case stud|testimonios de clientes|trusted by/.test(text)) scores.b2b += 3;
    if (/solicitar presupuesto|get a quote|contact us|cont\u00e1ctanos/.test(text)) scores.b2b += 2;
    if (links.some(l => l.includes('linkedin.com'))) scores.b2b += 1;
    if (/enterprise|b2b|soluci\u00f3n empresarial/.test(text)) scores.b2b += 2;

    // ── Local ──────────────────────────────────────────────────────
    if (/"@type"\s*:\s*"localbusiness"|"@type"\s*:\s*"restaurant"|"@type"\s*:\s*"store"/.test(text)) scores.local += 4;
    if (/\+34|\+1|\+44|tel:|phone:/.test(text)) scores.local += 2;
    if (/maps\.google|google\.com\/maps|goo\.gl\/maps/.test(text)) scores.local += 3;
    if (/horario|opening hours|abierto|cerrado/.test(text)) scores.local += 2;

    // ── Media ──────────────────────────────────────────────────────
    const blogLinks = links.filter(l => /\/(blog|news|articulo|article|post|noticias)\//.test(l)).length;
    if (blogLinks >= 5) scores.media += 4;
    else if (blogLinks >= 2) scores.media += 2;
    if (/newsletter|subscribe|suscribirse/.test(text)) scores.media += 2;

    // ── Pick winner ────────────────────────────────────────────────
    const winner = (Object.entries(scores) as [BusinessType, number][])
      .filter(([t]) => t !== 'unknown')
      .sort(([, a], [, b]) => b - a)[0];

    return winner[1] >= 3 ? winner[0] : 'unknown';
  } catch {
    return 'unknown';
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
