import type { TrafficResult } from '../types';

const LOGIN = import.meta.env.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const PASSWORD = import.meta.env.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

const COUNTRY_NAMES: Record<string, string> = {
  ES: 'España', US: 'EE.UU.', MX: 'México', AR: 'Argentina',
  CO: 'Colombia', CL: 'Chile', PE: 'Perú', GB: 'Reino Unido',
  DE: 'Alemania', FR: 'Francia', IT: 'Italia', BR: 'Brasil',
  PT: 'Portugal', CA: 'Canadá', AU: 'Australia',
};

export async function runTraffic(url: string): Promise<TrafficResult> {
  if (!LOGIN || !PASSWORD) {
    return { skipped: true, reason: 'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`)
    .hostname.replace(/^www\./, '');

  const auth = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

  // Date range: last 12 months
  const now = new Date();
  const dateTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const dateFrom = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const dateFromStr = `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, '0')}-01`;

  try {
    const res = await fetch('https://api.dataforseo.com/v3/traffic_analytics/summary/live', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        {
          target: domain,
          date_from: dateFromStr,
          date_to: dateTo,
        },
      ]),
    });

    if (!res.ok) {
      return { skipped: true, reason: `DataForSEO API error: ${res.status}` };
    }

    const data = await res.json();
    const task = data?.tasks?.[0];

    if (task?.status_code !== 20000) {
      const msg = task?.status_message || 'Unknown error';
      // Insufficient data = domain too small or new
      if (msg.includes('not found') || msg.includes('No data')) {
        return { skipped: true, reason: 'Tráfico insuficiente para estimar (dominio muy pequeño o nuevo)' };
      }
      return { skipped: true, reason: msg };
    }

    const result = task?.result?.[0];
    if (!result) {
      return { skipped: true, reason: 'Sin datos de tráfico disponibles' };
    }

    const metrics = result.metrics || {};

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

    // Top countries
    const topCountries: TrafficResult['topCountries'] = (result.top_countries || [])
      .slice(0, 5)
      .map((c: any) => ({
        code: c.country_iso_code,
        name: COUNTRY_NAMES[c.country_iso_code] || c.country_iso_code,
        share: Math.round((c.traffic_share || 0) * 100),
      }));

    // Use organic metrics for bounce rate / pages / duration (most reliable)
    const organic = metrics.organic || metrics.direct || {};

    return {
      visits: totalVisits || undefined,
      bounceRate: organic.bounce_rate ? Math.round(organic.bounce_rate * 100) : undefined,
      pagesPerVisit: organic.pages_per_visit ? Math.round(organic.pages_per_visit * 10) / 10 : undefined,
      avgSessionDuration: organic.avg_session_duration ? Math.round(organic.avg_session_duration) : undefined,
      channels: Object.keys(channels).length > 0 ? channels : undefined,
      topCountries: topCountries.length > 0 ? topCountries : undefined,
    };
  } catch (err: any) {
    return { skipped: true, reason: err.message?.slice(0, 100) };
  }
}
