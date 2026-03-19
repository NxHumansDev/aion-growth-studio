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
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    // ── Tier 1: domain overview (traffic + keyword counts) ────────
    const res = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live', {
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
    const task = data?.tasks?.[0];

    if (!task || task.status_code !== 20000 || !task.result_count) {
      return { skipped: true, reason: 'DataForSEO returned no data for this domain' };
    }

    const item = task.result[0]?.items?.[0];
    if (!item) {
      return { skipped: true, reason: 'DataForSEO returned no data for this domain' };
    }

    const m = item.metrics?.organic;
    const keywordsTop3 = (m?.pos_1 ?? 0) + (m?.pos_2_3 ?? 0);
    const keywordsPos4to10 = m?.pos_4_10 ?? 0;
    const keywordsTop10 = keywordsTop3 + keywordsPos4to10;
    const keywordsTop30 = keywordsTop10 + (m?.pos_11_20 ?? 0) + (m?.pos_21_30 ?? 0);

    const baseResult: SEOResult = {
      organicTrafficEstimate: m?.etv != null ? Math.round(m.etv) : undefined,
      estimatedAdsCost: m?.estimated_paid_traffic_cost != null ? Math.round(m.estimated_paid_traffic_cost) : undefined,
      organicKeywordsTotal: m?.count,
      keywordsTop3: keywordsTop3 || undefined,
      keywordsPos4to10: keywordsPos4to10 || undefined,
      keywordsTop10: keywordsTop10 || undefined,
      keywordsTop30: keywordsTop30 || undefined,
      trendUp: m?.is_up ?? undefined,
      trendDown: m?.is_down ?? undefined,
      trendLost: m?.is_lost ?? undefined,
    };

    // ── Tier 2: top non-branded keywords (for GEO-SEO cross-analysis) ──
    // Non-fatal: if this call fails, we still return the base result
    try {
      const kwRes = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{
          target: domain,
          location_code: 2724,
          language_code: 'es',
          limit: 20,
          order_by: ['keyword_data.keyword_info.search_volume,desc'],
          filters: ['ranked_serp_element.serp_item.rank_absolute', '<=', 10],
        }]),
      });

      if (kwRes.ok) {
        const kwData = await kwRes.json();
        const kwTask = kwData?.tasks?.[0];
        if (kwTask?.status_code === 20000 && kwTask.result_count > 0) {
          const kwItems: any[] = kwTask.result[0]?.items || [];
          const domainBase = domain.replace(/\.[a-z]{2,6}$/i, '').toLowerCase();

          // Filter out branded keywords and keep top 6 by volume
          const topKeywords = kwItems
            .filter((it: any) => {
              const kw = (it.keyword_data?.keyword || '').toLowerCase();
              return !kw.includes(domainBase) && kw.length > 3;
            })
            .slice(0, 6)
            .map((it: any) => ({
              keyword: it.keyword_data?.keyword || '',
              position: it.ranked_serp_element?.serp_item?.rank_absolute ?? 0,
              volume: it.keyword_data?.keyword_info?.search_volume ?? 0,
            }))
            .filter((kw) => kw.keyword);

          if (topKeywords.length > 0) {
            baseResult.topKeywords = topKeywords;
          }
        }
      }
    } catch { /* non-fatal — topKeywords stays undefined */ }

    return baseResult;
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'DataForSEO timed out (45s)' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
