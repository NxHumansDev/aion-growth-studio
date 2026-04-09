/**
 * Fetch GA4 data using the Google Analytics Data API v1beta.
 * Requires a valid access token and property ID.
 */

export interface GA4Report {
  period: '7d' | '30d' | '90d';
  sessions: number;
  users: number;
  newUsers: number;
  bounceRate: number;
  avgSessionDuration: number;
  pageviews: number;
  conversions: number;
  topPages: Array<{ path: string; pageviews: number; avgTime: number }>;
  trafficSources: Array<{ source: string; medium: string; sessions: number; pct: number }>;
  deviceBreakdown: { desktop: number; mobile: number; tablet: number };
}

const GA4_API = 'https://analyticsdata.googleapis.com/v1beta';

async function runReport(propertyId: string, accessToken: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${GA4_API}/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 API error ${res.status}: ${err}`);
  }
  return res.json();
}

function getVal(row: any, metricIdx: number): number {
  return parseFloat(row?.metricValues?.[metricIdx]?.value || '0');
}

function getDim(row: any, dimIdx: number): string {
  return row?.dimensionValues?.[dimIdx]?.value || '';
}

export async function fetchGA4Data(propertyId: string, accessToken: string): Promise<GA4Report> {
  // Main metrics — last 7 days
  const mainReport = await runReport(propertyId, accessToken, {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
      { name: 'screenPageViews' },
      { name: 'conversions' },
    ],
  });

  const mainRow = mainReport.rows?.[0];
  const sessions = getVal(mainRow, 0);
  const users = getVal(mainRow, 1);
  const newUsers = getVal(mainRow, 2);
  const bounceRate = Math.round(getVal(mainRow, 3) * 100) / 100;
  const avgSessionDuration = Math.round(getVal(mainRow, 4));
  const pageviews = getVal(mainRow, 5);
  const conversions = getVal(mainRow, 6);

  // Top pages
  const pagesReport = await runReport(propertyId, accessToken, {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
    ],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 10,
  });

  const topPages = (pagesReport.rows || []).map((row: any) => ({
    path: getDim(row, 0),
    pageviews: getVal(row, 0),
    avgTime: Math.round(getVal(row, 1)),
  }));

  // Traffic sources
  const sourcesReport = await runReport(propertyId, accessToken, {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 10,
  });

  const totalSessions = sessions || 1;
  const trafficSources = (sourcesReport.rows || []).map((row: any) => ({
    source: getDim(row, 0),
    medium: getDim(row, 1),
    sessions: getVal(row, 0),
    pct: Math.round((getVal(row, 0) / totalSessions) * 100),
  }));

  // Device breakdown
  const deviceReport = await runReport(propertyId, accessToken, {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'sessions' }],
  });

  const deviceBreakdown = { desktop: 0, mobile: 0, tablet: 0 };
  for (const row of deviceReport.rows || []) {
    const cat = getDim(row, 0).toLowerCase();
    const val = Math.round((getVal(row, 0) / totalSessions) * 100);
    if (cat === 'desktop') deviceBreakdown.desktop = val;
    else if (cat === 'mobile') deviceBreakdown.mobile = val;
    else if (cat === 'tablet') deviceBreakdown.tablet = val;
  }

  return {
    period: '7d',
    sessions, users, newUsers, bounceRate, avgSessionDuration,
    pageviews, conversions, topPages, trafficSources, deviceBreakdown,
  };
}
