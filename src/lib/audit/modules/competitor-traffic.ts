import type { CompetitorTrafficResult } from '../types';

const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

function parseDFSItem(name: string, domain: string, url: string, task: any) {
  if (!task) {
    console.error(`[competitor-traffic] ${domain}: no task returned`);
    return { name, domain, url, apiError: 'no_task' };
  }
  if (task.status_code !== 20000) {
    console.error(`[competitor-traffic] ${domain}: status ${task.status_code} — ${task.status_message}`);
    return { name, domain, url, apiError: `${task.status_code}: ${task.status_message}` };
  }
  if (!task.result_count) {
    console.error(`[competitor-traffic] ${domain}: result_count=0`);
    return { name, domain, url, apiError: 'no_data' };
  }
  const labsItem = task.result[0]?.items?.[0];
  if (!labsItem) {
    console.error(`[competitor-traffic] ${domain}: items empty`);
    return { name, domain, url, apiError: 'empty_items' };
  }
  const m = labsItem.metrics?.organic;
  const mp = labsItem.metrics?.paid;
  const kw10 = m ? (m.pos_1 ?? 0) + (m.pos_2_3 ?? 0) + (m.pos_4_10 ?? 0) : undefined;
  console.log(`[competitor-traffic] ${domain}: etv=${m?.etv ?? 'n/a'} kw10=${kw10 ?? 'n/a'}`);
  return {
    name, domain, url,
    organicTrafficEstimate: m?.etv != null ? Math.round(m.etv) : undefined,
    estimatedAdsCost: m?.estimated_paid_traffic_cost != null ? Math.round(m.estimated_paid_traffic_cost) : undefined,
    keywordsTop10: kw10 || undefined,
    paidKeywordsTotal: (mp?.count ?? 0) || undefined,
    paidTrafficEstimate: mp?.etv != null ? Math.round(mp.etv) : undefined,
    paidTrafficValue: mp?.estimated_paid_traffic_cost != null ? Math.round(mp.estimated_paid_traffic_cost) : undefined,
  };
}

/**
 * Fetch a single domain — always sends exactly one task per HTTP request.
 * DataForSEO /live endpoints reject batches of >1 task with error 40000.
 */
async function fetchSingle(
  auth: string,
  item: { name: string; domain: string; url: string },
  locationCode?: number,
): Promise<ReturnType<typeof parseDFSItem>> {
  const body: any = { target: item.domain };
  if (locationCode) {
    body.location_code = locationCode;
    body.language_code = 'es';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([body]),
      },
    );
    if (!res.ok) return { name: item.name, domain: item.domain, url: item.url, apiError: `HTTP ${res.status}` };
    const data = await res.json();
    const task = data?.tasks?.[0] ?? null;
    return parseDFSItem(item.name, item.domain, item.url, task);
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'timeout' : (err.message?.slice(0, 60) ?? 'error');
    return { name: item.name, domain: item.domain, url: item.url, apiError: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * After fetching traffic data, reclassify competitors that are >MAX_RATIO× the client's
 * keyword count as "aspirational". These are excluded from the benchmark score calculation
 * but still shown in the report with a note.
 */
function labelCompetitorsBySize(
  items: ReturnType<typeof parseDFSItem>[],
  clientKw: number,
): ReturnType<typeof parseDFSItem>[] {
  const MAX_RATIO = 30;
  const threshold = Math.max(clientKw * MAX_RATIO, 2000); // never reclassify if client has <67 kw
  return items.map((item) => {
    const kw = (item as any).keywordsTop10 ?? 0;
    if (kw > threshold && !(item as any).apiError) {
      return { ...item, type: 'aspirational' as const };
    }
    return item;
  });
}

export async function runCompetitorTraffic(
  competitors: Array<{ name: string; url: string; type?: string }>,
  clientKw?: number,
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

  // One request per domain in parallel — /live endpoints reject batches with >1 task (error 40000)
  const results = await Promise.all(
    items.map(async (item) => {
      // Try Spain first
      const spainResult = await fetchSingle(auth, item, 2724);
      if (!(spainResult as any).apiError) return spainResult;

      // No Spain data → try global (no location filter)
      const err = (spainResult as any).apiError as string;
      if (err === 'no_data' || err === 'empty_items' || err.startsWith('4')) {
        console.log(`[competitor-traffic] ${item.domain}: Spain no data (${err}), trying global...`);
        const globalResult = await fetchSingle(auth, item);
        if (!(globalResult as any).apiError) return globalResult;
      }

      return spainResult;
    }),
  );

  const labeled = clientKw != null && clientKw > 0
    ? labelCompetitorsBySize(results, clientKw)
    : results;

  return { items: labeled };
}
