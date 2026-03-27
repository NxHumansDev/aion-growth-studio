import type { SEOResult } from '../types';

const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

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
    // ── Tier 1 + Tier 2 + Backlinks + Organic Competitors + History in parallel ──
    const [overviewRes, kwRes, blRes, compRes, histRes] = await Promise.all([
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{ target: domain, location_code: 2724, language_code: 'es' }]),
      }),
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{
          target: domain,
          location_code: 2724,
          language_code: 'es',
          limit: 20,
          // Sort by ETV (Estimated Traffic Value) = volume × CTR by position.
          // This surfaces keywords that actually drive the most traffic,
          // not just those with the highest raw search volume.
          order_by: ['ranked_serp_element.serp_item.etv,desc'],
          filters: ['ranked_serp_element.serp_item.rank_absolute', '<=', 10],
        }]),
      }),
      fetch('https://api.dataforseo.com/v3/backlinks/summary/live', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{ target: domain, include_subdomains: true }]),
      }),
      // Organic competitors — domains competing for the same keywords in Spain.
      // These are guaranteed to have DataForSEO data (unlike LLM-guessed URLs).
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{
          target: domain,
          location_code: 2724,
          language_code: 'es',
          limit: 6,
          order_by: ['intersections,desc'],
        }]),
      }),
      // Historical rank overview — 12 months of organic ETV + keywords
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/historical_rank_overview/live', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{ target: domain, location_code: 2724, language_code: 'es' }]),
      }),
    ]);

    if (!overviewRes.ok) {
      const errBody = await overviewRes.json().catch(() => ({}));
      const msg = (errBody as any)?.status_message || `HTTP ${overviewRes.status}`;
      return { skipped: true, reason: `DataForSEO: ${msg}`.slice(0, 120) };
    }

    const [data, kwData, blData, compData, histData] = await Promise.all([
      overviewRes.json(),
      kwRes.ok ? kwRes.json() : Promise.resolve(null),
      blRes.ok ? blRes.json() : Promise.resolve(null),
      compRes.ok ? compRes.json() : Promise.resolve(null),
      histRes.ok ? histRes.json() : Promise.resolve(null),
    ]);

    const task = data?.tasks?.[0];

    if (!task || task.status_code !== 20000 || !task.result_count) {
      return { skipped: true, reason: 'DataForSEO returned no data for this domain' };
    }

    const item = task.result[0]?.items?.[0];
    if (!item) {
      return { skipped: true, reason: 'DataForSEO returned no data for this domain' };
    }

    // ── Organic metrics ─────────────────────────────────────────
    const m = item.metrics?.organic;
    const keywordsTop3 = (m?.pos_1 ?? 0) + (m?.pos_2_3 ?? 0);
    const keywordsPos4to10 = m?.pos_4_10 ?? 0;
    const keywordsTop10 = keywordsTop3 + keywordsPos4to10;
    const keywordsTop30 = keywordsTop10 + (m?.pos_11_20 ?? 0) + (m?.pos_21_30 ?? 0);

    // ── Paid metrics (Google Ads) ────────────────────────────────
    const mp = item.metrics?.paid;
    const paidKeywordsTotal = mp?.count ?? 0;
    const paidTop3Keywords = (mp?.pos_1 ?? 0) + (mp?.pos_2_3 ?? 0);

    const baseResult: SEOResult = {
      // Organic
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
      // Paid
      paidKeywordsTotal: paidKeywordsTotal || undefined,
      paidTrafficEstimate: mp?.etv != null ? Math.round(mp.etv) : undefined,
      paidTrafficValue: mp?.estimated_paid_traffic_cost != null ? Math.round(mp.estimated_paid_traffic_cost) : undefined,
      paidTop3Keywords: paidTop3Keywords || undefined,
      isInvestingPaid: paidKeywordsTotal > 0 || undefined,
    };

    // ── Backlinks / Domain Authority (Tier 1 — already fetched above) ──
    const _logParts: string[] = [`kw:${keywordsTop10} etv:${m?.etv != null ? Math.round(m.etv) : 0}`];
    try {
      const blTask = blData?.tasks?.[0];
      if (!blRes.ok) {
        _logParts.push(`bl:http${blRes.status}`);
      } else if (!blTask || blTask.status_code !== 20000) {
        _logParts.push(`bl:err${blTask?.status_code ?? '?'}`);
      } else if (!blTask.result_count) {
        _logParts.push('bl:empty');
      } else {
        const blItem = blTask.result?.[0];
        if (blItem) {
          if (blItem.referring_domains != null) baseResult.referringDomains = blItem.referring_domains;
          if (blItem.backlinks != null) baseResult.backlinksTotal = blItem.backlinks;
          if (blItem.rank != null) baseResult.domainRank = blItem.rank;
          if (blItem.spam_score != null) baseResult.spamScore = blItem.spam_score;
          _logParts.push(`bl:ok dr=${blItem.rank ?? 0} rd=${blItem.referring_domains ?? 0}`);
        } else {
          _logParts.push('bl:no-item');
        }
      }
    } catch { _logParts.push('bl:except'); }

    // ── Organic competitors from DataForSEO ───────────────────────────
    // Blocklist: generic/media domains that share informational keywords but aren't real competitors
    const GENERIC_DOMAINS = new Set([
      'youtube.com', 'wikipedia.org', 'facebook.com', 'instagram.com', 'twitter.com',
      'x.com', 'linkedin.com', 'tiktok.com', 'pinterest.com', 'reddit.com', 'quora.com',
      'amazon.com', 'amazon.es', 'google.com', 'bing.com',
      'elpais.com', 'elmundo.es', 'abc.es', 'lavanguardia.com', 'expansion.com',
      'eleconomista.es', 'cincodias.elpais.com', 'elconfidencial.com', 'eldiario.es',
      'trustpilot.com', 'tripadvisor.com', 'glassdoor.com', 'yelp.com',
      'gov.es', 'boe.es', 'aeat.es', 'administracion.gob.es',
    ]);

    try {
      const compTask = compData?.tasks?.[0];
      if (compTask?.status_code === 20000 && compTask.result_count > 0) {
        const compItems: any[] = compTask.result[0]?.items || [];
        const organicCompetitors = compItems
          .filter((it: any) => it.domain && it.domain !== domain && !GENERIC_DOMAINS.has(it.domain))
          .slice(0, 5)
          .map((it: any) => ({
            domain: it.domain as string,
            intersections: (it.intersections ?? 0) as number,
          }));
        if (organicCompetitors.length > 0) {
          (baseResult as any).organicCompetitors = organicCompetitors;
          _logParts.push(`comps:${organicCompetitors.length}(${organicCompetitors.map((c) => c.domain).join(',')})`);
        } else {
          _logParts.push('comps:0');
        }
      } else {
        _logParts.push(`comps:skip(${compTask?.status_code ?? 'no-task'})`);
      }
    } catch { _logParts.push('comps:except'); }

    // ── Tier 2 result (already fetched in parallel above) ────────
    try {
      const kwTask = kwData?.tasks?.[0];
      if (kwTask?.status_code === 20000 && kwTask.result_count > 0) {
        const kwItems: any[] = kwTask.result[0]?.items || [];
        const domainBase = domain.replace(/\.[a-z]{2,6}$/i, '').toLowerCase();

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
            etv: Math.round(it.ranked_serp_element?.serp_item?.etv ?? 0),
          }))
          .filter((kw) => kw.keyword);

        if (topKeywords.length > 0) baseResult.topKeywords = topKeywords;
      }
    } catch { /* non-fatal */ }

    // ── Tier 3: top paid keywords (only when domain invests in ads) ──
    if (paidKeywordsTotal > 0) {
      try {
        const pkRes = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
          body: JSON.stringify([{
            target: domain,
            location_code: 2724,
            language_code: 'es',
            filters: ['paid_etv', '>', 0],
            order_by: ['paid_etv,desc'],
            limit: 6,
          }]),
        });

        if (pkRes.ok) {
          const pkData = await pkRes.json();
          const pkTask = pkData?.tasks?.[0];
          if (pkTask?.status_code === 20000 && pkTask.result_count > 0) {
            const pkItems: any[] = pkTask.result[0]?.items || [];
            const topPaidKeywords = pkItems
              .map((it: any) => ({
                keyword: it.keyword_data?.keyword || '',
                position: it.ranked_serp_element?.serp_item?.rank_absolute ?? 0,
                volume: it.keyword_data?.keyword_info?.search_volume ?? 0,
              }))
              .filter((kw) => kw.keyword);

            if (topPaidKeywords.length > 0) baseResult.paidTopKeywords = topPaidKeywords;
          }
        }
      } catch { /* non-fatal */ }
    }

    // ── Historical organic trend (12 months) ────────────────────────
    try {
      const histTask = histData?.tasks?.[0];
      if (histTask?.status_code === 20000 && histTask.result_count > 0) {
        const histItems: any[] = histTask.result[0]?.items || [];
        // Each item has .year, .month, .metrics.organic {etv, count, pos_1, pos_2_3, pos_4_10, ...}
        const organicHistory = histItems
          .filter((it: any) => it.metrics?.organic)
          .map((it: any) => {
            const mo = it.metrics.organic;
            const kwTop10 = (mo.pos_1 ?? 0) + (mo.pos_2_3 ?? 0) + (mo.pos_4_10 ?? 0);
            return {
              month: `${it.year}-${String(it.month).padStart(2, '0')}`,
              etv: Math.round(mo.etv ?? 0),
              keywords: kwTop10,
            };
          })
          .sort((a: any, b: any) => a.month.localeCompare(b.month))
          .slice(-12); // last 12 months

        if (organicHistory.length >= 3) {
          baseResult.organicHistory = organicHistory;

          // Calculate trend: compare average of last 3 months vs first 3 months
          const recent3 = organicHistory.slice(-3);
          const older3 = organicHistory.slice(0, 3);
          const avgRecent = recent3.reduce((s, p) => s + p.etv, 0) / recent3.length;
          const avgOlder = older3.reduce((s, p) => s + p.etv, 0) / older3.length;

          if (avgOlder > 0) {
            const changePct = Math.round(((avgRecent - avgOlder) / avgOlder) * 100);
            baseResult.organicTrendPct = changePct;
            baseResult.organicTrend = changePct > 10 ? 'up' : changePct < -10 ? 'down' : 'stable';
          } else if (avgRecent > 0) {
            baseResult.organicTrend = 'up';
            baseResult.organicTrendPct = 100;
          } else {
            baseResult.organicTrend = 'stable';
            baseResult.organicTrendPct = 0;
          }

          _logParts.push(`hist:${organicHistory.length}m trend:${baseResult.organicTrend}(${baseResult.organicTrendPct}%)`);
        } else {
          _logParts.push(`hist:${organicHistory.length}m(insufficient)`);
        }
      } else {
        _logParts.push('hist:no-data');
      }
    } catch { _logParts.push('hist:except'); }

    baseResult._log = _logParts.join(' ');

    return baseResult;
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'DataForSEO timed out (45s)' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
