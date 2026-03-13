import type { CompetitorTrafficResult } from '../types';

const DFS_LOGIN = import.meta.env.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

async function dfsPost(auth: string, endpoint: string, body: any[], signal: AbortSignal) {
  const res = await fetch(`https://api.dataforseo.com/v3/${endpoint}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

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
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    // ── Tier 1: Spain domain_analytics (best relevance) ──────────────
    const data = await dfsPost(auth, 'domain_analytics/overview/live',
      items.map((item) => ({ target: item.domain, location_code: 2724, language_code: 'es' })),
      controller.signal,
    );
    const tasks: any[] = data?.tasks || [];

    const result = items.map((item, i) => {
      const tr = tasks[i]?.result?.[0];
      if (!tr) return { name: item.name, domain: item.domain, url: item.url };
      const m = tr.metrics?.organic;
      const kw10 = m ? (m.pos_1 ?? 0) + (m.pos_2_3 ?? 0) + (m.pos_4_10 ?? 0) : undefined;
      return {
        name: item.name, domain: item.domain, url: item.url,
        domainRank: tr.domain_rank ?? undefined,
        organicTrafficEstimate: m?.etv != null ? Math.round(m.etv) : undefined,
        keywordsTop10: kw10 || undefined,
      };
    });

    // ── Tier 2: Backlinks summary fallback for items missing DR ──────
    // (backlinks/summary has coverage even for very small sites)
    const needFallback = result.filter((r) => r.domainRank == null);
    if (needFallback.length > 0) {
      try {
        const blData = await dfsPost(auth, 'backlinks/summary/live',
          needFallback.map((r) => ({ target: r.domain, include_subdomains: false })),
          controller.signal,
        );
        const blTasks: any[] = blData?.tasks || [];
        needFallback.forEach((item, i) => {
          const blr = blTasks[i]?.result?.[0];
          if (!blr) return;
          // rank in backlinks/summary = DataForSEO domain rank
          item.domainRank = blr.rank ?? undefined;
          item.backlinksTotal = blr.backlinks ?? undefined;
          item.referringDomains = blr.referring_domains ?? undefined;
        });
      } catch { /* backlinks fallback failure is non-fatal */ }
    }

    return { items: result };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'DataForSEO timed out' : err.message?.slice(0, 100);
    return { skipped: true, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
