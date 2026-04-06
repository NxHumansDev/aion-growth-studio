import axios from 'axios';
import * as cheerio from 'cheerio';
import type { CompetitorsResult, CrawlResult } from '../types';
import { callHaikuWithValidation } from '../llm-utils';

const ANTHROPIC_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

/** HEAD-check competitor domains in parallel — filter out invented/dead domains */
async function filterValidDomains(
  competitors: Array<{ name: string; url: string; snippet: string }>,
): Promise<Array<{ name: string; url: string; snippet: string }>> {
  const checked = await Promise.allSettled(
    competitors.map(async (comp) => {
      const normalized = comp.url.startsWith('http') ? comp.url : `https://${comp.url}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(normalized, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
        });
        clearTimeout(timer);
        // 403 = domain exists but blocks HEAD; still valid
        const valid = res.ok || res.status === 403 || res.status === 405;
        return { comp, valid };
      } catch {
        clearTimeout(timer);
        return { comp, valid: false };
      }
    }),
  );

  const valid = checked
    .filter(
      (r): r is PromiseFulfilledResult<{ comp: typeof competitors[0]; valid: boolean }> =>
        r.status === 'fulfilled' && r.value.valid,
    )
    .map((r) => r.value.comp);

  // Return only validated entries — never fall back to unvalidated list.
  // Returning hallucinated competitors is worse than returning none.
  return valid;
}

/** Reject company names that look like category descriptions rather than brand names */
const GENERIC_NAME_RE = /^(mejores|principales|top\s|leading|empresas?\s+de|proveedor|distribuidor|importador|exportador|productores?\s+de|fabricante|mayorista|minorista|tienda\s+de|comercio\s+de|market|category|industry)/i;

/** Fallback competitors by sector when all detection methods fail */
const SECTOR_DEFAULT_COMPETITORS: Record<string, Array<{ name: string; url: string; snippet: string }>> = {
  'banca_privada':     [{ name: 'Andbank', url: 'https://andbank.es', snippet: 'Referencia del sector' }, { name: 'Banca March', url: 'https://bancamarch.es', snippet: 'Referencia del sector' }, { name: 'Singular Bank', url: 'https://singularbank.es', snippet: 'Referencia del sector' }, { name: 'Indosuez', url: 'https://ca-indosuez.com', snippet: 'Referencia del sector' }, { name: 'A&G Banca Privada', url: 'https://aygbancoprivado.es', snippet: 'Referencia del sector' }],
  'banca privada':     [{ name: 'Andbank', url: 'https://andbank.es', snippet: 'Referencia del sector' }, { name: 'Banca March', url: 'https://bancamarch.es', snippet: 'Referencia del sector' }, { name: 'Singular Bank', url: 'https://singularbank.es', snippet: 'Referencia del sector' }, { name: 'Indosuez', url: 'https://ca-indosuez.com', snippet: 'Referencia del sector' }, { name: 'A&G Banca Privada', url: 'https://aygbancoprivado.es', snippet: 'Referencia del sector' }],
  'wealth management': [{ name: 'Andbank', url: 'https://andbank.es', snippet: 'Referencia del sector' }, { name: 'Banca March', url: 'https://bancamarch.es', snippet: 'Referencia del sector' }, { name: 'Singular Bank', url: 'https://singularbank.es', snippet: 'Referencia del sector' }, { name: 'Indosuez', url: 'https://ca-indosuez.com', snippet: 'Referencia del sector' }, { name: 'A&G Banca Privada', url: 'https://aygbancoprivado.es', snippet: 'Referencia del sector' }],
};

export async function runCompetitors(
  url: string,
  sector: string,
  crawl: CrawlResult = {},
  userCompetitorUrls?: string[],
  dfsOrganicCompetitors?: Array<{ domain: string; intersections: number }>,
): Promise<CompetitorsResult> {
  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');

  // Titles that indicate the page wasn't the real site (Cloudflare challenge, 404, etc.)
  const BAD_TITLE_RE = /^(just a moment|attention required|403|404|400|500|error|access denied|not found|forbidden|please wait|one moment|verifying|checking your browser|ddos protection|enable javascript|page not found|redirecting|site not found|domain for sale|coming soon|parked|p[aá]gina\s+no\s+encontrada|no\s+encontrada|acceso\s+denegado|recurso\s+no\s+encontrado|seite\s+nicht\s+gefunden|page\s+introuvable)/i;

  // If user selected competitors, fetch their names and use them directly.
  // Users can paste subpage URLs (e.g. bancsabadell.com/es/banca-privada) to scope
  // the competitor to a specific division. We use the subpage title as the name so the
  // context is preserved ("Banca privada · Banco Sabadell" → "Banca privada").
  // NOTE: DataForSEO traffic/keyword data is always domain-level regardless of subpath.
  if (userCompetitorUrls && userCompetitorUrls.length > 0) {
    const competitors = await Promise.all(
      userCompetitorUrls.slice(0, 5).map(async (compUrl) => {
        const normalized = compUrl.startsWith('http') ? compUrl : `https://${compUrl}`;
        const parsed = new URL(normalized);
        const compDomain = parsed.hostname.replace(/^www\./, '');
        const rootUrl = `${parsed.protocol}//${parsed.hostname}`;
        const hasSubpath = parsed.pathname.length > 1;

        // Helper: extract best name from a loaded cheerio page
        const extractName = ($: ReturnType<typeof cheerio.load>) => {
          const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim();
          if (ogSite && ogSite.length > 1 && !BAD_TITLE_RE.test(ogSite)) return ogSite;
          const titleRaw = $('title').first().text().split(/[-–—|·:]/)[0].trim().slice(0, 80);
          return (titleRaw && !BAD_TITLE_RE.test(titleRaw)) ? titleRaw : null;
        };

        try {
          // Step 1: try the exact URL provided (captures section context when it's a subpage)
          const res = await axios.get(normalized, {
            timeout: 6000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
            validateStatus: (s) => s < 500,
          });
          const $sub = cheerio.load(res.data as string);
          const nameFromSubpage = extractName($sub);

          if (nameFromSubpage) {
            return { name: nameFromSubpage, url: compUrl, snippet: 'Competidor seleccionado' };
          }

          // Step 2: subpage returned error/challenge page — fall back to root domain
          if (hasSubpath) {
            const rootRes = await axios.get(rootUrl, {
              timeout: 5000,
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
              validateStatus: (s) => s < 500,
            });
            const $root = cheerio.load(rootRes.data as string);
            const nameFromRoot = extractName($root);
            if (nameFromRoot) return { name: nameFromRoot, url: compUrl, snippet: 'Competidor seleccionado' };
          }
        } catch { /* fall through to domain fallback */ }

        return { name: compDomain, url: compUrl, snippet: 'Competidor seleccionado' };
      }),
    );
    return { competitors };
  }

  // DataForSEO organic competitors — guaranteed to have SEO data.
  // Use them as base, then fill with Haiku if needed (up to 3-4 total).
  const dfsCompetitors: Array<{ name: string; url: string; snippet: string }> = [];
  if (dfsOrganicCompetitors && dfsOrganicCompetitors.length > 0) {
    const resolved = await Promise.all(
      dfsOrganicCompetitors.slice(0, 5).map(async (comp) => {
        const normalized = `https://${comp.domain}`;
        try {
          const res = await axios.get(normalized, {
            timeout: 6000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
            validateStatus: (s) => s < 500,
          });
          const $ = cheerio.load(res.data as string);
          const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim();
          const titleRaw = $('title').first().text().split(/[-–—|·:]/)[0].trim().slice(0, 80);
          const rawName = (ogSite && ogSite.length > 1) ? ogSite : titleRaw;
          const name = (rawName && !BAD_TITLE_RE.test(rawName)) ? rawName : comp.domain;
          return { name, url: normalized, snippet: `${comp.intersections} shared keywords` };
        } catch {
          return { name: comp.domain, url: normalized, snippet: `${comp.intersections} shared keywords` };
        }
      }),
    );
    dfsCompetitors.push(...resolved);

    // If we have 3+ DFS competitors, use them directly (best quality)
    if (dfsCompetitors.length >= 3) {
      return { competitors: dfsCompetitors.slice(0, 4) };
    }
    // If only 1-2 DFS competitors, they might be irrelevant (e.g., a recipe blog
    // as "competitor" for a fruit distributor). Filter by checking shared keyword ratio.
    // If a DFS competitor has >50x our traffic, it's probably not a real competitor.
  }

  // Not enough DFS competitors — supplement with Haiku suggestions
  // Haiku competitors may lack DataForSEO data, but they're sector-relevant

  // Otherwise: use Claude Haiku to detect competitors with structured validation
  if (!ANTHROPIC_KEY) {
    // Try sector fallback before giving up
    const sectorKey = sector.toLowerCase();
    const fallback = SECTOR_DEFAULT_COMPETITORS[sectorKey]
      || SECTOR_DEFAULT_COMPETITORS[Object.keys(SECTOR_DEFAULT_COMPETITORS).find(k => sectorKey.includes(k)) || ''];
    if (fallback) {
      return { competitors: fallback.map(c => ({ ...c, snippet: 'Benchmark de referencia del sector' })) };
    }
    return { skipped: true, reason: 'No competitor URLs provided and ANTHROPIC_API_KEY not configured' };
  }

  const brandName = crawl.title?.split(/[-|]/)[0]?.trim() || domain;
  const description = crawl.description?.slice(0, 200) || '';
  const locationHint = crawl.locationHint || '';

  const prompt = `Identify 3-4 competitors for this business. These competitors MUST have a website with enough online presence to appear in SEO tools (DataForSEO, SEMrush, Ahrefs). Do NOT suggest tiny businesses with no digital footprint.

Domain: ${domain}
Brand: ${brandName}
Sector: ${sector}
Description: ${description}
${locationHint ? `Location: ${locationHint}` : ''}

Reply ONLY with valid JSON (no markdown, no backticks, start with {):
{"competitors": [{"name": "Company Name", "url": "https://exactdomain.com", "snippet": "One sentence why they compete", "type": "direct"}]}

The "type" field must be "direct" (same subsector, similar size) or "aspirational" (larger reference, include max 1).

CRITICAL RULES:
1. URLS REALES: Only include companies whose EXACT website URL you know with 100% certainty. If unsure, DO NOT include.
2. NOMBRE REAL: Must be a real brand name, NEVER a category description.
3. MISMO SUBSECTOR Y REGIÓN: Match the specific niche AND geographic market.
   - "${brandName}" operates in "${sector}" ${locationHint ? `in ${locationHint}` : 'in Spain'}.
   - Find competitors in the SAME subsector and SAME region/country.
   - Banca privada ≠ banca retail. Consultoría boutique ≠ Big4. Distribuidor B2B ≠ e-commerce B2C.
4. PRESENCIA DIGITAL RELEVANTE: Competitors MUST have a real website with content, blog, or product pages.
   Do NOT suggest companies that only have a one-page website or no SEO presence.
   A good competitor should have at least 50+ indexed pages in Google.
5. TAMAÑO SIMILAR: Prioritize competitors of similar digital size. Max 1 "aspirational" (10x+ larger).
6. At least 2 of 3-4 must be "direct" (same subsector + comparable size).
7. Do not include ${domain} itself.
8. Better to return 2 verified competitors than 4 guessed ones.`;

  // Use Sonnet for better sector understanding and competitor relevance
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let validated: any = null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      let text = data?.content?.[0]?.text || '';
      const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (mdMatch) text = mdMatch[1].trim();
      try { validated = JSON.parse(text); } catch {
        try { validated = JSON.parse(text.replace(/,\s*([\]}])/g, '$1')); } catch { /* ignore */ }
      }
    }
  } catch { clearTimeout(timer); }

  if (!validated) {
    // Fallback to Haiku if Sonnet fails
    validated = await callHaikuWithValidation('competitors', prompt, 15000, 2);
  }

  if (!validated) {
    return { competitors: [], error: 'LLM failed to produce valid competitors' };
  }

  // Filter and normalize — reject generic description names
  const rawList = validated.competitors
    .filter((c) => !c.url.includes(domain))
    .filter((c) => !GENERIC_NAME_RE.test(c.name.trim()))
    .slice(0, 5)
    .map((c) => ({
      name: c.name.slice(0, 80),
      url: c.url.slice(0, 120),
      snippet: (c.snippet || '').slice(0, 150),
    }));

  // Validate that domains actually exist (eliminates hallucinated domains)
  const validList = await filterValidDomains(rawList);

  // If all LLM competitors were invalid, try sector fallback
  if (validList.length === 0) {
    const sectorKey = sector.toLowerCase();
    const fallback = SECTOR_DEFAULT_COMPETITORS[sectorKey]
      || SECTOR_DEFAULT_COMPETITORS[Object.keys(SECTOR_DEFAULT_COMPETITORS).find(k => sectorKey.includes(k)) || ''];
    if (fallback) {
      return { competitors: fallback.slice(0, 4).map(c => ({ ...c, snippet: 'Benchmark de referencia del sector' })) };
    }
  }

  // Combine: DFS competitors first (guaranteed data), then Haiku-validated ones
  const combined = [...dfsCompetitors];
  const dfsUrls = new Set(dfsCompetitors.map(c => new URL(c.url).hostname.replace(/^www\./, '')));
  for (const comp of validList) {
    const compHost = new URL(comp.url.startsWith('http') ? comp.url : `https://${comp.url}`).hostname.replace(/^www\./, '');
    if (!dfsUrls.has(compHost)) {
      combined.push(comp);
    }
  }

  console.log(`[competitors] ${dfsCompetitors.length} from DataForSEO + ${combined.length - dfsCompetitors.length} from Haiku = ${combined.length} total`);
  return { competitors: combined.slice(0, 4) };
}
