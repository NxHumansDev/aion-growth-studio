import type { CompetitorTrafficResult } from '../types';

const DFS_LOGIN = import.meta.env.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

export async function runCompetitorTraffic(
  competitors: Array<{ name: string; url: string }>,
): Promise<CompetitorTrafficResult> {
  if (!DFS_LOGIN || !DFS_PASSWORD) {
    return { skipped: true, reason: 'DATAFORSEO credentials not configured' };
  }

  const filtered = competitors.slice(0, 5);
  if (!filtered.length) return { items: [] };

  const items = filtered.map((c) => {
    let domain = c.url;
    try {
      domain = new URL(c.url.startsWith('http') ? c.url : `https://${c.url}`)
        .hostname.replace(/^www\./, '');
    } catch {}
    return { name: c.name, url: c.url, domain };
  });

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
        body: JSON.stringify(
          items.map((item) => ({
            target: item.domain,
            // No location/language filter — global data has much better coverage for small sites
          })),
        ),
      },
    );

    if (!res.ok) {
      return { skipped: true, reason: `DataForSEO HTTP ${res.status}` };
    }

    const data = await res.json();
    const tasks: any[] = data?.tasks || [];

    const result = items.map((item, i) => {
      const taskResult = tasks[i]?.result?.[0];
      if (!taskResult) return { name: item.name, domain: item.domain, url: item.url };
      const m = taskResult.metrics?.organic;
      const keywordsTop10 = m
        ? (m.pos_1 ?? 0) + (m.pos_2_3 ?? 0) + (m.pos_4_10 ?? 0)
        : undefined;
      return {
        name: item.name,
        domain: item.domain,
        url: item.url,
        domainRank: taskResult.domain_rank ?? undefined,
        organicTrafficEstimate: m?.etv != null ? Math.round(m.etv) : undefined,
        keywordsTop10: keywordsTop10 || undefined,
      };
    });

    return { items: result };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'DataForSEO timed out' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
