import type { GBPResult, CrawlResult } from '../types';

const API_KEY = import.meta.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

export async function runGBP(url: string, crawl: CrawlResult): Promise<GBPResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'GOOGLE_PLACES_API_KEY not configured' };
  }

  const domain = new URL(url).hostname.replace(/^www\./, '');
  const searchName = crawl.title?.split(/[-|]/)[0]?.trim() || domain;

  try {
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchName)}&key=${API_KEY}`;
    const res = await fetch(searchUrl);
    const data = await res.json();

    const place = data.results?.[0];
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
