import type { TrafficResult } from '../types';

const LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

const BASE_URL = 'https://api.dataforseo.com/v3/traffic_analytics/summary/live';

const COUNTRY_NAMES: Record<string, string> = {
  ES: 'España', US: 'EE.UU.', MX: 'México', AR: 'Argentina',
  CO: 'Colombia', CL: 'Chile', PE: 'Perú', GB: 'Reino Unido',
  DE: 'Alemania', FR: 'Francia', IT: 'Italia', BR: 'Brasil',
  PT: 'Portugal', CA: 'Canadá', AU: 'Australia',
};

async function fetchTrafficSummary(
  domain: string,
  auth: string,
  dateFrom: string,
  dateTo: string,
): Promise<any> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ target: domain, date_from: dateFrom, date_to: dateTo }]),
  });
  if (!res.ok) {
    console.error(`[traffic] HTTP ${res.status} for ${domain} (${dateFrom} → ${dateTo})`);
    return null;
  }
  const data = await res.json();
  const task = data?.tasks?.[0];
  if (task?.status_code !== 20000) {
    console.error(`[traffic] DFS status ${task?.status_code}: ${task?.status_message} for ${domain} (${dateFrom} → ${dateTo})`);
    return null;
  }
  if (!task.result?.[0]) {
    console.error(`[traffic] No result for ${domain} (${dateFrom} → ${dateTo})`);
    return null;
  }
  return task.result[0];
}

export async function runTraffic(url: string): Promise<TrafficResult> {
  if (!LOGIN || !PASSWORD) {
    return { skipped: true, reason: 'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`)
    .hostname.replace(/^www\./, '');

  const auth = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

  // Use last 3 complete months (not current month which has no data yet)
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

  const dateFrom = fmtDate(threeMonthsAgo);
  const dateTo = fmtDate(lastMonth);

  // Also fetch previous 3 months for YoY comparison
  const prevEnd = new Date(threeMonthsAgo.getFullYear(), threeMonthsAgo.getMonth(), 1);
  const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth() - 3, 1);

  console.log(`[traffic] ${domain}: current ${dateFrom} → ${dateTo} | prev ${fmtDate(prevStart)} → ${fmtDate(prevEnd)}`);

  try {
    const [resultCurrent, resultPrev] = await Promise.all([
      fetchTrafficSummary(domain, auth, dateFrom, dateTo),
      fetchTrafficSummary(domain, auth, fmtDate(prevStart), fmtDate(prevEnd)),
    ]);

    if (!resultCurrent) {
      return { skipped: true, reason: 'Datos de distribución de tráfico no disponibles para este dominio.' };
    }

    const metrics = resultCurrent.metrics || {};

    // Sum all channel visits for total
    const channelKeys = ['organic', 'paid', 'social', 'referral', 'direct', 'email'];
    let totalVisits = 0;
    const channels: TrafficResult['channels'] = {};

    for (const key of channelKeys) {
      const ch = metrics[key];
      if (ch?.visits) {
        totalVisits += ch.visits;
        (channels as any)[key] = { visits: ch.visits };
      }
    }

    // Calculate share per channel
    if (totalVisits > 0) {
      for (const key of channelKeys) {
        const ch = (channels as any)[key];
        if (ch) {
          ch.share = Math.round((ch.visits / totalVisits) * 100);
        }
      }
    }

    // Period-over-period growth
    let visitsGrowth: number | undefined;
    if (resultPrev) {
      const prevMetrics = resultPrev.metrics || {};
      let prevTotal = 0;
      for (const key of channelKeys) {
        prevTotal += prevMetrics[key]?.visits || 0;
      }
      if (prevTotal > 0 && totalVisits > 0) {
        visitsGrowth = Math.round(((totalVisits - prevTotal) / prevTotal) * 100);
      }
    }

    // Top countries
    const topCountries: TrafficResult['topCountries'] = (resultCurrent.top_countries || [])
      .slice(0, 5)
      .map((c: any) => ({
        code: c.country_iso_code,
        name: COUNTRY_NAMES[c.country_iso_code] || c.country_iso_code,
        share: Math.round((c.traffic_share || 0) * 100),
      }));

    // Use organic metrics for bounce rate / pages / duration (most reliable)
    const organic = metrics.organic || metrics.direct || {};

    console.log(`[traffic] ${domain}: OK — ${totalVisits} visits, ${Object.keys(channels).length} channels`);

    return {
      visits: totalVisits || undefined,
      visitsGrowth,
      bounceRate: organic.bounce_rate ? Math.round(organic.bounce_rate * 100) : undefined,
      pagesPerVisit: organic.pages_per_visit ? Math.round(organic.pages_per_visit * 10) / 10 : undefined,
      avgSessionDuration: organic.avg_session_duration ? Math.round(organic.avg_session_duration) : undefined,
      channels: Object.keys(channels).length > 0 ? channels : undefined,
      topCountries: topCountries.length > 0 ? topCountries : undefined,
    };
  } catch (err: any) {
    console.error(`[traffic] ${domain}: ${err.message}`);
    return { skipped: true, reason: err.message?.slice(0, 100) };
  }
}
