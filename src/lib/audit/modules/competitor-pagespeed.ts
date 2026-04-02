import type { CompetitorPageSpeedResult } from '../types';

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
      try {
        const targetUrl = comp.url.startsWith('http') ? comp.url : `https://${comp.url}`;
        const apiUrl =
          `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&key=${API_KEY}&category=performance&strategy=mobile`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);
        const res = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) {
          return {
            name: comp.name,
            domain: new URL(targetUrl).hostname.replace(/^www\./, ''),
            mobileScore: 0,
          };
        }
        const data = (await res.json()) as any;
        const score = Math.round(
          (data?.lighthouseResult?.categories?.performance?.score ?? 0) * 100,
        );
        return {
          name: comp.name,
          domain: new URL(targetUrl).hostname.replace(/^www\./, ''),
          mobileScore: score,
        };
      } catch {
        return { name: comp.name, domain: '', mobileScore: 0 };
      }
    }),
  );

  return { items: items.filter((i) => i.domain) };
}
