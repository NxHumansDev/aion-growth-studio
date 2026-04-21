import axios from 'axios';
import * as cheerio from 'cheerio';
import type { ContentCadenceResult } from '../types';

// Expanded blog path patterns
const BLOG_PATH_RE = /\/(blog|noticias|news|post|posts|articles|articulos|actualidad|magazine|journal|recursos|insights|stories|publications|publicaciones|novedades|press|prensa|beauty|tips|guide|guides|consejos|the-mag|revista|community|comunidad|learn|aprende)\//i;

const BLOG_LINK_RE = /\/(blog|noticias|news|articulos|articles|actualidad|magazine|insights|recursos|stories|publicaciones|novedades|press|prensa|beauty|tips|guide|guides|consejos|the-mag|revista|community|comunidad|learn|aprende|journal)\/?$/i;

async function fetchSitemapXml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.includes('<url>') && !text.includes('<sitemap>')) return null;
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseBlogDates(xml: string, requireBlogPath: boolean): Date[] {
  const dates: Date[] = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/i);
    const lastmodMatch = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i);
    if (!locMatch || !lastmodMatch) continue;
    const loc = locMatch[1].trim();
    if (requireBlogPath && !BLOG_PATH_RE.test(loc)) continue;
    const d = new Date(lastmodMatch[1].trim());
    if (!isNaN(d.getTime())) dates.push(d);
  }
  return dates;
}

function deriveBlogUrl(sitemapUrl: string, origin: string, xml: string, requireBlogPath: boolean): string | undefined {
  const sitemapPath = sitemapUrl.replace(origin, '');
  const dirMatch = sitemapPath.match(/^\/([^\/]+)\/sitemap\.xml$/i);
  if (dirMatch && BLOG_LINK_RE.test(`/${dirMatch[1]}/`)) {
    return `${origin}/${dirMatch[1]}`;
  }
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/i);
    if (!locMatch) continue;
    const loc = locMatch[1].trim();
    if (requireBlogPath && !BLOG_PATH_RE.test(loc)) continue;
    const m = loc.match(/^https?:\/\/[^\/]+\/(blog|noticias|news|articulos|articles|actualidad|magazine|insights|recursos|stories|publicaciones|novedades|press|prensa)\//i);
    if (m) return `${origin}/${m[1]}`;
  }
  return undefined;
}

/** Try to find blog by crawling the homepage for blog links and common paths */
async function findBlogByCrawl(origin: string): Promise<{ blogUrl?: string; postCount?: number; lastPostDate?: string; dates: Date[] }> {
  try {
    // Fetch homepage and look for blog links
    const res = await axios.get(origin, {
      timeout: 60_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
      validateStatus: (s) => s < 500,
    });
    const $ = cheerio.load(String(res.data));

    // Find blog link in navigation/footer
    let blogUrl: string | undefined;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (BLOG_LINK_RE.test(href)) {
        blogUrl = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
      }
    });

    // If no link found, try common paths directly
    if (!blogUrl) {
      const commonPaths = ['/blog', '/noticias', '/news', '/articulos', '/insights', '/recursos', '/magazine', '/actualidad', '/journal', '/the-mag', '/stories', '/beauty', '/tips', '/consejos', '/guides', '/community', '/learn'];
      for (const path of commonPaths) {
        try {
          const check = await axios.head(`${origin}${path}`, {
            timeout: 30_000,
            maxRedirects: 2,
            validateStatus: (s) => s < 400,
          });
          if (check.status < 400) {
            blogUrl = `${origin}${path}`;
            break;
          }
        } catch { /* continue */ }
      }
    }

    if (!blogUrl) return { dates: [] };

    // Fetch the blog page and extract post dates
    const blogRes = await axios.get(blogUrl, {
      timeout: 60_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
      validateStatus: (s) => s < 500,
    });
    const $blog = cheerio.load(String(blogRes.data));

    // Count article-like elements
    const articles = $blog('article, .post, .blog-post, .entry, [class*="post-card"], [class*="blog-card"], [class*="article-card"]');
    const postCount = articles.length || $blog('h2 a, h3 a').length;

    // Extract dates from time/date elements or meta
    const dates: Date[] = [];
    $blog('time[datetime], [class*="date"], [class*="fecha"]').each((_, el) => {
      const dt = $blog(el).attr('datetime') || $blog(el).text().trim();
      const d = new Date(dt);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2015) dates.push(d);
    });

    // Also check meta tags and structured data for dates
    $blog('meta[property="article:published_time"], meta[property="article:modified_time"]').each((_, el) => {
      const d = new Date($blog(el).attr('content') || '');
      if (!isNaN(d.getTime())) dates.push(d);
    });

    const lastPostDate = dates.length > 0
      ? dates.sort((a, b) => b.getTime() - a.getTime())[0].toISOString().split('T')[0]
      : undefined;

    return { blogUrl, postCount: postCount || undefined, lastPostDate, dates };
  } catch {
    return { dates: [] };
  }
}

export async function runContentCadence(url: string): Promise<ContentCadenceResult> {
  try {
    const origin = new URL(url.startsWith('http') ? url : `https://${url}`).origin;

    // Strategy 1: Sitemap-based detection (most reliable for dates)
    const candidates = [
      { url: `${origin}/blog/sitemap.xml`,       requireBlogPath: false },
      { url: `${origin}/sitemap-blog.xml`,       requireBlogPath: false },
      { url: `${origin}/sitemap_blog.xml`,       requireBlogPath: false },
      { url: `${origin}/post-sitemap.xml`,       requireBlogPath: false },
      { url: `${origin}/news-sitemap.xml`,       requireBlogPath: false },
      { url: `${origin}/sitemap-posts.xml`,      requireBlogPath: false },
      { url: `${origin}/sitemap.xml`,            requireBlogPath: true  },
    ];

    let dates: Date[] = [];
    let blogUrl: string | undefined;
    for (const candidate of candidates) {
      const xml = await fetchSitemapXml(candidate.url);
      if (!xml) continue;
      const parsed = parseBlogDates(xml, candidate.requireBlogPath);
      if (parsed.length >= 1) {
        dates = parsed;
        blogUrl = deriveBlogUrl(candidate.url, origin, xml, candidate.requireBlogPath);
        break;
      }
    }

    // Strategy 2: If sitemap didn't find blog, crawl homepage + common paths
    if (dates.length < 1) {
      const crawlResult = await findBlogByCrawl(origin);
      if (crawlResult.blogUrl) {
        blogUrl = crawlResult.blogUrl;
        dates = crawlResult.dates;
        // If we found a blog page but no parseable dates, still report it
        if (dates.length === 0 && crawlResult.postCount) {
          return {
            totalPosts: crawlResult.postCount,
            lastPostDate: crawlResult.lastPostDate,
            cadenceLevel: crawlResult.lastPostDate ? 'irregular' : 'inactive',
            blogUrl,
            _log: 'crawl-detected',
          };
        }
      }
    }

    if (dates.length === 0) {
      return { skipped: true, reason: 'No se ha detectado blog ni contenido publicado' };
    }

    // Sort descending (newest first)
    dates.sort((a, b) => b.getTime() - a.getTime());

    const now = new Date();
    const lastPostDate = dates[0];
    const daysSinceLastPost = Math.floor(
      (now.getTime() - lastPostDate.getTime()) / 86_400_000,
    );

    // Average interval between consecutive posts (only if 2+ dates)
    let avgDaysBetweenPosts: number | undefined;
    if (dates.length >= 2) {
      let totalInterval = 0;
      for (let i = 0; i < dates.length - 1; i++) {
        totalInterval += (dates[i].getTime() - dates[i + 1].getTime()) / 86_400_000;
      }
      avgDaysBetweenPosts = Math.round(totalInterval / (dates.length - 1));
    }

    // Posts in last 90 days
    const cutoff90 = new Date(now.getTime() - 90 * 86_400_000);
    const postsLast90Days = dates.filter((d) => d >= cutoff90).length;

    let cadenceLevel: 'active' | 'irregular' | 'inactive';
    if (avgDaysBetweenPosts != null && avgDaysBetweenPosts <= 14) {
      cadenceLevel = 'active';
    } else if ((avgDaysBetweenPosts == null || avgDaysBetweenPosts <= 60) && daysSinceLastPost <= 90) {
      cadenceLevel = 'irregular';
    } else {
      cadenceLevel = 'inactive';
    }

    return {
      totalPosts: dates.length,
      lastPostDate: lastPostDate.toISOString().split('T')[0],
      daysSinceLastPost,
      avgDaysBetweenPosts,
      postsLast90Days,
      cadenceLevel,
      ...(blogUrl && { blogUrl }),
    };
  } catch {
    return { skipped: true, reason: 'Error al analizar contenido' };
  }
}
