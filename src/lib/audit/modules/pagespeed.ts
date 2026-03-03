import type { PageSpeedResult, PageSpeedScore } from '../types';

const API_KEY = import.meta.env.GOOGLE_PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY;

export async function runPageSpeed(url: string): Promise<PageSpeedResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'GOOGLE_PAGESPEED_API_KEY not configured' };
  }

  const base = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${API_KEY}`;

  try {
    const [mobileRes, desktopRes] = await Promise.all([
      fetch(`${base}&strategy=mobile`),
      fetch(`${base}&strategy=desktop`),
    ]);

    const [mobileData, desktopData] = await Promise.all([
      mobileRes.json(),
      desktopRes.json(),
    ]);

    return {
      mobile: parseScore(mobileData),
      desktop: parseScore(desktopData),
    };
  } catch (err: any) {
    return { error: err.message?.slice(0, 100) };
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
