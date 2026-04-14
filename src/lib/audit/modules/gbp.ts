import type { GBPResult, CrawlResult } from '../types';

const API_KEY = import.meta.env?.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

// ── Google Places API (New) ─────────────────────────────────────

async function searchPlaces(query: string): Promise<any[]> {
  if (!API_KEY) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

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
      const timer = setTimeout(() => controller.abort(), 90_000);
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

/**
 * Normalize for case + accent insensitive matching.
 */
function normalize(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Does the place's display name look like it belongs to the query brand?
 *
 * The prior version picked the highest-rated place among ALL Google Places
 * matches — which produced false positives like "Kiko" (a random restaurant,
 * 3.7★ / 152 reviews) winning for the query "Kiko Gámez". This check rejects
 * that kind of noise.
 *
 * Rule: at least one DISTINCTIVE word from the brand (≥5 chars) must appear
 * as a whole word in the place name. Threshold 5 (not 4) because common
 * 4-letter names like "Kiko" also belong to other unrelated chains (KIKO
 * Milano) — we need the surname / longer word to match, not the first name.
 *
 * When the brand has no ≥5 char words (e.g. "Apple Inc"), fall back to
 * ≥3 chars to avoid rejecting everything. For concatenated single-word
 * brands (e.g. "kikogamez"), also try 2-way splits.
 */
export function nameLooksLikeBrand(placeName: string, queryName: string): boolean {
  if (!queryName) return true;
  const place = normalize(placeName);
  const query = normalize(queryName);
  if (!place) return false;

  // Full query as substring (strongest signal)
  if (place.includes(query)) return true;

  // Spacing-insensitive match: "Laeuropea" stored in DB vs "La Europea"
  // returned by Places, or vice versa. We require BOTH sides ≥5 chars (when
  // squashed) so that a 4-letter place name like "Kiko" doesn't match a
  // longer query like "Kikogamez" by being a substring of the squashed form.
  const querySquashed = query.replace(/\s+/g, '');
  const placeSquashed = place.replace(/\s+/g, '');
  const shorter = Math.min(querySquashed.length, placeSquashed.length);
  if (shorter >= 5 && (placeSquashed.includes(querySquashed) || querySquashed.includes(placeSquashed))) return true;

  const allWords = query.split(/[\s\-_.]+/).filter(w => w.length >= 3);
  if (allWords.length === 0) return false;

  // Prefer ≥5 char distinctive words ("gamez", "hercesa", "andbank").
  // Fall back to ≥3 only if nothing longer exists (e.g. "Apple Inc").
  const distinctive = allWords.filter(w => w.length >= 5);
  const candidateWords: string[] = distinctive.length > 0 ? distinctive : allWords;

  // For single-word concatenated brands (e.g. "kikogamez", "andbank"), try
  // 2-way splits of length ≥4 so "gamez" matches "Gámez Consulting" but
  // "kik" can't spuriously match a random KIK store.
  if (allWords.length === 1 && allWords[0].length >= 7) {
    const w = allWords[0];
    for (let i = 4; i <= w.length - 4; i++) {
      candidateWords.push(w.slice(0, i), w.slice(i));
    }
  }

  return candidateWords.some(w => new RegExp(`\\b${w}\\b`).test(place));
}

function pickBest(places: any[], auditDomain: string, queryName?: string): any | null {
  if (places.length === 0) return null;

  // Places that match the audit domain — prefer the ones WITH rating data.
  // Hercesa-style brands have multiple GBP listings (one per office); the
  // first matching entry may be a new office with 0 reviews while another
  // office has hundreds. Always pick the rated one.
  const domainMatches = places.filter(p => {
    const web = bareDomain(p.websiteUri || '');
    return web && auditDomain.includes(web);
  });
  if (domainMatches.length > 0) {
    const rated = domainMatches.filter(p => p.rating != null && (p.userRatingCount ?? 0) > 0);
    if (rated.length > 0) {
      return rated.reduce((best, p) =>
        (p.userRatingCount ?? 0) > (best.userRatingCount ?? 0) ? p : best,
      );
    }
    return domainMatches[0];
  }

  // No domain match — only consider places whose name looks like the brand.
  // Prevents "Kiko" (random restaurant, 3.7★) winning for query "Kiko Gámez".
  const nameFiltered = queryName
    ? places.filter(p => nameLooksLikeBrand(p.displayName?.text || '', queryName))
    : places;

  if (nameFiltered.length === 0) {
    console.log(`[gbp] All ${places.length} Places rejected (name mismatch with "${queryName}")`);
    return null;
  }

  // Score by rating × reviews among the name-filtered candidates.
  let best = nameFiltered[0];
  for (const p of nameFiltered.slice(1)) {
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
    const place = pickBest(places, domain, term);
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
    // Include sector-aware variants (e.g. "Hercesa promotora inmobiliaria")
    // to catch brands whose plain-name search returns multiple offices or
    // unrated listings as the first match.
    const sectorHint = (crawl as any).sectorHint || '';
    const searchTerms: string[] = [];
    if (companyName) searchTerms.push(companyName);
    if (companyName && sectorHint) searchTerms.push(`${companyName} ${sectorHint}`);
    if (domainName && domainName !== companyName?.toLowerCase()) searchTerms.push(domainName);
    if (companyName) searchTerms.push(`${companyName} España`);

    // First pass: only accept rated results. This prevents returning an
    // unrated office when another office for the same brand has reviews.
    for (const term of searchTerms) {
      const places = await searchPlaces(term);
      if (places.length > 0) {
        const place = pickBest(places, auditDomain, term);
        if (place && place.rating != null) {
          const name = place.displayName?.text || '';
          console.log(`[gbp] Google Places "${term}" → "${name}" ${place.rating}★ (${place.userRatingCount} reviews)`);
          return {
            found: true,
            name: name.slice(0, 100),
            rating: place.rating,
            reviewCount: place.userRatingCount,
            address: (place.formattedAddress || '').slice(0, 150),
            categories: (place.types || []).slice(0, 3),
          };
        } else if (place) {
          console.log(`[gbp] Google Places "${term}" → "${place.displayName?.text}" but no rating, trying next term`);
        }
      }
    }

    // ── Fallback: DataForSEO Business Data ───────────────────────
    console.log(`[gbp] Google Places found nothing rated, trying DataForSEO...`);
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

    // ── Last resort: accept an unrated Places match just so we know the
    // business exists on GBP even if we can't pull reviews.
    for (const term of searchTerms) {
      const places = await searchPlaces(term);
      const place = pickBest(places, auditDomain, term);
      if (place) {
        const name = place.displayName?.text || '';
        console.log(`[gbp] Accepting unrated match "${name}" for "${term}"`);
        return {
          found: true,
          name: name.slice(0, 100),
          rating: place.rating,
          reviewCount: place.userRatingCount ?? 0,
          address: (place.formattedAddress || '').slice(0, 150),
          categories: (place.types || []).slice(0, 3),
        };
      }
    }

    return { found: false };
  } catch (err: any) {
    return { found: false, error: err.message?.slice(0, 100) };
  }
}
