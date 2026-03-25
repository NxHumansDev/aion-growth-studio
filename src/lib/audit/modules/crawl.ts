import axios from 'axios';
import * as cheerio from 'cheerio';
import type { BusinessType, CrawlResult, HreflangAlternate } from '../types';

const ANTHROPIC_API_KEY =
  (typeof import.meta !== 'undefined' ? import.meta.env?.ANTHROPIC_API_KEY : undefined)
  || process.env.ANTHROPIC_API_KEY;

const GENERIC_TITLES = new Set([
  'inicio', 'home', 'index', 'bienvenido', 'bienvenida', 'welcome', 'homepage',
  'portada', 'main', 'principal', 'accueil', 'startseite',
]);

/** Hierarchy: Schema Org/LB > Schema WebSite > og:site_name > title (after separator) > domain */
function extractCompanyName(
  $: ReturnType<typeof cheerio.load>,
  schemaObjs: any[],
  domain: string,
  title: string,
): string {
  // 1. Schema Organization or LocalBusiness name
  for (const obj of schemaObjs) {
    const t = String(obj['@type'] || '');
    if (/organization|localbusiness|restaurant|store|realestate/i.test(t)) {
      const n = obj.name?.trim();
      if (n && n.length > 1 && !GENERIC_TITLES.has(n.toLowerCase())) return n;
    }
  }
  // 2. Schema WebSite name
  for (const obj of schemaObjs) {
    if (/website/i.test(String(obj['@type'] || ''))) {
      const n = obj.name?.trim();
      if (n && n.length > 1 && !GENERIC_TITLES.has(n.toLowerCase())) return n;
    }
  }
  // 3. og:site_name
  const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim();
  if (ogSite && ogSite.length > 1 && !GENERIC_TITLES.has(ogSite.toLowerCase())) return ogSite;

  // 4. Title with separator — brand is usually the LAST non-generic part
  if (title) {
    for (const sep of [' | ', ' - ', ' — ', ' · ']) {
      if (title.includes(sep)) {
        const parts = title.split(sep).map(s => s.trim()).filter(s => s.length > 1);
        // Rightmost non-generic wins
        for (let i = parts.length - 1; i >= 0; i--) {
          if (!GENERIC_TITLES.has(parts[i].toLowerCase())) return parts[i];
        }
        break;
      }
    }
    // 5. Title is a single meaningful word
    if (!GENERIC_TITLES.has(title.toLowerCase()) && title.length > 2 && !/\s/.test(title)) {
      return title;
    }
  }

  // 6. Domain-based: split camelCase/hyphens and capitalise
  const base = domain.replace(/\.[a-z]{2,6}$/i, '').replace(/^www\./, '').replace(/-/g, ' ');
  const spaced = base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced.length > 1
    ? spaced.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    : domain;
}

const SPANISH_PLACES: Record<string, string> = {
  madrid: 'Madrid', barcelona: 'Barcelona', valencia: 'Valencia', sevilla: 'Sevilla',
  bilbao: 'Bilbao', malaga: 'Málaga', zaragoza: 'Zaragoza', murcia: 'Murcia',
  comillas: 'Comillas, Cantabria', santander: 'Santander', burgos: 'Burgos',
  alicante: 'Alicante', granada: 'Granada', pamplona: 'Pamplona',
  tenerife: 'Tenerife', mallorca: 'Mallorca', ibiza: 'Ibiza',
  cadiz: 'Cádiz', toledo: 'Toledo', segovia: 'Segovia', salamanca: 'Salamanca',
  gijon: 'Gijón', oviedo: 'Oviedo', vigo: 'Vigo', cordoba: 'Córdoba',
  valladolid: 'Valladolid', cartagena: 'Cartagena', almeria: 'Almería',
  tarragona: 'Tarragona', lleida: 'Lleida', girona: 'Girona',
  torrejón: 'Torrejón de Ardoz', torrejon: 'Torrejón de Ardoz',
  benidorm: 'Benidorm', marbella: 'Marbella', torremolinos: 'Torremolinos',
};

/** Extracts city/region hint. Priority: schema address > HTML text > domain */
function extractLocationHint(
  $: ReturnType<typeof cheerio.load>,
  schemaObjs: any[],
  domain: string,
): string | undefined {
  // 1. Schema Organization/LocalBusiness address
  for (const obj of schemaObjs) {
    const addr = obj.address;
    if (addr && typeof addr === 'object') {
      const locality = addr.addressLocality?.trim();
      if (locality && locality.length > 1) {
        const region = addr.addressRegion?.trim();
        return region ? `${locality}, ${region}` : locality;
      }
    }
  }

  // 2. HTML text patterns ("en Madrid", "de Barcelona", etc.)
  const bodyText = $('body').text().slice(0, 8000);
  const LOC_RE = /\b(?:en|de|from|in)\s+([A-ZÁÉÍÓÚÑÜ][a-záéíóúñüa-z]{3,}(?:\s[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]{3,})?)\b/;
  const NON_PLACES = new Set(['nuestro', 'nuestra', 'nuestros', 'todo', 'cada', 'este', 'esta',
    'todos', 'ellos', 'some', 'this', 'that', 'your', 'their', 'every', 'which', 'more', 'other']);
  const m = bodyText.match(LOC_RE);
  if (m) {
    const candidate = m[1];
    if (!NON_PLACES.has(candidate.toLowerCase().split(' ')[0])) return candidate;
  }

  // 3. Domain-based geographic keyword lookup
  const base = domain.replace(/\.[a-z]{2,6}$/i, '').replace(/^www\./, '').toLowerCase();
  for (const [key, value] of Object.entries(SPANISH_PLACES)) {
    if (base.includes(key)) return value;
  }

  return undefined;
}

function looksEnglish(text: string): boolean {
  const lower = text.toLowerCase();
  const en = ['the ', 'and ', 'with ', 'for ', 'our ', 'we ', 'your ', 'you ', 'through ', 'years '];
  const es = ['de ', 'en ', 'que ', 'para ', 'con ', 'una ', 'los ', 'las ', 'del ', 'por ', 'su '];
  const enCount = en.filter(w => lower.includes(w)).length;
  const esCount = es.filter(w => lower.includes(w)).length;
  return enCount >= 3 && esCount < 2 && !/[áéíóúñü¿¡]/i.test(text);
}

async function translateToSpanish(text: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Traduce este texto al español de forma natural. Devuelve solo el texto traducido, sin explicaciones:\n\n${text}`,
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.content?.[0]?.text?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
    let description = ($('meta[name="description"]').attr('content') || '').trim().slice(0, 200);
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

    // Extract schema @type values + raw objects for company/location extraction
    const schemaTypes: string[] = [];
    const schemaObjects: any[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || '');
        extractSchemaTypes(json, schemaTypes);
        flattenSchemaObjects(json, schemaObjects);
      } catch { /* invalid JSON, skip */ }
    });
    const uniqueSchemaTypes = [...new Set(schemaTypes)];

    const hostname = new URL(url).hostname;
    const internalLinks = $('a[href]')
      .filter((_, el) => {
        const href = $(el).attr('href') || '';
        return href.startsWith('/') || href.includes(hostname);
      })
      .length;

    const bodyText = $('body').text().trim();
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

    // Quick sitemap + robots.txt check in parallel (direct HTTP, independent of DataForSEO)
    let hasSitemap = false;
    let hasRobotsTxt = false;
    try {
      const [sitemapRes, robotsRes] = await Promise.all([
        axios.head(new URL('/sitemap.xml', url).href, { timeout: 3000, validateStatus: () => true }),
        axios.head(new URL('/robots.txt', url).href, { timeout: 3000, validateStatus: () => true }),
      ]);
      hasSitemap = sitemapRes.status < 400;
      hasRobotsTxt = robotsRes.status < 400;
    } catch {
      // network error — leave both false
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

    // ── Fix 4: Extract cleaned company name ──────────────────────
    const companyName = extractCompanyName($, schemaObjects, domain, title);

    // ── Fix 3: Extract location hint for GEO queries ──────────────
    const locationHint = extractLocationHint($, schemaObjects, domain);

    // ── Fix 6: Translate description to Spanish if it looks English
    if (description && looksEnglish(description)) {
      const translated = await translateToSpanish(description);
      if (translated) description = translated;
    }

    // ── Blog detection: nav/footer links pointing to blog section root ──
    const siteOrigin = new URL(url.startsWith('http') ? url : `https://${url}`).origin;
    const BLOG_ROOT_RE = /^(https?:\/\/[^\/]+)?\/(blog|noticias|news|articulos|actualidad|insights|magazine|recursos|journal)(?:\/|$)/i;
    const blogRootHrefs = allLinks.filter(l => {
      const abs = l.startsWith('http') ? l : `${siteOrigin}${l.startsWith('/') ? '' : '/'}${l}`;
      return abs.startsWith(siteOrigin) && BLOG_ROOT_RE.test(l);
    });
    const blogPostHrefs = allLinks.filter(l =>
      /\/(blog|noticias|news|articulos|actualidad|insights)\/[^\/]{3,}/.test(l),
    );
    const hasBlog = blogRootHrefs.length > 0 || blogPostHrefs.length >= 2;
    let blogUrl: string | undefined;
    if (blogRootHrefs.length > 0) {
      const shortest = [...blogRootHrefs].sort((a, b) => a.length - b.length)[0];
      try { blogUrl = new URL(shortest.startsWith('http') ? shortest : shortest, url).href.split('?')[0].split('#')[0]; } catch {}
    } else if (blogPostHrefs.length >= 2) {
      const m = blogPostHrefs[0].match(/^(?:https?:\/\/[^\/]+)?\/(blog|noticias|news|articulos|actualidad|insights)\//i);
      if (m) blogUrl = `${siteOrigin}/${m[1]}`;
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
      hasRobotsTxt,
      hasSchemaMarkup,
      ...(uniqueSchemaTypes.length > 0 && { schemaTypes: uniqueSchemaTypes }),
      internalLinks,
      wordCount,
      loadedOk: true,
      businessType,
      companyName,
      ...(locationHint && { locationHint }),
      ...(instagramHandle && { instagramHandle }),
      ...(twitterHandle && { twitterHandle }),
      ...(linkedinUrl && { linkedinUrl }),
      ...(hreflangAlternates.length > 0 && { hreflangAlternates }),
      ...(hasBlog && { hasBlog }),
      ...(blogUrl && { blogUrl }),
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
function detectBusinessType(
  html: string,
  _$: ReturnType<typeof cheerio.load>,
  links: string[],
): BusinessType {
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

function extractSchemaTypes(obj: any, types: string[]): void {
  if (!obj || typeof obj !== 'object') return;
  if (obj['@type']) {
    const t = obj['@type'];
    if (Array.isArray(t)) types.push(...t);
    else types.push(t);
  }
  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) extractSchemaTypes(item, types);
  }
}

function flattenSchemaObjects(obj: any, result: any[]): void {
  if (!obj || typeof obj !== 'object') return;
  if (obj['@type']) result.push(obj);
  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) flattenSchemaObjects(item, result);
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
