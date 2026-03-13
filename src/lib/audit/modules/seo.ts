import type { SEOResult } from '../types';

const DFS_LOGIN = import.meta.env.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

export async function runSEO(url: string): Promise<SEOResult> {
  if (!DFS_LOGIN || !DFS_PASSWORD) {
    return { skipped: true, reason: 'DATAFORSEO_LOGIN/PASSWORD not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`)
    .hostname.replace(/^www\./, '');

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(
      'https://api.dataforseo.com/v3/domain_analytics/overview/live',
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify([
          {
            target: domain,
            // No location/language filter — global data has much better coverage for small sites
          },
        ]),
      },
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody as any)?.status_message || `HTTP ${res.status}`;
      return { skipped: true, reason: `DataForSEO: ${msg}`.slice(0, 120) };
    }

    const data = await res.json();
    const item = data?.tasks?.[0]?.result?.[0];

    if (!item) {
      return { skipped: true, reason: 'DataForSEO returned no data for this domain' };
    }

    const m = item.metrics?.organic;
    const bl = item.backlinks_info;

    const keywordsTop3 = (m?.pos_1 ?? 0) + (m?.pos_2_3 ?? 0);
    const keywordsTop10 = keywordsTop3 + (m?.pos_4_10 ?? 0);
    const keywordsTop30 = keywordsTop10 + (m?.pos_11_20 ?? 0) + (m?.pos_21_30 ?? 0);

    return {
      domainRank: item.domain_rank,
      organicTrafficEstimate: m?.etv != null ? Math.round(m.etv) : undefined,
      organicKeywordsTotal: m?.count,
      keywordsTop3: keywordsTop3 || undefined,
      keywordsTop10: keywordsTop10 || undefined,
      keywordsTop30: keywordsTop30 || undefined,
      referringDomains: bl?.referring_domains,
      backlinksTotal: bl?.backlinks,
    };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'DataForSEO timed out (25s)' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
