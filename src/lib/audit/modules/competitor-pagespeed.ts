import type { CompetitorPageSpeedResult } from '../types';
import { lookupGBP } from './gbp';

const API_KEY =
  (import.meta as any).env?.GOOGLE_PAGESPEED_API_KEY ||
  process.env.GOOGLE_PAGESPEED_API_KEY;

export async function runCompetitorPageSpeed(
  competitors: Array<{ name: string; url: string }>,
): Promise<CompetitorPageSpeedResult> {
  if (!API_KEY || competitors.length === 0) {
    return { skipped: true, reason: 'No API key or no competitors', items: [] };
  }

  const items = await Promise.all(
    competitors.slice(0, 2).map(async (comp) => {
      const targetUrl = comp.url.startsWith('http') ? comp.url : `https://${comp.url}`;
      const domain = (() => { try { return new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();

      // Fetch PageSpeed + GBP in parallel
      const [psResult, gbpResult] = await Promise.all([
        (async () => {
          try {
            const apiUrl =
              `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&key=${API_KEY}&category=performance&strategy=mobile`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 25000);
            const res = await fetch(apiUrl, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) return 0;
            const data = (await res.json()) as any;
            return Math.round(
              (data?.lighthouseResult?.categories?.performance?.score ?? 0) * 100,
            );
          } catch {
            return 0;
          }
        })(),
        lookupGBP(comp.name, domain),
      ]);

      return {
        name: comp.name,
        domain,
        mobileScore: psResult,
        ...(gbpResult && { gbpRating: gbpResult.rating, gbpReviews: gbpResult.reviewCount }),
      };
    }),
  );

  return { items: items.filter((i) => i.domain) };
}
