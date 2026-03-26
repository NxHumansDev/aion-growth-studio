import type { KeywordGapResult, KeywordGapItem } from '../types';

const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

const BASE_URL = 'https://api.dataforseo.com/v3/dataforseo_labs/google/keywords_for_site/live';

async function fetchKeywords(
  domain: string,
  auth: string,
  limit: number,
  signal: AbortSignal,
): Promise<Array<{ keyword: string; position: number; searchVolume?: number }>> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify([
      {
        target: domain,
        location_code: 2724,
        language_code: 'es',
        limit,
        order_by: [{ field: 'keyword_data.keyword_info.search_volume', type: 'desc' }],
        filters: [['ranked_serp_element.serp_item.rank_group', '<=', 30]],
      },
    ]),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const items = data?.tasks?.[0]?.result?.[0]?.items;
  if (!items?.length) return [];

  return items.map((item: any) => ({
    keyword: item.keyword_data?.keyword || '',
    position: item.ranked_serp_element?.serp_item?.rank_group || 99,
    searchVolume: item.keyword_data?.keyword_info?.search_volume || 0,
  })).filter((k: any) => k.keyword);
}

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
    const [ownKws, compKws] = await Promise.all([
      fetchKeywords(ownDomain, auth, 50, controller.signal),
      fetchKeywords(compDomain, auth, 100, controller.signal),
    ]);

    // Build set of own keywords (normalize to lowercase)
    const ownSet = new Set(ownKws.map((k) => k.keyword.toLowerCase()));

    // Find competitor keywords NOT in own set, where competitor ranks in top 10
    const gapItems: KeywordGapItem[] = compKws
      .filter((k) => !ownSet.has(k.keyword.toLowerCase()) && k.position <= 10)
      .sort((a, b) => (b.searchVolume || 0) - (a.searchVolume || 0))
      .slice(0, 10)
      .map((k) => ({
        keyword: k.keyword,
        searchVolume: k.searchVolume || undefined,
        competitorPosition: k.position,
      }));

    if (gapItems.length === 0) {
      return { skipped: true, reason: 'No se encontraron keywords gap con los datos disponibles' };
    }

    return {
      competitor: compDomain,
      items: gapItems,
    };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'DataForSEO keyword gap timed out (30s)' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
