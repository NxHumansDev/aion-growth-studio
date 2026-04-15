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
  const timer = setTimeout(() => controller.abort(), 90_000);

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

// ── Trustpilot (DataForSEO + direct scrape fallback) ─────────────

async function fetchTrustpilotDFS(
  keyword: string,
): Promise<{ rating: number | null; reviews: number | null; found: boolean }> {
  if (!DFS_LOGIN || !DFS_PASSWORD)
    return { rating: null, reviews: null, found: false };

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(
      'https://api.dataforseo.com/v3/business_data/trustpilot/search/live',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{ keyword, depth: 1 }]),
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

/** Direct scrape of Trustpilot page — fallback when DataForSEO search fails */
async function fetchTrustpilotDirect(
  domain: string,
): Promise<{ rating: number | null; reviews: number | null; found: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`https://es.trustpilot.com/review/${domain}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) return { rating: null, reviews: null, found: false };
    const html = await res.text();

    // Extract rating from JSON-LD or meta tags
    const ratingMatch = html.match(/"ratingValue"\s*:\s*"?(\d[.,]\d)"?/) ||
                        html.match(/data-rating="(\d[.,]\d)"/) ||
                        html.match(/TrustScore\s*(\d[.,]\d)/);
    const reviewsMatch = html.match(/"reviewCount"\s*:\s*"?(\d+)"?/) ||
                         html.match(/(\d[\d,.]*)\s*(?:reviews|opiniones|reseñas)/i);

    if (!ratingMatch) return { rating: null, reviews: null, found: false };

    const rating = parseFloat(ratingMatch[1].replace(',', '.'));
    const reviews = reviewsMatch ? parseInt(reviewsMatch[1].replace(/[.,]/g, ''), 10) : null;

    console.log(`[reputation] Trustpilot direct scrape: ${domain} → ${rating}★ (${reviews} reviews)`);
    return { rating: Math.round(rating * 10) / 10, reviews, found: true };
  } catch {
    return { rating: null, reviews: null, found: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Try all Trustpilot methods: DFS by name → DFS by domain → direct scrape */
export async function fetchTrustpilot(
  companyName: string,
  domain: string,
): Promise<{ rating: number | null; reviews: number | null; found: boolean }> {
  // Try 1: DataForSEO by company name
  const byName = await fetchTrustpilotDFS(companyName);
  if (byName.found) return byName;

  // Try 2: DataForSEO by domain
  if (domain !== companyName.toLowerCase()) {
    const byDomain = await fetchTrustpilotDFS(domain);
    if (byDomain.found) {
      console.log(`[reputation] Trustpilot: found by domain "${domain}"`);
      return byDomain;
    }
  }

  // Try 3: Direct scrape of Trustpilot page
  const direct = await fetchTrustpilotDirect(domain);
  if (direct.found) return direct;

  return { rating: null, reviews: null, found: false };
}

// ── DataForSEO — Tripadvisor ──────────────────────────────────────

async function fetchTripadvisor(
  companyName: string,
): Promise<{ rating: number | null; reviews: number | null; found: boolean }> {
  if (!DFS_LOGIN || !DFS_PASSWORD)
    return { rating: null, reviews: null, found: false };

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(
      'https://api.dataforseo.com/v3/business_data/tripadvisor/search/live',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
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

// ── Google Reviews (via Google Places rating) — already in GBP ────
// GBP fetchGBPReputation already returns Google Reviews data.
// No separate function needed.

// ── Amazon Reviews (via Google search for "[brand] site:amazon") ──

async function fetchAmazonPresence(
  companyName: string,
  domain: string,
): Promise<{ rating: number | null; reviews: number | null; found: boolean; url?: string }> {
  if (!DFS_LOGIN || !DFS_PASSWORD)
    return { rating: null, reviews: null, found: false };

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    // Search Google for the brand on Amazon
    const res = await fetch(
      'https://api.dataforseo.com/v3/serp/google/organic/live/regular',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{
          keyword: `${companyName} site:amazon.es OR site:amazon.com`,
          location_code: 2724,
          language_code: 'es',
          depth: 3,
        }]),
      },
    );
    if (!res.ok) return { rating: null, reviews: null, found: false };
    const data = await res.json();
    const items: any[] = data?.tasks?.[0]?.result?.[0]?.items || [];
    const amazonItem = items.find((it: any) =>
      it.type === 'organic' && (it.url || '').includes('amazon')
    );
    if (!amazonItem) return { rating: null, reviews: null, found: false };

    // Extract rating from snippet if available
    const ratingMatch = (amazonItem.description || '').match(/(\d[.,]\d)\s*(?:de|out of|\/)\s*5/);
    const reviewMatch = (amazonItem.description || '').match(/(\d[\d.,]*)\s*(?:valoracion|opinion|review|calificacion)/i);

    return {
      rating: ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null,
      reviews: reviewMatch ? parseInt(reviewMatch[1].replace(/[.,]/g, ''), 10) : null,
      found: true,
      url: amazonItem.url,
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
  clientDomain?: string,
): Promise<{ newsCount: number; newsHeadlines: NewsHeadline[] }> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return { newsCount: 0, newsHeadlines: [] };

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

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
          depth: 30,
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

    // Filter out negative news (closures, bankruptcy, lawsuits)
    const NEGATIVE_RE = /cierra|cerrar|quiebra|concurso de acreedores|liquidaci[oó]n|demanda contra|fraude|estafa|despidos masivos|ERE |ERTE |bancarrota|bankruptcy|closes|shutdown|fraud|scam|lawsuit/i;

    // Accent-insensitive comparison — "Gámez" should match "Gamez" and vice versa
    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Build candidate brand-word sets. If the brand is a single concatenated word
    // (e.g. "Kikogamez" from a one-word company field) but press writes it split
    // ("Kiko Gámez"), we generate every 2-part split where each half is >= 3 chars
    // and try them too. Relevance = any split whose parts all appear as whole words.
    const brandNormalized = normalize(brandName);
    const baseWords = brandNormalized.split(/[\s\-_.]+/).filter(w => w.length >= 3);
    const wordSets: string[][] = [baseWords];
    if (baseWords.length === 1 && baseWords[0].length >= 6) {
      const w = baseWords[0];
      for (let i = 3; i <= w.length - 3; i++) {
        wordSets.push([w.slice(0, i), w.slice(i)]);
      }
    }
    const distinctiveWords = baseWords.filter(w => w.length >= 5);

    function containsWord(haystack: string, word: string): boolean {
      return new RegExp(`\\b${word}\\b`).test(haystack);
    }

    function isRelevant(title: string, snippet: string): boolean {
      if (baseWords.length === 0) return true;
      const haystack = normalize(`${title} ${snippet}`);
      if (haystack.includes(brandNormalized)) return true;
      if (distinctiveWords.some(w => containsWord(haystack, w))) return true;
      // Accept if any candidate word set has all its words present
      for (const set of wordSets) {
        if (set.length === 0) continue;
        const matchCount = set.filter(w => containsWord(haystack, w)).length;
        const required = set.length >= 2 ? 2 : 1;
        if (matchCount >= required) return true;
      }
      return false;
    }

    const headlines: NewsHeadline[] = newsItems
      .slice(0, 40) // more candidates to filter from
      .map((it: any) => ({
        title: String(it.title || '').slice(0, 120),
        source: String(it.source || it.domain || ''),
        ...(it.date && { date: String(it.date).slice(0, 20) }),
        ...(it.url && { url: String(it.url) }),
        ...(it.snippet && { snippet: String(it.snippet).slice(0, 200) }),
        _negative: NEGATIVE_RE.test(String(it.title || '')),
        _relevant: isRelevant(String(it.title || ''), String(it.snippet || '')),
      }))
      .filter((h) => !h._negative && h._relevant)
      .slice(0, 20)  // Keep up to 20 for media module (dashboard shows 10 + "ver más")
      .map(({ _negative, _relevant, ...rest }) => rest);

    // Detect backlinks: fetch each article with a URL and check if the HTML
    // contains a link to the client's domain. Parallel, 5s timeout each.
    // Headlines without backlinks are link-building opportunities — the
    // recommendations engine surfaces them as "mention sin enlace".
    if (clientDomain) {
      await enrichWithBacklinkCheck(headlines, clientDomain);
    }

    return {
      newsCount: headlines.length,
      newsHeadlines: headlines,
    };
  } catch {
    return { newsCount: 0, newsHeadlines: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * For each headline with a URL, fetch the article HTML and check whether it
 * contains a link to the client's domain. Results are written back on
 * headlines[i].linksBack (true|false) or headlines[i].linkCheckFailed=true.
 *
 * Parallel with 5s timeout each. Skips gracefully on any fetch failure —
 * unknown status is better than a wrong status (we'd rather not flag a
 * headline as "no backlink" when we couldn't verify).
 */
async function enrichWithBacklinkCheck(
  headlines: NewsHeadline[],
  clientDomain: string,
): Promise<void> {
  const normalizedDomain = clientDomain.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
  if (!normalizedDomain) return;

  // Regex to match href="...domain..." OR href='...domain...'
  const domainRegex = new RegExp(`href\\s*=\\s*["'][^"']*${normalizedDomain.replace(/\./g, '\\.')}[^"']*["']`, 'i');

  await Promise.all(headlines.map(async (h) => {
    if (!h.url) return;
    try {
      const res = await fetch(h.url, {
        signal: AbortSignal.timeout(5_000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AIONBacklinkBot/1.0)',
          'Accept': 'text/html',
        },
        redirect: 'follow',
      });
      if (!res.ok) {
        h.linkCheckFailed = true;
        return;
      }
      const html = await res.text();
      h.linksBack = domainRegex.test(html);
    } catch {
      h.linkCheckFailed = true;
    }
  }));
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
  sector?: string,
): Promise<ReputationResult> {
  const domain = new URL(
    url.startsWith('http') ? url : `https://${url}`,
  ).hostname.replace(/^www\./, '');

  // Prefer crawl.companyName (already cleaned by crawl module) over title splitting.
  // Still apply the separator split: crawl.companyName is sometimes the full page
  // title like "Kiko Gámez — Executive Director, Founder & AI Advisor" which
  // kills DFS news queries. Split on common separators and take the first chunk.
  const rawCandidate = crawl.companyName?.trim() || crawl.title?.trim() || domain;
  const rawName = rawCandidate.split(/[-–—|·:]/)[0]?.trim() || rawCandidate;

  // Strip common legal entity prefixes (GROUP, GRUPO) and suffixes (S.A., S.L., etc.)
  // so Google News / GBP gets a clean brand name — e.g. "GROUP Andbank" → "Andbank"
  const companyName = rawName
    .replace(/^(grupo|group)\s+/gi, '')
    .replace(/[\s,]+(s\.?a\.?|s\.?l\.?|bv|gmbh|ltd|llc|inc|plc)$/gi, '')
    .trim() || rawName;

  const cityHint = extractCity(existingGbp?.address);

  const businessType = crawl.businessType || 'unknown';
  // Detect from both sector (if available) AND crawl signals (always available)
  const crawlText = `${crawl.title || ''} ${crawl.description || ''} ${(crawl.h1s || []).join(' ')}`.toLowerCase();
  const isHospitality = /hotel|restaur|hostal|bar |café|cafetería|hostelería|turismo|alojamiento/i.test(sector || '') ||
    /hotel|restaurante|hostal|alojamiento|reserva/i.test(crawlText);
  const isEcommerce = businessType === 'ecommerce' ||
    /tienda|shop|store|ecommerce|venta online/i.test(sector || '') ||
    /comprar|añadir al carrito|add to cart|tienda|shop|cesta|checkout|envío gratis/i.test(crawlText);

  // Run all reputation sources in parallel
  const [gbp, tp, news, tripadvisor, amazon] = await Promise.all([
    fetchGBPReputation(companyName, domain, cityHint),
    fetchTrustpilot(companyName, domain),
    fetchNewsPresence(companyName, domain),
    isHospitality ? fetchTripadvisor(companyName) : Promise.resolve({ rating: null, reviews: null, found: false }),
    isEcommerce ? fetchAmazonPresence(companyName, domain) : Promise.resolve({ rating: null, reviews: null, found: false }),
  ]);

  const _log = `query="${companyName}" domain="${domain}" news:${news.newsCount} gbp:${gbp.found ? `ok(${gbp.rating})` : 'miss'} tp:${tp.found ? `ok(${tp.rating})` : 'miss'} ta:${tripadvisor.found ? `ok(${tripadvisor.rating})` : 'skip'} amz:${amazon.found ? 'found' : 'skip'}`;
  console.log(`[reputation] ${_log}`);

  // Collect all rating sources
  const sources: Array<{ name: string; rating: number; reviews: number; weight: number }> = [];
  if (gbp.found && gbp.rating != null) sources.push({ name: 'Google', rating: gbp.rating, reviews: gbp.reviews ?? 0, weight: 0.35 });
  if (tp.found && tp.rating != null) sources.push({ name: 'Trustpilot', rating: tp.rating, reviews: tp.reviews ?? 0, weight: 0.30 });
  if (tripadvisor.found && tripadvisor.rating != null) sources.push({ name: 'Tripadvisor', rating: tripadvisor.rating, reviews: tripadvisor.reviews ?? 0, weight: 0.25 });
  if (amazon.found && amazon.rating != null) sources.push({ name: 'Amazon', rating: amazon.rating, reviews: amazon.reviews ?? 0, weight: 0.20 });

  if (sources.length === 0) {
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

  // Weighted average rating (normalize weights to sum to 1)
  const totalWeight = sources.reduce((s, src) => s + src.weight, 0);
  const combinedRating = Math.round(
    sources.reduce((s, src) => s + src.rating * (src.weight / totalWeight), 0) * 10
  ) / 10;
  const totalReviews = sources.reduce((s, src) => s + src.reviews, 0);

  let reputationLevel: 'strong' | 'moderate' | 'weak';
  if (combinedRating >= 4.2 && totalReviews >= 50) {
    reputationLevel = 'strong';
  } else if (combinedRating >= 3.5 || totalReviews >= 10) {
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
    ...(tripadvisor.found && { tripadvisorRating: tripadvisor.rating, tripadvisorReviews: tripadvisor.reviews }),
    ...(amazon.found && { amazonFound: true, amazonUrl: (amazon as any).url }),
    combinedRating,
    totalReviews,
    reputationLevel,
    ratingSources: sources.map(s => ({ name: s.name, rating: s.rating, reviews: s.reviews })),
    newsCount: news.newsCount,
    ...(news.newsHeadlines.length > 0 && { newsHeadlines: news.newsHeadlines }),
    _log,
  };
}
