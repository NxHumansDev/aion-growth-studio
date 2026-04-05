import type { KeywordGapResult, KeywordGapItem } from '../types';

const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

export async function runKeywordGap(
  url: string,
  competitorUrl: string,
): Promise<KeywordGapResult> {
  if (!DFS_LOGIN || !DFS_PASSWORD) {
    return { skipped: true, reason: 'DATAFORSEO_LOGIN/PASSWORD not configured' };
  }

  if (!competitorUrl) {
    return { skipped: true, reason: 'No competitor available for keyword gap analysis' };
  }

  const ownDomain = new URL(url.startsWith('http') ? url : `https://${url}`)
    .hostname.replace(/^www\./, '');
  const compDomain = new URL(competitorUrl.startsWith('http') ? competitorUrl : `https://${competitorUrl}`)
    .hostname.replace(/^www\./, '');

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    // Use domain_intersection: keywords competitor ranks for but we don't
    const res = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([
          {
            target1: compDomain,
            target2: ownDomain,
            intersection_mode: 'first_target_only',
            location_code: 2724,
            language_code: 'es',
            limit: 15,
            order_by: ['keyword_data.keyword_info.search_volume,desc'],
          },
        ]),
      },
    );

    if (!res.ok) {
      console.error(`[keyword-gap] API HTTP ${res.status}`);
      // Fallback: try without location filter (global)
      const resFallback = await fetch(
        'https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live',
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
          body: JSON.stringify([
            {
              target1: compDomain,
              target2: ownDomain,
              intersection_mode: 'first_target_only',
              limit: 15,
              order_by: ['keyword_data.keyword_info.search_volume,desc'],
            },
          ]),
        },
      );
      if (!resFallback.ok) {
        return { skipped: true, reason: `DataForSEO keyword gap API error: ${resFallback.status}` };
      }
      return processResponse(await resFallback.json(), compDomain);
    }

    return processResponse(await res.json(), compDomain);
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'DataForSEO keyword gap timed out (30s)' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}

function processResponse(data: any, compDomain: string): KeywordGapResult {
  const task = data?.tasks?.[0];

  if (task?.status_code !== 20000) {
    const msg = task?.status_message || 'Unknown error';
    console.error(`[keyword-gap] DFS error: ${msg}`);
    return { skipped: true, reason: `DataForSEO: ${msg.slice(0, 100)}` };
  }

  const items = task?.result?.[0]?.items;
  if (!items?.length) {
    return { skipped: true, reason: 'No keyword gap opportunities found for this competitor pair' };
  }

  // Filter: minimum 2 words (single words are usually generic/noise),
  // must have search volume, competitor position ≤ 20
  const gapItems: KeywordGapItem[] = items
    .map((item: any) => ({
      keyword: item.keyword_data?.keyword || '',
      searchVolume: item.keyword_data?.keyword_info?.search_volume || undefined,
      competitorPosition: item.first_target_serp_element?.serp_item?.rank_group || undefined,
    }))
    .filter((k: KeywordGapItem) => {
      if (!k.keyword) return false;
      if (k.competitorPosition != null && k.competitorPosition > 20) return false;
      // Filter single-word generic keywords (too broad, usually noise)
      const words = k.keyword.trim().split(/\s+/);
      if (words.length < 2) return false;
      return true;
    })
    .slice(0, 10);

  if (gapItems.length === 0) {
    return { skipped: true, reason: 'No keyword gap opportunities after filtering' };
  }

  console.log(`[keyword-gap] Found ${gapItems.length} gap keywords vs ${compDomain}`);

  return {
    competitor: compDomain,
    items: gapItems,
  };
}
