import type { GBPResult, CrawlResult } from '../types';

const API_KEY = import.meta.env?.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

async function searchPlace(query: string): Promise<any | null> {
  const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
  const res = await fetch(searchUrl);
  const data = await res.json();
  return data.results?.[0] || null;
}

export async function runGBP(url: string, crawl: CrawlResult): Promise<GBPResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'GOOGLE_PLACES_API_KEY not configured' };
  }

  const domain = new URL(url).hostname.replace(/^www\./, '');
  const titleName = crawl.title?.split(/[-|–—·:]/)[0]?.trim() || '';

  try {
    // Strategy 1: Search by title name (most common)
    let place = titleName ? await searchPlace(titleName) : null;

    // Strategy 2: Search by domain name if title didn't work
    if (!place) {
      const domainName = domain.split('.')[0].replace(/-/g, ' ');
      place = await searchPlace(domainName);
    }

    // Strategy 3: Search with "empresa" + domain for better context
    if (!place && titleName) {
      place = await searchPlace(`${titleName} empresa`);
    }

    if (!place) {
      return { found: false };
    }

    return {
      found: true,
      name: place.name?.slice(0, 100),
      rating: place.rating,
      reviewCount: place.user_ratings_total,
      address: place.formatted_address?.slice(0, 150),
      categories: (place.types || []).slice(0, 3),
    };
  } catch (err: any) {
    return { found: false, error: err.message?.slice(0, 100) };
  }
}
