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
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    // ── Tier 1: Spain domain_analytics ───────────────────────────────
    const res = await fetch('https://api.dataforseo.com/v3/domain_analytics/overview/live', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{ target: domain, location_code: 2724, language_code: 'es' }]),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody as any)?.status_message || `HTTP ${res.status}`;
      return { skipped: true, reason: `DataForSEO: ${msg}`.slice(0, 120) };
    }

    const data = await res.json();
    const item = data?.tasks?.[0]?.result?.[0];

    if (item) {
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
    }

    // ── Tier 2: Backlinks summary fallback (better coverage for small sites) ──
    const blRes = await fetch('https://api.dataforseo.com/v3/backlinks/summary/live', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{ target: domain, include_subdomains: false }]),
    });

    if (blRes.ok) {
      const blData = await blRes.json();
      const blItem = blData?.tasks?.[0]?.result?.[0];
      if (blItem) {
        return {
          domainRank: blItem.rank ?? undefined,
          referringDomains: blItem.referring_domains ?? undefined,
          backlinksTotal: blItem.backlinks ?? undefined,
          // No organic traffic from backlinks endpoint — genuinely not available
        };
      }
    }

    return { skipped: true, reason: 'DataForSEO returned no data for this domain' };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'DataForSEO timed out (30s)' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
