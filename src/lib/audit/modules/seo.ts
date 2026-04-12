import type { SEOResult } from '../types';

const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

export async function runSEO(url: string): Promise<SEOResult> {
  if (!DFS_LOGIN || !DFS_PASSWORD) {
    return { skipped: true, reason: 'DATAFORSEO_LOGIN/PASSWORD not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`)
    .hostname.replace(/^www\./, '');

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');

  try {
    // ── Tier 1 + Tier 2 + Organic Competitors + History in parallel ──
    // Backlinks endpoint deliberately NOT fetched — not in our DataForSEO plan
    // and we don't surface Domain Rank / referring domains in the product.
    const [overviewRes, kwRes, compRes, histRes] = await Promise.all([
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{ target: domain, location_code: 2724, language_code: 'es' }]),
      }),
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{
          target: domain,
          location_code: 2724,
          language_code: 'es',
          limit: 20,
          // Sort by ETV (Estimated Traffic Value) = volume × CTR by position.
          // This surfaces keywords that actually drive the most traffic,
          // not just those with the highest raw search volume.
          order_by: ['ranked_serp_element.serp_item.etv,desc'],
          filters: ['ranked_serp_element.serp_item.rank_absolute', '<=', 10],
        }]),
      }),
      // Organic competitors — domains competing for the same keywords in Spain.
      // These are guaranteed to have DataForSEO data (unlike LLM-guessed URLs).
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{
          target: domain,
          location_code: 2724,
          language_code: 'es',
          limit: 6,
          order_by: ['intersections,desc'],
        }]),
      }),
      // Historical rank overview — 12 months of organic ETV + keywords
      fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/historical_rank_overview/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify([{ target: domain, location_code: 2724, language_code: 'es' }]),
      }),
    ]);

    if (!overviewRes.ok) {
      const errBody = await overviewRes.json().catch(() => ({}));
      // Root-level status_message is always "Ok." even on 402/403 — read the
      // task-level message for the real cause, fall back to HTTP status code.
      const taskMsg = errBody?.tasks?.[0]?.status_message;
      const msg = taskMsg && taskMsg !== 'Ok.'
        ? `HTTP ${overviewRes.status} — ${taskMsg}`
        : `HTTP ${overviewRes.status}`;
      return { skipped: true, reason: `DataForSEO: ${msg}`.slice(0, 120) };
    }

    const [data, kwData, compData, histData] = await Promise.all([
      overviewRes.json(),
      kwRes.ok ? kwRes.json() : Promise.resolve(null),
      compRes.ok ? compRes.json() : Promise.resolve(null),
      histRes.ok ? histRes.json() : Promise.resolve(null),
    ]);

    const task = data?.tasks?.[0];

    if (!task || task.status_code !== 20000 || !task.result_count) {
      return { skipped: true, reason: 'No se pudieron obtener datos SEO para este dominio. Esto no significa que no tenga presencia orgánica — puede ser un dominio nuevo en los índices o un error temporal de la fuente de datos.' };
    }

    const item = task.result[0]?.items?.[0];
    if (!item) {
      return { skipped: true, reason: 'No se pudieron obtener datos SEO para este dominio.' };
    }

    // ── Organic metrics ─────────────────────────────────────────
    const m = item.metrics?.organic;
    const keywordsTop3 = (m?.pos_1 ?? 0) + (m?.pos_2_3 ?? 0);
    const keywordsPos4to10 = m?.pos_4_10 ?? 0;
    const keywordsTop10 = keywordsTop3 + keywordsPos4to10;
    const keywordsTop30 = keywordsTop10 + (m?.pos_11_20 ?? 0) + (m?.pos_21_30 ?? 0);

    // ── Paid metrics (Google Ads) ────────────────────────────────
    const mp = item.metrics?.paid;
    const paidKeywordsTotal = mp?.count ?? 0;
    const paidTop3Keywords = (mp?.pos_1 ?? 0) + (mp?.pos_2_3 ?? 0);

    const baseResult: SEOResult = {
      // Organic
      organicTrafficEstimate: m?.etv != null ? Math.round(m.etv) : undefined,
      estimatedAdsCost: m?.estimated_paid_traffic_cost != null ? Math.round(m.estimated_paid_traffic_cost) : undefined,
      organicKeywordsTotal: m?.count,
      keywordsTop3: keywordsTop3 || undefined,
      keywordsPos4to10: keywordsPos4to10 || undefined,
      keywordsTop10: keywordsTop10 || undefined,
      keywordsTop30: keywordsTop30 || undefined,
      trendUp: m?.is_up ?? undefined,
      trendDown: m?.is_down ?? undefined,
      trendLost: m?.is_lost ?? undefined,
      // Paid
      paidKeywordsTotal: paidKeywordsTotal || undefined,
      paidTrafficEstimate: mp?.etv != null ? Math.round(mp.etv) : undefined,
      paidTrafficValue: mp?.estimated_paid_traffic_cost != null ? Math.round(mp.estimated_paid_traffic_cost) : undefined,
      paidTop3Keywords: paidTop3Keywords || undefined,
      isInvestingPaid: paidKeywordsTotal > 0 || undefined,
    };

    const _logParts: string[] = [`kw:${keywordsTop10} etv:${m?.etv != null ? Math.round(m.etv) : 0}`];

    // ── Organic competitors from DataForSEO ───────────────────────────
    // Blocklist: generic/media domains that share informational keywords but aren't real competitors
    const GENERIC_DOMAINS = new Set([
      // Social & UGC
      'youtube.com', 'wikipedia.org', 'facebook.com', 'instagram.com', 'twitter.com',
      'x.com', 'linkedin.com', 'tiktok.com', 'pinterest.com', 'reddit.com', 'quora.com',
      // Marketplaces (too generic — compete with everyone)
      'amazon.com', 'amazon.es', 'amazon.de', 'amazon.co.uk', 'ebay.com', 'ebay.es',
      'aliexpress.com', 'alibaba.com', 'wallapop.com', 'milanuncios.com',
      // Search engines
      'google.com', 'google.es', 'bing.com',
      // News & media
      'elpais.com', 'elmundo.es', 'abc.es', 'lavanguardia.com', 'expansion.com',
      'eleconomista.es', 'cincodias.elpais.com', 'elconfidencial.com', 'eldiario.es',
      '20minutos.es', 'marca.com', 'as.com', 'huffingtonpost.es',
      // Review sites
      'trustpilot.com', 'tripadvisor.com', 'glassdoor.com', 'yelp.com',
      // Government
      'gov.es', 'boe.es', 'aeat.es', 'administracion.gob.es',
      // Supermarkets / generalist retailers (off-sector for most verticals)
      'carrefour.es', 'mercadona.es', 'lidl.es', 'alcampo.es', 'dia.es', 'aldi.es',
      'hipercor.es', 'eroski.es', 'consum.es',
      // Generic aggregators / classifieds
      'idealista.com', 'fotocasa.es', 'infojobs.net', 'indeed.com',
      // OTAs / travel aggregators (distribute, not compete)
      'booking.com', 'hotels.com', 'expedia.com', 'expedia.es', 'kayak.es', 'kayak.com',
      'trivago.es', 'trivago.com', 'agoda.com', 'hostelworld.com',
      'edreams.es', 'edreams.com', 'skyscanner.es', 'skyscanner.com',
      'lastminute.com', 'rumbo.es', 'logitravel.com', 'centraldereservas.com',
      'atrapalo.com', 'destinia.com', 'muchoviaje.com',
      // Review/directory platforms (not competitors)
      'tripadvisor.es', 'minube.com', 'escapadarural.com',
      'thefork.es', 'eltenedor.es', 'guiarepsol.com',
    ]);

    try {
      const compTask = compData?.tasks?.[0];
      if (compTask?.status_code === 20000 && compTask.result_count > 0) {
        const compItems: any[] = compTask.result[0]?.items || [];
        const organicCompetitors = compItems
          .filter((it: any) => it.domain && it.domain !== domain && !GENERIC_DOMAINS.has(it.domain))
          .slice(0, 5)
          .map((it: any) => ({
            domain: it.domain as string,
            intersections: (it.intersections ?? 0) as number,
          }));
        if (organicCompetitors.length > 0) {
          (baseResult as any).organicCompetitors = organicCompetitors;
          _logParts.push(`comps:${organicCompetitors.length}(${organicCompetitors.map((c) => c.domain).join(',')})`);
        } else {
          _logParts.push('comps:0');
        }
      } else {
        _logParts.push(`comps:skip(${compTask?.status_code ?? 'no-task'})`);
      }
    } catch { _logParts.push('comps:except'); }

    // ── Tier 2 result (already fetched in parallel above) ────────
    try {
      const kwTask = kwData?.tasks?.[0];
      if (kwTask?.status_code === 20000 && kwTask.result_count > 0) {
        const kwItems: any[] = kwTask.result[0]?.items || [];
        const domainBase = domain.replace(/\.[a-z]{2,6}$/i, '').toLowerCase();

        // Stopwords and junk patterns to filter out
        const JUNK_RE = /^(el|la|los|las|de|del|en|un|una|que|por|con|para|the|of|in|and|to|is|at|it|on|a|an)$/i;
        const NOISE_RE = /^(real decreto|decreto|ley |boe |orden |resolución |sentencia |auto |circular )/i;

        const topKeywords = kwItems
          .filter((it: any) => {
            const kw = (it.keyword_data?.keyword || '').trim().toLowerCase();
            const vol = it.keyword_data?.keyword_info?.search_volume ?? 0;
            // Reject: brand terms, very short, only stopwords, legislative junk, no volume
            if (kw.includes(domainBase)) return false;
            if (kw.length < 4) return false;
            if (JUNK_RE.test(kw)) return false;
            if (NOISE_RE.test(kw)) return false;
            // Reject keywords that are just 1-2 char fragments
            if (kw.split(/\s+/).every((w: string) => w.length <= 2)) return false;
            // Prefer keywords with actual search volume
            if (vol === 0) return false;
            return true;
          })
          .slice(0, 8) // take more to have buffer after final filter
          .map((it: any) => ({
            keyword: it.keyword_data?.keyword || '',
            position: it.ranked_serp_element?.serp_item?.rank_absolute ?? 0,
            volume: it.keyword_data?.keyword_info?.search_volume ?? 0,
            etv: Math.round(it.ranked_serp_element?.serp_item?.etv ?? 0),
          }))
          .filter((kw) => kw.keyword && kw.volume > 0)
          .slice(0, 6);

        if (topKeywords.length > 0) baseResult.topKeywords = topKeywords;
      }
    } catch { /* non-fatal */ }

    // ── Tier 3: Paid detection via Google Ads keyword data ──────
    // DataForSEO Labs paid data is often empty (their SERP scraper doesn't capture ads
    // reliably). Instead, use Google Ads keyword_data to detect paid activity via CPC
    // and competition level for brand + top organic keywords.
    if (!baseResult.isInvestingPaid) {
      try {
        const brandKw = domain.replace(/\.[a-z]{2,6}$/i, '').replace(/[-_.]/g, ' ');
        const topOrgKw = (baseResult as any).topKeywords?.slice(0, 3)?.map((k: any) => k.keyword) || [];
        const checkKeywords = [brandKw, ...topOrgKw].filter(Boolean).slice(0, 5);

        if (checkKeywords.length > 0) {
          const adsRes = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
            body: JSON.stringify([{
              keywords: checkKeywords,
              location_code: 2724,
              language_code: 'es',
            }]),
          });

          if (adsRes.ok) {
            const adsData = await adsRes.json();
            const kwResults: any[] = adsData?.tasks?.[0]?.result || [];
            // Brand keyword competition level
            const brandResult = kwResults.find((kw: any) =>
              kw.keyword?.toLowerCase() === brandKw.toLowerCase()
            );
            const brandCompetition = brandResult?.competition || 'UNSPECIFIED';
            const brandCpc = brandResult?.cpc ?? 0;

            // Detect paid: brand kw has HIGH/MEDIUM competition AND CPC > 0
            if ((brandCompetition === 'HIGH' || brandCompetition === 'MEDIUM') && brandCpc > 0) {
              baseResult.isInvestingPaid = true;
              baseResult.paidDetectionMethod = 'google_ads_competition';
              _logParts.push(`paid:cpc(${brandKw}=${brandCpc}€,${brandCompetition})`);
            }

            // Store CPC data for top keywords (useful for report)
            const paidKwData = kwResults
              .filter((kw: any) => kw.cpc > 0 && kw.competition !== 'UNSPECIFIED')
              .map((kw: any) => ({
                keyword: kw.keyword,
                volume: kw.search_volume ?? 0,
                cpc: kw.cpc,
                competition: kw.competition,
              }));
            if (paidKwData.length > 0) {
              baseResult.paidTopKeywords = paidKwData;
            }
          }
        }
      } catch { _logParts.push('paid:cpc-except'); }
    }

    // ── Historical organic trend (12 months) ────────────────────────
    try {
      const histTask = histData?.tasks?.[0];
      if (histTask?.status_code === 20000 && histTask.result_count > 0) {
        const histItems: any[] = histTask.result[0]?.items || [];
        // Each item has .year, .month, .metrics.organic {etv, count, pos_1, pos_2_3, pos_4_10, ...}
        const organicHistory = histItems
          .filter((it: any) => it.metrics?.organic)
          .map((it: any) => {
            const mo = it.metrics.organic;
            const kwTop10 = (mo.pos_1 ?? 0) + (mo.pos_2_3 ?? 0) + (mo.pos_4_10 ?? 0);
            return {
              month: `${it.year}-${String(it.month).padStart(2, '0')}`,
              etv: Math.round(mo.etv ?? 0),
              keywords: kwTop10,
            };
          })
          .sort((a: any, b: any) => a.month.localeCompare(b.month))
          .slice(-12); // last 12 months

        if (organicHistory.length >= 3) {
          baseResult.organicHistory = organicHistory;

          // Calculate trend: compare average of last 3 months vs first 3 months
          const recent3 = organicHistory.slice(-3);
          const older3 = organicHistory.slice(0, 3);
          const avgRecent = recent3.reduce((s, p) => s + p.etv, 0) / recent3.length;
          const avgOlder = older3.reduce((s, p) => s + p.etv, 0) / older3.length;

          if (avgOlder > 0) {
            const changePct = Math.round(((avgRecent - avgOlder) / avgOlder) * 100);
            baseResult.organicTrendPct = changePct;
            baseResult.organicTrend = changePct > 10 ? 'up' : changePct < -10 ? 'down' : 'stable';
          } else if (avgRecent > 0) {
            baseResult.organicTrend = 'up';
            baseResult.organicTrendPct = 100;
          } else {
            baseResult.organicTrend = 'stable';
            baseResult.organicTrendPct = 0;
          }

          _logParts.push(`hist:${organicHistory.length}m trend:${baseResult.organicTrend}(${baseResult.organicTrendPct}%)`);
        } else {
          _logParts.push(`hist:${organicHistory.length}m(insufficient)`);
        }
      } else {
        _logParts.push('hist:no-data');
      }
    } catch { _logParts.push('hist:except'); }

    // ── Brand vs Non-Brand traffic + Indexed pages (parallel) ─────
    const domainRaw = domain.replace(/\.[a-z]{2,6}$/i, '');
    const domainBase = domainRaw.replace(/[-_.]/g, '').toLowerCase();
    // Generate brand terms for local matching: all meaningful parts of the domain
    const brandTerms: string[] = [domainBase];
    const domainSpaced = domainRaw.replace(/[-_.]/g, ' ').toLowerCase().trim();
    if (domainSpaced.includes(' ')) {
      domainSpaced.split(' ').filter(w => w.length >= 3).forEach(w => brandTerms.push(w));
    } else if (domainBase.length > 6) {
      // Compound name: try first half and second half as separate brand terms
      const mid = Math.ceil(domainBase.length * 0.5);
      brandTerms.push(domainBase.slice(0, mid));
      if (domainBase.length - mid >= 4) brandTerms.push(domainBase.slice(mid));
      // Also add a shorter prefix for broader API matching — catches rearranged
      // brand keywords (e.g. "inmobiliarias comillas" for "comillasinmobiliaria")
      const prefixLen = Math.min(7, mid);
      if (prefixLen >= 4) {
        const prefix = domainBase.slice(0, prefixLen);
        if (!brandTerms.includes(prefix)) brandTerms.push(prefix);
      }
    }

    // For API filter, use the SHORTEST distinctive term (≥4 chars) to catch
    // spaced variations. "davidlloyd" → filter by "david" catches "david lloyd"
    const brandFilterCandidates = brandTerms
      .filter(t => t.length >= 4 && t !== domainBase)
      .sort((a, b) => a.length - b.length);
    const brandFilter = brandFilterCandidates[0] || domainBase;

    try {
      const [brandRes, siteSearchRes, sitemapRes] = await Promise.all([
        // Brand keywords: filter ranked_keywords by brand name
        fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
          body: JSON.stringify([{
            target: domain,
            location_code: 2724,
            language_code: 'es',
            limit: 100,
            filters: ['keyword_data.keyword', 'like', `%${brandFilter}%`],
          }]),
        }),
        // Indexed pages: site: search via SERP
        fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
          body: JSON.stringify([{
            keyword: `site:${domain}`,
            location_code: 2724,
            language_code: 'es',
            depth: 1,
          }]),
        }),
        // Sitemap URL count
        fetch(new URL('/sitemap.xml', `https://${domain}`).href, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
        }).catch(() => null),
      ]);

      // Brand traffic
      if (brandRes.ok) {
        const brandData = await brandRes.json();
        const brandTask = brandData?.tasks?.[0];
        if (brandTask?.status_code === 20000) {
          const brandItems: any[] = brandTask.result?.[0]?.items || [];
          let brandEtv = 0;
          let totalSampledEtv = 0;
          let brandKwCount = 0;
          brandItems.forEach((it: any) => {
            const kw = (it.keyword_data?.keyword || '').toLowerCase();
            const itemEtv = it.ranked_serp_element?.serp_item?.etv ?? 0;
            totalSampledEtv += itemEtv;
            // Match: full compound OR 2+ brand parts present in the keyword
            const matchCount = brandTerms.filter(t => kw.includes(t)).length;
            // Reverse check: ≥2 significant keyword words have stems in the domain
            const kwWords = kw.split(/\s+/).filter(w => w.length >= 5);
            const reverseMatch = kwWords.length >= 2 &&
              kwWords.filter(w => {
                const stem = w.slice(0, Math.max(5, Math.min(w.length - 1, 8)));
                return domainBase.includes(stem);
              }).length >= 2;
            // Concatenation check: join keyword words and see if it matches domain
            // "frutas eloy" → "frutaseloy" === domainBase "frutaseloy"
            const kwConcatenated = kw.replace(/\s+/g, '');
            const concatMatch = kwConcatenated === domainBase || domainBase.includes(kwConcatenated) || kwConcatenated.includes(domainBase);

            const isBrand = kw.includes(domainBase) || concatMatch || matchCount >= 2 ||
              (brandTerms.length === 1 && matchCount >= 1) || reverseMatch;
            if (isBrand) {
              brandEtv += itemEtv;
              brandKwCount++;
            }
          });
          // Compare brand ETV against TOTAL organic traffic (not sampled subset).
          // The sampled dataset is pre-filtered by brand name so comparing against it
          // always yields ~100% — a nonsensical result.
          const totalOrganic = baseResult.organicTrafficEstimate || 0;
          baseResult.brandTrafficEtv = Math.round(brandEtv);
          baseResult.nonBrandTrafficEtv = Math.max(0, totalOrganic - Math.round(brandEtv));
          baseResult.brandTrafficPct = totalOrganic > 0 ? Math.min(100, Math.round((brandEtv / totalOrganic) * 100)) : 0;
          baseResult.brandKeywords = brandKwCount;
          _logParts.push(`brand:${baseResult.brandTrafficPct}%(${brandKwCount}kw,sampled:${Math.round(totalSampledEtv)})`);
        }
      }

      // Indexed pages from site: search
      if (siteSearchRes.ok) {
        const siteData = await siteSearchRes.json();
        const siteTask = siteData?.tasks?.[0];
        if (siteTask?.status_code === 20000) {
          const totalResults = siteTask.result?.[0]?.se_results_count ?? null;
          if (totalResults != null) {
            baseResult.indexedPages = totalResults;
            _logParts.push(`indexed:${totalResults}`);
          }
        }
      }

      // Sitemap URL count — follow sitemap index if needed
      if (sitemapRes && sitemapRes.ok) {
        const sitemapText = await sitemapRes.text();
        let totalLocCount = 0;
        const isSitemapIndex = /<sitemapindex[\s>]/i.test(sitemapText);

        if (isSitemapIndex) {
          // Extract sub-sitemap URLs (limit to 5 to avoid excessive fetches)
          const subUrls = (sitemapText.match(/<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/gi) || [])
            .map(m => m.replace(/<\/?loc>/gi, '').trim())
            .slice(0, 5);
          const subResults = await Promise.allSettled(
            subUrls.map(u => fetch(u, {
              signal: AbortSignal.timeout(60_000),
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
            }).then(r => r.ok ? r.text() : ''))
          );
          for (const r of subResults) {
            if (r.status === 'fulfilled' && r.value) {
              totalLocCount += (r.value.match(/<loc>/gi) || []).length;
            }
          }
          _logParts.push(`sitemap:index(${subUrls.length}subs)`);
        } else {
          totalLocCount = (sitemapText.match(/<loc>/gi) || []).length;
        }

        if (totalLocCount > 0) {
          baseResult.sitemapPages = totalLocCount;
          if (baseResult.indexedPages != null) {
            const rawRatio = Math.round((baseResult.indexedPages / totalLocCount) * 100);
            baseResult.indexationRatio = rawRatio;
            // Flag when Google indexes more pages than sitemap has (bloat/duplicates)
            baseResult.indexInflated = rawRatio > 110;
          }
          _logParts.push(`sitemap:${totalLocCount} ratio:${baseResult.indexationRatio ?? '?'}%`);
        }
      }
    } catch (err: any) {
      console.error(`[seo] brand/index block threw:`, err?.message || err);
      _logParts.push(`brand/index:except(${(err?.message || 'unknown').slice(0, 40)})`);
    }

    baseResult._log = _logParts.join(' ');

    return baseResult;
  } catch (err: any) {
    const msg = err.message?.slice(0, 100) || 'unknown error';
    return { skipped: true, reason: `DataForSEO: ${msg}` };
  }
}
