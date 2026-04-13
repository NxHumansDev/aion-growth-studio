import type { PageSpeedResult, PageSpeedScore } from '../types';

const API_KEY = import.meta.env?.GOOGLE_PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY;

export async function runPageSpeed(url: string): Promise<PageSpeedResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'GOOGLE_PAGESPEED_API_KEY not configured' };
  }

  const cats = 'category=performance&category=accessibility&category=best-practices&category=seo';
  const base = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${API_KEY}&${cats}`;

  const fetchWithTimeout = async (url: string, timeoutMs = 200_000) => {
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

  // Retry wrapper — Lighthouse sometimes fails intermittently for slow sites
  const fetchWithRetry = async (url: string) => {
    try {
      return await fetchWithTimeout(url, 40000);
    } catch (err: any) {
      // Retry once if it wasn't a timeout (intermittent Google API error)
      if (err.name !== 'AbortError') {
        console.log(`[pagespeed] Retrying after error: ${err.message?.slice(0, 60)}`);
        return await fetchWithTimeout(url, 40000);
      }
      throw err;
    }
  };

  try {
    let mobileData: any;
    let desktopData: any;

    try {
      [mobileData, desktopData] = await Promise.all([
        fetchWithRetry(`${base}&strategy=mobile`),
        fetchWithRetry(`${base}&strategy=desktop`),
      ]);
    } catch (firstErr: any) {
      // If Lighthouse failed to load the page (often SSL chain issues), retry with HTTP
      const isDocumentError = firstErr.message?.includes('FAILED_DOCUMENT_REQUEST')
        || firstErr.message?.includes('DNS_FAILURE')
        || firstErr.message?.includes('unable to reliably load');

      if (isDocumentError && url.startsWith('https://')) {
        const httpUrl = url.replace('https://', 'http://');
        const httpBase = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(httpUrl)}&key=${API_KEY}&${cats}`;
        console.log(`[pagespeed] HTTPS failed (${firstErr.message?.slice(0, 50)}). Retrying with HTTP...`);
        [mobileData, desktopData] = await Promise.all([
          fetchWithRetry(`${httpBase}&strategy=mobile`),
          fetchWithRetry(`${httpBase}&strategy=desktop`),
        ]);
        console.log(`[pagespeed] HTTP retry succeeded for ${httpUrl}`);
      } else {
        throw firstErr;
      }
    }

    return {
      mobile: parseScore(mobileData),
      desktop: parseScore(desktopData),
    };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'PageSpeed API timed out (45s)' : err.message?.slice(0, 100);
    return { skipped: true, reason: `Lighthouse: ${msg}` };
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
