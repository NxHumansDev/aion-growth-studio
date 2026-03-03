import type { PageSpeedResult, PageSpeedScore } from '../types';

const API_KEY = import.meta.env.GOOGLE_PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY;

export async function runPageSpeed(url: string): Promise<PageSpeedResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'GOOGLE_PAGESPEED_API_KEY not configured' };
  }

  const base = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${API_KEY}`;

  const fetchWithTimeout = async (url: string, timeoutMs = 45000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const [mobileData, desktopData] = await Promise.all([
      fetchWithTimeout(`${base}&strategy=mobile`),
      fetchWithTimeout(`${base}&strategy=desktop`),
    ]);

    return {
      mobile: parseScore(mobileData),
      desktop: parseScore(desktopData),
    };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'PageSpeed API timed out (45s)' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  }
}

function parseScore(data: any): PageSpeedScore {
  const cats = data?.lighthouseResult?.categories;
  const audits = data?.lighthouseResult?.audits;

  return {
    performance: Math.round((cats?.performance?.score ?? 0) * 100),
    accessibility: Math.round((cats?.accessibility?.score ?? 0) * 100),
    seo: Math.round((cats?.seo?.score ?? 0) * 100),
    bestPractices: Math.round((cats?.['best-practices']?.score ?? 0) * 100),
    lcp: audits?.['largest-contentful-paint']?.numericValue
      ? Math.round(audits['largest-contentful-paint'].numericValue)
      : undefined,
    cls: audits?.['cumulative-layout-shift']?.numericValue,
    fcp: audits?.['first-contentful-paint']?.numericValue
      ? Math.round(audits['first-contentful-paint'].numericValue)
      : undefined,
    ttfb: audits?.['server-response-time']?.numericValue
      ? Math.round(audits['server-response-time'].numericValue)
      : undefined,
  };
}
