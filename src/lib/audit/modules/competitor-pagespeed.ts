import type { CompetitorPageSpeedResult } from '../types';
import { lookupGBP } from './gbp';
import { fetchTrustpilot } from './reputation';

const API_KEY =
  (import.meta as any).env?.GOOGLE_PAGESPEED_API_KEY ||
  process.env.GOOGLE_PAGESPEED_API_KEY;

/** Derive a human-readable company name from domain for GBP lookup */
function domainToName(domain: string): string {
  // "frutashervas.es" → "frutas hervas", "frutasmontosa.com" → "frutas montosa"
  const base = domain.split('.')[0].replace(/-/g, ' ');
  // Try to split compound words: "frutashervas" → "frutas hervas"
  const spaced = base.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(frutas?|grupo|comercial)([\w])/gi, '$1 $2');
  return spaced;
}

export async function runCompetitorPageSpeed(
  competitors: Array<{ name: string; url: string }>,
): Promise<CompetitorPageSpeedResult> {
  if (competitors.length === 0) {
    return { skipped: true, reason: 'No competitors', items: [] };
  }

  // Process ALL competitors (up to 4), each gets PageSpeed + GBP in parallel
  const items = await Promise.all(
    competitors.slice(0, 4).map(async (comp) => {
      const targetUrl = comp.url.startsWith('http') ? comp.url : `https://${comp.url}`;
      const domain = (() => { try { return new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();

      // Use proper company name for GBP (not just domain)
      const gbpName = (comp.name && comp.name !== domain && !comp.name.includes('.'))
        ? comp.name
        : domainToName(domain);

      // Fetch PageSpeed + GBP + Trustpilot in parallel per competitor
      const [psResult, gbpResult, tpResult] = await Promise.all([
        (async () => {
          if (!API_KEY) return 0;
          try {
            const apiUrl =
              `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&key=${API_KEY}&category=performance&strategy=mobile`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
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
        lookupGBP(gbpName, domain).catch(() => null),
        fetchTrustpilot(gbpName, domain).catch(() => ({ rating: null, reviews: null, found: false as const })),
      ]);

      console.log(`[comp-ps] ${domain}: PS=${psResult}, GBP=${gbpResult?.rating ?? 'none'}, TP=${tpResult?.rating ?? 'none'} (query="${gbpName}")`);

      return {
        name: comp.name,
        domain,
        mobileScore: psResult,
        ...(gbpResult && { gbpRating: gbpResult.rating, gbpReviews: gbpResult.reviewCount }),
        ...(tpResult?.found && { trustpilotRating: tpResult.rating, trustpilotReviews: tpResult.reviews }),
      };
    }),
  );

  return { items: items.filter((i) => i.domain) };
}
