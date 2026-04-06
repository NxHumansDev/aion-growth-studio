import type { GBPResult, CrawlResult } from '../types';

const API_KEY = import.meta.env?.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

/**
 * Places API (New) — text search.
 * Returns all results so caller can pick the best match.
 */
async function searchPlaces(query: string): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY!,
        'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.formattedAddress,places.types,places.websiteUri',
      },
      body: JSON.stringify({ textQuery: query }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const errMsg = `${res.status}: ${body.slice(0, 200)}`;
      console.error(`[gbp] Places API error: ${errMsg}`);
      // Store last error for debug
      (searchPlaces as any)._lastErr = errMsg;
      return [];
    }

    const data = await res.json();
    return data.places || [];
  } catch (err) {
    clearTimeout(timer);
    const errMsg = (err as Error).message?.slice(0, 150) || 'unknown';
    console.error(`[gbp] searchPlaces exception: ${errMsg}`);
    (searchPlaces as any)._lastErr = errMsg;
    return [];
  }
}

/** Extract bare domain from a URL (e.g. "https://tienda.frutaseloy.com/foo" → "frutaseloy.com") */
function bareDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/^tienda\./, '');
  } catch {
    return '';
  }
}

/**
 * Pick the best GBP result: prefer the one whose website matches our audit domain,
 * then fall back to highest rating+reviews combo.
 */
function pickBest(places: any[], auditDomain: string): any | null {
  if (places.length === 0) return null;

  // First: exact domain match
  const domainMatch = places.find(p => {
    const web = bareDomain(p.websiteUri || '');
    return web && auditDomain.includes(web);
  });
  if (domainMatch) return domainMatch;

  // Fallback: best rating × reviews
  let best = places[0];
  for (const p of places.slice(1)) {
    const bestScore = (best.rating ?? 0) * 20 + Math.log10((best.userRatingCount ?? 0) + 1);
    const pScore = (p.rating ?? 0) * 20 + Math.log10((p.userRatingCount ?? 0) + 1);
    if (pScore > bestScore) best = p;
  }
  return best;
}

/**
 * Quick GBP lookup by company name + domain — used for competitor comparison.
 * Returns { rating, reviewCount } or null.
 */
export async function lookupGBP(companyName: string, domain: string): Promise<{ rating: number; reviewCount: number } | null> {
  if (!API_KEY) return null;
  try {
    const places = await searchPlaces(companyName);
    const place = pickBest(places, domain);
    if (!place?.rating) return null;
    return { rating: place.rating, reviewCount: place.userRatingCount ?? 0 };
  } catch {
    return null;
  }
}

export async function runGBP(url: string, crawl: CrawlResult): Promise<GBPResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'GOOGLE_PLACES_API_KEY not configured' };
  }

  const auditDomain = new URL(url).hostname.replace(/^www\./, '');
  const titleName = crawl.title?.split(/[-|–—·:]/)[0]?.trim() || '';
  const GENERIC = /^(home|inicio|welcome|bienvenid|index|main|page|untitled)$/i;

  try {
    console.log(`[gbp] API_KEY present: ${!!API_KEY} (len=${API_KEY?.length}), companyName: "${crawl.companyName}", title: "${titleName}", domain: "${auditDomain}"`);

    // Strategy 1: Use companyName from crawl (most reliable — extracted from schema/og)
    let places = crawl.companyName ? await searchPlaces(crawl.companyName) : [];
    console.log(`[gbp] Strategy 1 (companyName="${crawl.companyName}"): ${places.length} results`);

    // Strategy 2: Search by title name (if not generic like "Home")
    if (places.length === 0 && titleName && !GENERIC.test(titleName)) {
      places = await searchPlaces(titleName);
      console.log(`[gbp] Strategy 2 (title="${titleName}"): ${places.length} results`);
    }

    // Strategy 3: Search by domain name
    if (places.length === 0) {
      const domainName = auditDomain.split('.')[0].replace(/-/g, ' ');
      places = await searchPlaces(domainName);
      console.log(`[gbp] Strategy 3 (domain="${domainName}"): ${places.length} results`);
    }

    const place = pickBest(places, auditDomain);
    if (!place) {
      return { found: false, _debug: `key=${API_KEY?.length}ch, q="${crawl.companyName}", results=0, apiErr=${(searchPlaces as any)._lastErr || 'none'}` };
    }

    const name = place.displayName?.text || '';
    console.log(`[gbp] Found "${name}": ${place.rating}★ (${place.userRatingCount} reviews) — web: ${place.websiteUri || 'none'}`);

    return {
      found: true,
      name: name.slice(0, 100),
      rating: place.rating,
      reviewCount: place.userRatingCount,
      address: (place.formattedAddress || '').slice(0, 150),
      categories: (place.types || []).slice(0, 3),
    };
  } catch (err: any) {
    return { found: false, error: err.message?.slice(0, 100), _debug: `exception, key=${API_KEY?.length}ch` };
  }
}
