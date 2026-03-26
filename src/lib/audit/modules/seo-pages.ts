import type { SeoPagesResult } from '../types';

const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

export async function runSeoPages(url: string): Promise<SeoPagesResult> {
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
      'https://api.dataforseo.com/v3/dataforseo_labs/google/pages_for_site/live',
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
            location_code: 2724,
            language_code: 'es',
            limit: 5,
            order_by: [{ field: 'metrics.organic.etv', type: 'desc' }],
          },
        ]),
      },
    );

    if (!res.ok) {
      return { skipped: true, reason: `DataForSEO pages API error: ${res.status}` };
    }

    const data = await res.json();
    const task = data?.tasks?.[0];

    if (task?.status_code !== 20000) {
      const msg = task?.status_message || 'Unknown error';
      if (msg.includes('not found') || msg.includes('No data')) {
        return { skipped: true, reason: 'Sin datos de páginas para este dominio' };
      }
      return { skipped: true, reason: msg.slice(0, 120) };
    }

    const items = task?.result?.[0]?.items;
    if (!items?.length) {
      return { skipped: true, reason: 'Sin páginas con tráfico orgánico detectado' };
    }

    const pages = items.map((item: any) => {
      const organic = item.metrics?.organic || {};
      const topPos = [
        organic.pos_1 > 0 ? 1 : null,
        organic.pos_2_3 > 0 ? 2 : null,
        organic.pos_4_10 > 0 ? 5 : null,
        organic.pos_11_20 > 0 ? 15 : null,
      ].find((p) => p !== null);

      return {
        pageAddress: item.page_address || '',
        trafficEstimate: organic.etv != null ? Math.round(organic.etv) : undefined,
        keywords: organic.count || undefined,
        topPosition: topPos || undefined,
      };
    }).filter((p: any) => p.pageAddress);

    return { pages };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'DataForSEO pages timed out (25s)' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
