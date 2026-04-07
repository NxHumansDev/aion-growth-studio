import type { GBPResult, CrawlResult } from '../types';

const API_KEY = import.meta.env?.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

// ── Google Places API (New) ─────────────────────────────────────

async function searchPlaces(query: string): Promise<any[]> {
  if (!API_KEY) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.formattedAddress,places.types,places.websiteUri',
      },
      body: JSON.stringify({ textQuery: query }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.log(`[gbp] Places API ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.places || [];
  } catch (err) {
    clearTimeout(timer);
    console.log(`[gbp] Places API fail: ${(err as Error).message?.slice(0, 80)}`);
    return [];
  }
}

// ── DataForSEO Business Data (fallback) ─────────────────────────

const SPAIN_CITIES = [1005404, 1005479, 1005550]; // Madrid, Barcelona, Valencia

async function searchDFS(keyword: string): Promise<{ title: string; rating: number; reviews: number; address: string; category: string } | null> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return null;
  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');

  for (const locCode of SPAIN_CITIES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch('https://api.dataforseo.com/v3/business_data/google/my_business_info/live', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{ keyword, location_code: locCode, language_code: 'es' }]),
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const item = data?.tasks?.[0]?.result?.[0]?.items?.[0];
      if (item?.title && item?.rating?.value) {
        console.log(`[gbp] DFS found "${item.title}": ${item.rating.value}★ (loc=${locCode})`);
        return {
          title: item.title,
          rating: item.rating.value,
          reviews: item.rating.votes_count ?? 0,
          address: item.address || '',
          category: item.category || '',
        };
      }
    } catch { /* try next city */ }
  }
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────

function bareDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').replace(/^tienda\./, ''); }
  catch { return ''; }
}

function pickBest(places: any[], auditDomain: string): any | null {
  if (places.length === 0) return null;
  const domainMatch = places.find(p => {
    const web = bareDomain(p.websiteUri || '');
    return web && auditDomain.includes(web);
  });
  if (domainMatch) return domainMatch;
  let best = places[0];
  for (const p of places.slice(1)) {
    const bs = (best.rating ?? 0) * 20 + Math.log10((best.userRatingCount ?? 0) + 1);
    const ps = (p.rating ?? 0) * 20 + Math.log10((p.userRatingCount ?? 0) + 1);
    if (ps > bs) best = p;
  }
  return best;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Quick GBP lookup by company name + domain — used for competitor comparison.
 * Tries multiple search strategies: name, domain, name+city variations.
 */
export async function lookupGBP(companyName: string, domain: string): Promise<{ rating: number; reviewCount: number } | null> {
  // Build search terms: company name, domain, domain as words
  const domainBase = domain.split('.')[0];
  const domainWords = domainBase.replace(/-/g, ' ');
  const terms = [companyName, domainBase, domainWords].filter((t, i, a) =>
    t && t.length > 2 && a.indexOf(t) === i,
  );

  // Try Google Places with each term
  for (const term of terms) {
    const places = await searchPlaces(term);
    const place = pickBest(places, domain);
    if (place?.rating) {
      console.log(`[gbp:lookup] Found "${place.displayName?.text}" for "${term}" → ${place.rating}★`);
      return { rating: place.rating, reviewCount: place.userRatingCount ?? 0 };
    }
  }

  // Fallback: DataForSEO with each term
  for (const term of terms) {
    const dfs = await searchDFS(term);
    if (dfs) return { rating: dfs.rating, reviewCount: dfs.reviews };
  }

  return null;
}

export async function runGBP(url: string, crawl: CrawlResult): Promise<GBPResult> {
  if (!API_KEY && !DFS_LOGIN) {
    return { skipped: true, reason: 'No GBP API configured' };
  }

  const auditDomain = new URL(url).hostname.replace(/^www\./, '');
  const titleName = crawl.title?.split(/[-|–—·:]/)[0]?.trim() || '';
  const GENERIC = /^(home|inicio|welcome|bienvenid|index|main|page|untitled)$/i;
  const companyName = crawl.companyName || (titleName && !GENERIC.test(titleName) ? titleName : '');
  const domainName = auditDomain.split('.')[0].replace(/-/g, ' ');

  try {
    // ── Try Google Places API first ──────────────────────────────
    const searchTerms = [companyName, domainName].filter(Boolean);
    for (const term of searchTerms) {
      const places = await searchPlaces(term);
      if (places.length > 0) {
        const place = pickBest(places, auditDomain);
        if (place) {
          const name = place.displayName?.text || '';
          console.log(`[gbp] Google Places: "${name}" ${place.rating}★ (${place.userRatingCount} reviews)`);
          return {
            found: true,
            name: name.slice(0, 100),
            rating: place.rating,
            reviewCount: place.userRatingCount,
            address: (place.formattedAddress || '').slice(0, 150),
            categories: (place.types || []).slice(0, 3),
          };
        }
      }
    }

    // ── Fallback: DataForSEO Business Data ───────────────────────
    console.log(`[gbp] Google Places found nothing, trying DataForSEO...`);
    for (const term of searchTerms) {
      const dfs = await searchDFS(term);
      if (dfs) {
        return {
          found: true,
          name: dfs.title.slice(0, 100),
          rating: dfs.rating,
          reviewCount: dfs.reviews,
          address: dfs.address.slice(0, 150),
          categories: [dfs.category].filter(Boolean),
        };
      }
    }

    return { found: false };
  } catch (err: any) {
    return { found: false, error: err.message?.slice(0, 100) };
  }
}
