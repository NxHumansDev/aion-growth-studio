/**
 * Fetch Google Search Console data.
 * Requires a valid access token.
 */

export interface GSCReport {
  period: '7d' | '28d';
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  topQueries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  topPages: Array<{
    page: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  indexedPages?: number;
}

const GSC_API = 'https://www.googleapis.com/webmasters/v3';

async function searchAnalytics(
  siteUrl: string,
  accessToken: string,
  body: Record<string, any>,
): Promise<any> {
  // GSC expects encoded site URL
  const encoded = encodeURIComponent(siteUrl);
  const res = await fetch(`${GSC_API}/sites/${encoded}/searchAnalytics/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GSC API error ${res.status}: ${err}`);
  }
  return res.json();
}

function formatDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

export async function fetchGSCData(domain: string, accessToken: string): Promise<GSCReport> {
  // Try different site URL formats (GSC is picky about the exact format)
  const siteUrls = [
    `sc-domain:${domain}`,           // Domain property (preferred)
    `https://${domain}/`,             // URL prefix with trailing slash
    `https://www.${domain}/`,         // www variant
    `https://${domain}`,              // Without trailing slash
  ];

  let workingSiteUrl = '';
  let queryData: any = null;

  for (const siteUrl of siteUrls) {
    try {
      queryData = await searchAnalytics(siteUrl, accessToken, {
        startDate: formatDate(7),
        endDate: formatDate(1),
        dimensions: ['query'],
        rowLimit: 20,
      });
      workingSiteUrl = siteUrl;
      break;
    } catch {
      continue;
    }
  }

  if (!queryData) {
    console.warn(`[gsc] No Search Console data found for ${domain}`);
    return {
      period: '7d',
      totalClicks: 0, totalImpressions: 0, avgCtr: 0, avgPosition: 0,
      topQueries: [], topPages: [],
    };
  }

  // Top queries
  const topQueries = (queryData.rows || []).map((row: any) => ({
    query: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 10000) / 100,
    position: Math.round(row.position * 10) / 10,
  }));

  // Totals from query data
  const totalClicks = topQueries.reduce((s: number, q: any) => s + q.clicks, 0);
  const totalImpressions = topQueries.reduce((s: number, q: any) => s + q.impressions, 0);
  const avgCtr = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : 0;
  const avgPosition = topQueries.length > 0
    ? Math.round(topQueries.reduce((s: number, q: any) => s + q.position, 0) / topQueries.length * 10) / 10
    : 0;

  // Top pages (up to 100 for better indexed-pages proxy and richer table)
  let topPages: GSCReport['topPages'] = [];
  try {
    const pageData = await searchAnalytics(workingSiteUrl, accessToken, {
      startDate: formatDate(7),
      endDate: formatDate(1),
      dimensions: ['page'],
      rowLimit: 100,
    });
    topPages = (pageData.rows || []).map((row: any) => ({
      page: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: Math.round(row.ctr * 10000) / 100,
      position: Math.round(row.position * 10) / 10,
    }));
  } catch { /* Pages query might fail, that's ok */ }

  // Indexed pages count
  let indexedPages: number | undefined;
  try {
    const encoded = encodeURIComponent(workingSiteUrl);
    const indexRes = await fetch(`${GSC_API}/sites/${encoded}/sitemaps`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (indexRes.ok) {
      const indexData = await indexRes.json();
      indexedPages = (indexData.sitemap || []).reduce((s: number, sm: any) => s + (sm.contents?.[0]?.submitted || 0), 0);
    }
  } catch { /* Optional */ }

  return {
    period: '7d',
    totalClicks, totalImpressions, avgCtr, avgPosition,
    topQueries, topPages,
    ...(indexedPages !== undefined && { indexedPages }),
  };
}
