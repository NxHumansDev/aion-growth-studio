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
      const timer = setTimeout(() => controller.abort(), 60_000);
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
// Leading-token blocklist — anything starting with these is a category description,
// not a company name. Case-insensitive, matches word prefix to avoid false positives
// on legit brand names that happen to contain an industry term ("Compañía Cervecera").
const GENERIC_NAME_RE = /^(mejores|principales|top\s|leading|empresas?\s+de|proveedor|distribuidor|importador|exportador|productores?\s+de|fabricante|mayorista|minorista|tienda\s+de|comercio\s+de|market|category|industry|promotora\b|promotor\b|compañ[íi]a\s+de|constructora\s+de|inmobiliaria\s+de|agencia\s+de|estudio\s+de|despacho\s+de|consultora\s+de|firma\s+de|bufete\s+de|clinica\s+de|cl[íi]nica\s+de|centro\s+de|grupo\s+de|servicio\s+de|solutions?\s+for|services?\s+for)/i;

/**
 * Heuristic: looks like a description rather than a brand name?
 * Real brand names are usually 1-3 words, with meaningful capitalization.
 * Descriptions tend to be 4+ words with articles/prepositions lowercase.
 */
function looksLikeDescription(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/);
  if (words.length <= 2) return false;  // 1-2 words → definitely a brand
  if (words.length >= 5) return true;   // 5+ words → definitely a description
  // 3-4 words: check lowercase article/preposition count
  const articles = /^(de|del|la|el|los|las|en|con|para|y|o|of|the|for|in|and|a|an)$/i;
  const articleCount = words.filter((w) => articles.test(w)).length;
  return articleCount >= 2;
}

/**
 * Given a validated competitor URL, derive a sensible display name from the
 * domain when the LLM returned a generic description instead of a real name.
 * e.g. "aedashomes.com" → "Aedashomes", "via-celere.es" → "Via Celere"
 */
function domainToBrandName(url: string): string {
  try {
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
    const base = host.replace(/\.[a-z]{2,6}(\.[a-z]{2,6})?$/i, '');
    // Split on hyphens/dots → title-case each token → join with space
    return base
      .split(/[-_.]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  } catch {
    return url;
  }
}

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
  extraContext?: { businessType?: string; instagramBio?: string; gbpCategories?: string[] },
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

        // Helper: extract best name from a loaded cheerio page.
        // Prioritises og:site_name, then the title part most similar to the domain.
        // Old logic blindly took title.split('|')[0], which picked taglines like
        // "Consultoría de negocio especialista en Power BI" over the actual brand.
        const compDomainBase = compDomain.replace(/\.[a-z]{2,6}$/i, '').replace(/-/g, '').toLowerCase();
        const extractName = ($: ReturnType<typeof cheerio.load>) => {
          const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim();
          if (ogSite && ogSite.length > 1 && !BAD_TITLE_RE.test(ogSite)) return ogSite;
          const fullTitle = $('title').first().text().trim().slice(0, 120);
          const parts = fullTitle.split(/[-–—|·:]/).map(s => s.trim()).filter(s => s.length > 1 && !BAD_TITLE_RE.test(s));
          if (parts.length === 0) return null;
          // Domain match wins (brand name ≈ domain)
          const domMatch = parts.find(p => {
            const clean = p.replace(/\s+/g, '').toLowerCase();
            return clean === compDomainBase || compDomainBase.includes(clean) || clean.includes(compDomainBase);
          });
          if (domMatch) return domMatch;
          // Shortest non-generic part (brands are concise, taglines are long)
          return [...parts].sort((a, b) => a.length - b.length)[0];
        };

        try {
          // Step 1: try the exact URL provided (captures section context when it's a subpage)
          const res = await axios.get(normalized, {
            timeout: 60_000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
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
              timeout: 60_000,
              headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
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
  // Skip for very low-visibility sites: DFS organic competitors for a site with 3 keywords
  // will be giant domains (HubSpot, Forbes) that aren't real competitors.
  const seoKeywords = (extraContext as any)?.seoKeywordsTop10 ?? 999;
  const skipDfsOrganic = seoKeywords <= 15;

  const dfsCompetitors: Array<{ name: string; url: string; snippet: string }> = [];
  if (!skipDfsOrganic && dfsOrganicCompetitors && dfsOrganicCompetitors.length > 0) {
    const resolved = await Promise.all(
      dfsOrganicCompetitors.slice(0, 5).map(async (comp) => {
        const normalized = `https://${comp.domain}`;
        try {
          const res = await axios.get(normalized, {
            timeout: 60_000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
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

  const brandName = crawl.companyName || crawl.title?.split(/[-|]/)[0]?.trim() || domain;
  const description = crawl.description?.slice(0, 200) || '';
  const locationHint = crawl.locationHint || '';
  const bt = extraContext?.businessType || '';
  const igBio = extraContext?.instagramBio || '';
  const gbpCats = extraContext?.gbpCategories?.join(', ') || '';

  // Build business profile for the LLM
  const seoTraffic = (extraContext as any)?.seoTraffic ?? 0;
  const sizeHint = seoKeywords <= 10 ? 'very small (freelance/startup level, almost no organic presence)'
    : seoKeywords <= 50 ? 'small (small business, early online presence)'
    : seoKeywords <= 200 ? 'medium (established SME)'
    : 'large (significant online presence)';

  const businessProfile = [
    `Domain: ${domain}`,
    `Brand: ${brandName}`,
    `Sector: ${sector}`,
    description && `Description: ${description}`,
    bt && `Business type: ${bt}`,
    `Online size: ${sizeHint} (${seoKeywords} keywords, ~${seoTraffic} monthly organic visits)`,
    igBio && `Instagram bio: ${igBio}`,
    gbpCats && `Google Business categories: ${gbpCats}`,
    locationHint && `Location: ${locationHint}`,
  ].filter(Boolean).join('\n');

  const prompt = `You are an expert competitive analyst. Identify 3-4 REAL competitors for this specific business.

${businessProfile}

BUSINESS MODEL ANALYSIS (do this BEFORE choosing competitors):
Think step by step:
1. What does this business ACTUALLY sell? (products vs services, physical vs digital)
2. WHO are their customers? (B2B vs B2C, businesses vs consumers, local vs national)
3. What is their distribution channel? (wholesale, retail, online, horeca, etc.)
4. What is their geographic scope? (local city, regional, national, international)

THEN find competitors that match ALL 4 dimensions:
- Same product/service category (fruit wholesaler ≠ supermarket ≠ food manufacturer)
- Same customer type (B2B wholesaler ≠ B2C retailer)
- Same distribution model (wholesale ≠ retail ≠ e-commerce)
- Same geographic market (local Madrid ≠ national chain)

SIZE MATCHING (critical):
- Match the business SIZE. A freelance consultant is NOT competing with McKinsey or BCG.
- A personal trainer is NOT competing with a gym chain.
- A small local shop is NOT competing with Amazon.
- Find competitors of SIMILAR scale: similar traffic, similar team size, similar market scope.
- Max 1 "aspirational" competitor (slightly bigger, not 1000x bigger).

EXAMPLES OF WRONG vs RIGHT:
- Freelance advisor → WRONG: McKinsey, BCG, Deloitte → RIGHT: other independent advisors/consultants
- Personal trainer → WRONG: Basic-Fit, McFit → RIGHT: other personal trainers in same city
- Small SaaS → WRONG: Salesforce, HubSpot → RIGHT: other small SaaS tools in same niche
- Fruit wholesaler → WRONG: Mercadona (supermarket), Campofrío (manufacturer) → RIGHT: other fruit wholesalers in same city
- Boutique law firm → WRONG: Garrigues (Big4) → RIGHT: other boutique firms of similar size
- Local restaurant → WRONG: McDonald's → RIGHT: other restaurants in same neighborhood/cuisine

EXCLUDED CATEGORIES (NEVER return these as competitors):
- Government websites (.gob.es, .gov.*, agenciatributaria, seg-social, hacienda)
- Legal databases (iberley, noticias.juridicas, aranzadi, vlex, tirantonline)
- Educational institutions (.edu, .edu.es, universities)
- News/media sites (newspapers, TV channels)
- Wikipedia, YouTube, social networks
- Generic aggregators (infojobs, indeed, idealista)

Reply ONLY with valid JSON (no markdown, no backticks, start with {):
{"competitors": [{"name": "Company Name", "url": "https://exactdomain.com", "snippet": "One sentence why they compete directly", "type": "direct"}]}

"type": "direct" (same niche, similar size) or "aspirational" (larger reference, max 1).

RULES:
1. Only include companies whose EXACT website URL you know with 100% certainty.
2. **"name" must be the REAL BRAND NAME**, exactly as the company calls itself — NEVER a sector description.
   WRONG: {"name": "Promotora inmobiliaria de obra nueva", "url": "https://aedashomes.com"}
   RIGHT: {"name": "Aedas Homes", "url": "https://aedashomes.com"}
   WRONG: {"name": "Consultora de growth marketing", "url": "https://growthtribe.io"}
   RIGHT: {"name": "Growth Tribe", "url": "https://growthtribe.io"}
   If you don't know the exact brand name for a URL, DO NOT include that competitor. Return fewer competitors rather than making up generic descriptions.
3. Competitors MUST operate in the SAME business model and serve the SAME customer type.
4. Competitors should have a real website with some online presence.
5. Max 1 "aspirational" competitor. At least 2 must be "direct".
6. Do not include ${domain} itself.
7. Better to return 2 verified competitors than 4 guessed ones.`;

  // Use Sonnet for better sector understanding and competitor relevance
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
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

  // Filter and normalize — don't DROP entries with generic names (that would
  // lose a valid competitor URL). Instead, replace the name with one derived
  // from the domain. This recovers from cases like Sonnet returning
  // name="Promotora inmobiliaria de obra nueva", url="https://aedashomes.com"
  // → name becomes "Aedashomes".
  const rawList = validated.competitors
    .filter((c: any) => !c.url.includes(domain))
    .slice(0, 5)
    .map((c: any) => {
      const rawName = (c.name || '').trim();
      const isGeneric = GENERIC_NAME_RE.test(rawName) || looksLikeDescription(rawName);
      const name = isGeneric ? domainToBrandName(c.url) : rawName;
      if (isGeneric) {
        console.log(`[competitors] Rewrote generic name "${rawName}" → "${name}" (from ${c.url})`);
      }
      return {
        name: name.slice(0, 80),
        url: c.url.slice(0, 120),
        snippet: (c.snippet || '').slice(0, 150),
      };
    });

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
