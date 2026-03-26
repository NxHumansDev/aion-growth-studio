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

  // If DataForSEO organic competitors are available, use them — they're guaranteed
  // to exist in DataForSEO's database, making competitor_traffic reliable.
  if (dfsOrganicCompetitors && dfsOrganicCompetitors.length > 0) {
    const competitors = await Promise.all(
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
    return { competitors };
  }

  // Otherwise: use Claude Haiku to detect competitors with structured validation
  if (!ANTHROPIC_KEY) {
    return { skipped: true, reason: 'No competitor URLs provided and ANTHROPIC_API_KEY not configured' };
  }

  const brandName = crawl.title?.split(/[-|]/)[0]?.trim() || domain;
  const description = crawl.description?.slice(0, 200) || '';

  const prompt = `Identify 3-4 competitors for this business.

Domain: ${domain}
Brand: ${brandName}
Sector: ${sector}
Description: ${description}

Reply ONLY with a valid JSON object (no explanation, no markdown):
{"competitors": [{"name": "Company Name", "url": "https://exactdomain.com", "snippet": "One sentence why they compete", "type": "direct"}]}

The "type" field must be "direct" (same subsector, similar size) or "aspirational" (larger reference, include max 1).

CRITICAL RULES — read carefully:
1. Only include companies whose EXACT website URL you know with 100% certainty from your training data
2. If you are not completely sure the URL exists, DO NOT include that company
3. The "name" field MUST be a real brand/company name — NEVER a category description like "productores de frutas"
4. MISMO SUBSECTOR: Match the specific niche, NOT the broader sector category.
   - Banca privada / wealth management (Andbank, Creand, Lombard Odier) ≠ banca retail (Santander, BBVA, Sabadell, CaixaBank). NEVER include retail banks as competitors for a private bank.
   - Consultoría boutique ≠ Big4 (Deloitte, PwC, McKinsey). NEVER include Big4 as direct competitors for a small consultancy.
   - SaaS de nicho ≠ plataformas horizontales (Salesforce, HubSpot). Match the vertical.
5. TAMAÑO SIMILAR: Prioritize competitors of similar digital size. Mark as "aspirational" (max 1) any competitor that is clearly 10x+ larger.
6. At least 2 of the 3-4 competitors must be "direct" (same subsector + comparable size).
7. Do not include ${domain} itself
8. It is better to return 2 verified direct competitors than 4 guessed ones`;

  const validated = await callHaikuWithValidation('competitors', prompt, 15000, 2);

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

  return { competitors: validList.slice(0, 4) };
}
