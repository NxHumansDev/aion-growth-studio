import type { ReputationResult, NewsHeadline, CrawlResult } from '../types';

const PLACES_API_KEY =
  import.meta.env?.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const DFS_LOGIN =
  import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD =
  import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

// ── Google Places (new API v1) ────────────────────────────────────

async function fetchGBPReputation(
  companyName: string,
  domain: string,
  cityHint: string,
): Promise<{ rating: number | null; reviews: number | null; found: boolean }> {
  if (!PLACES_API_KEY) return { rating: null, reviews: null, found: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const query = cityHint
      ? `${companyName} ${cityHint}`
      : companyName;

    const searchRes = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': PLACES_API_KEY,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri',
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: 'es',
          maxResultCount: 3,
        }),
      },
    );

    if (!searchRes.ok) return { rating: null, reviews: null, found: false };
    const searchData = await searchRes.json();
    const places: any[] = searchData.places || [];
    if (!places.length) return { rating: null, reviews: null, found: false };

    // Prefer the place whose websiteUri contains the domain
    const bestPlace =
      places.find((p: any) =>
        (p.websiteUri || '').toLowerCase().includes(domain),
      ) || places[0];

    // If the text-search response already has rating, use it directly (saves one call)
    if (bestPlace.rating != null && bestPlace.userRatingCount != null) {
      return {
        rating: Math.round(bestPlace.rating * 10) / 10,
        reviews: bestPlace.userRatingCount,
        found: true,
      };
    }

    // Fallback: detail call to get rating
    if (!bestPlace.id) return { rating: null, reviews: null, found: false };

    const detailRes = await fetch(
      `https://places.googleapis.com/v1/places/${bestPlace.id}`,
      {
        signal: controller.signal,
        headers: {
          'X-Goog-Api-Key': PLACES_API_KEY,
          'X-Goog-FieldMask':
            'displayName,rating,userRatingCount,businessStatus,websiteUri,internationalPhoneNumber',
        },
      },
    );

    if (!detailRes.ok) return { rating: null, reviews: null, found: false };
    const detail = await detailRes.json();

    return {
      rating:
        detail.rating != null
          ? Math.round(detail.rating * 10) / 10
          : null,
      reviews: detail.userRatingCount ?? null,
      found: true,
    };
  } catch {
    return { rating: null, reviews: null, found: false };
  } finally {
    clearTimeout(timer);
  }
}

// ── DataForSEO — Trustpilot ───────────────────────────────────────

async function fetchTrustpilot(
  companyName: string,
): Promise<{ rating: number | null; reviews: number | null; found: boolean }> {
  if (!DFS_LOGIN || !DFS_PASSWORD)
    return { rating: null, reviews: null, found: false };

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(
      'https://api.dataforseo.com/v3/business_data/trustpilot/search/live',
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify([{ keyword: companyName, depth: 1 }]),
      },
    );

    if (!res.ok) return { rating: null, reviews: null, found: false };
    const data = await res.json();
    const item = data?.tasks?.[0]?.result?.[0]?.items?.[0];
    if (!item?.rating?.value) return { rating: null, reviews: null, found: false };

    return {
      rating: Math.round(item.rating.value * 10) / 10,
      reviews: item.rating.votes_count ?? null,
      found: true,
    };
  } catch {
    return { rating: null, reviews: null, found: false };
  } finally {
    clearTimeout(timer);
  }
}

// ── DataForSEO — Google News (brand mentions) ─────────────────────

async function fetchNewsPresence(
  brandName: string,
): Promise<{ newsCount: number; newsHeadlines: NewsHeadline[] }> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return { newsCount: 0, newsHeadlines: [] };

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(
      'https://api.dataforseo.com/v3/serp/google/news/live/advanced',
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify([{
          keyword: brandName,
          location_code: 2724,   // Spain
          language_code: 'es',
          depth: 10,
        }]),
      },
    );

    if (!res.ok) return { newsCount: 0, newsHeadlines: [] };
    const data = await res.json();

    const result = data?.tasks?.[0]?.result?.[0];
    const items: any[] = result?.items || [];

    // Keep items that look like actual news entries
    const newsItems = items.filter(
      (it: any) => it.title && (it.type === 'news_search' || it.source || it.domain),
    );

    // Filter out negative news about the company (closures, bankruptcy, lawsuits)
    const NEGATIVE_RE = /cierra|cerrar|quiebra|concurso de acreedores|liquidaci[oó]n|demanda contra|fraude|estafa|despidos masivos|ERE |ERTE |bancarrota|bankruptcy|closes|shutdown|fraud|scam|lawsuit/i;

    const headlines: NewsHeadline[] = newsItems
      .slice(0, 8)
      .map((it: any) => ({
        title: String(it.title || '').slice(0, 120),
        source: String(it.source || it.domain || ''),
        ...(it.date && { date: String(it.date).slice(0, 20) }),
        _negative: NEGATIVE_RE.test(String(it.title || '')),
      }))
      .filter((h) => !h._negative)
      .slice(0, 5)
      .map(({ _negative, ...rest }) => rest);

    return {
      newsCount: Math.max(result?.items_count ?? 0, newsItems.length),
      newsHeadlines: headlines,
    };
  } catch {
    return { newsCount: 0, newsHeadlines: [] };
  } finally {
    clearTimeout(timer);
  }
}

// ── Helper: try to extract a city from GBP address ───────────────

function extractCity(address: string | undefined): string {
  if (!address) return '';
  // Most address formats: "Street, City, Province, Country"
  const parts = address.split(',').map((p) => p.trim());
  // Take the second-to-last non-country part as the city (skip zip/country)
  const candidates = parts.filter(
    (p) =>
      p.length > 2 &&
      !/^\d/.test(p) &&        // skip zip codes
      !/españa|spain|france|portugal|uk|germany/i.test(p),
  );
  return candidates[candidates.length - 1] || '';
}

// ── Main export ──────────────────────────────────────────────────

export async function runReputation(
  url: string,
  crawl: CrawlResult,
  existingGbp?: any,
): Promise<ReputationResult> {
  const domain = new URL(
    url.startsWith('http') ? url : `https://${url}`,
  ).hostname.replace(/^www\./, '');

  // Prefer crawl.companyName (already cleaned by crawl module) over title splitting.
  // crawl.title splitting often produces long subtitles like "GROUP Andbank: Gestión de patrimonio..."
  // because the split regex /-|/ only catches hyphens and pipes, not colons.
  const rawName =
    crawl.companyName?.trim() ||
    crawl.title?.split(/[-–—|·:]/)[0]?.trim() ||
    domain;

  // Strip common legal entity prefixes (GROUP, GRUPO) and suffixes (S.A., S.L., etc.)
  // so Google News / GBP gets a clean brand name — e.g. "GROUP Andbank" → "Andbank"
  const companyName = rawName
    .replace(/^(grupo|group)\s+/gi, '')
    .replace(/[\s,]+(s\.?a\.?|s\.?l\.?|bv|gmbh|ltd|llc|inc|plc)$/gi, '')
    .trim() || rawName;

  const cityHint = extractCity(existingGbp?.address);

  // Run Places + Trustpilot + Google News in parallel
  const [gbp, tp, news] = await Promise.all([
    fetchGBPReputation(companyName, domain, cityHint),
    fetchTrustpilot(companyName),
    fetchNewsPresence(companyName),
  ]);

  const _log = `query="${companyName}" news:${news.newsCount} gbp:${gbp.found ? 'ok' : 'miss'} tp:${tp.found ? 'ok' : 'miss'}`;

  if (!gbp.found && !tp.found) {
    return {
      gbpFound: false,
      trustpilotFound: false,
      totalReviews: 0,
      reputationLevel: 'no_data',
      newsCount: news.newsCount,
      ...(news.newsHeadlines.length > 0 && { newsHeadlines: news.newsHeadlines }),
      _log,
    };
  }

  // Combined rating: weighted average (GBP 60%, Trustpilot 40%)
  let combinedRating: number | null = null;
  if (gbp.found && gbp.rating != null && tp.found && tp.rating != null) {
    combinedRating =
      Math.round((gbp.rating * 0.6 + tp.rating * 0.4) * 10) / 10;
  } else if (gbp.found && gbp.rating != null) {
    combinedRating = gbp.rating;
  } else if (tp.found && tp.rating != null) {
    combinedRating = tp.rating;
  }

  const totalReviews = (gbp.reviews ?? 0) + (tp.reviews ?? 0);

  let reputationLevel: 'strong' | 'moderate' | 'weak';
  if (combinedRating != null && combinedRating >= 4.2 && totalReviews >= 50) {
    reputationLevel = 'strong';
  } else if (
    (combinedRating != null && combinedRating >= 3.5) ||
    (totalReviews >= 10 && totalReviews <= 49)
  ) {
    reputationLevel = 'moderate';
  } else {
    reputationLevel = 'weak';
  }

  return {
    gbpRating: gbp.rating,
    gbpReviews: gbp.reviews,
    gbpFound: gbp.found,
    trustpilotRating: tp.rating,
    trustpilotReviews: tp.reviews,
    trustpilotFound: tp.found,
    combinedRating,
    totalReviews,
    reputationLevel,
    newsCount: news.newsCount,
    ...(news.newsHeadlines.length > 0 && { newsHeadlines: news.newsHeadlines }),
    _log,
  };
}
