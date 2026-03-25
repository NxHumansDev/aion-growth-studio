import axios from 'axios';
import * as cheerio from 'cheerio';
import type { CompetitorsResult, CrawlResult } from '../types';
import { callHaikuWithValidation } from '../llm-utils';

const ANTHROPIC_KEY = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

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

  // If all fail validation (network issue etc.), fall back to unvalidated list
  return valid.length > 0 ? valid : competitors;
}

export async function runCompetitors(
  url: string,
  sector: string,
  crawl: CrawlResult = {},
  userCompetitorUrls?: string[],
): Promise<CompetitorsResult> {
  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');

  // Titles that indicate the page wasn't the real site (Cloudflare challenge, 404, etc.)
  const BAD_TITLE_RE = /^(just a moment|attention required|403|404|400|500|error|access denied|not found|forbidden|please wait|one moment|verifying|checking your browser|ddos protection|enable javascript|page not found|redirecting|site not found|domain for sale|coming soon|parked)/i;

  // If user selected competitors, fetch their names and use them directly
  if (userCompetitorUrls && userCompetitorUrls.length > 0) {
    const competitors = await Promise.all(
      userCompetitorUrls.slice(0, 5).map(async (compUrl) => {
        const normalized = compUrl.startsWith('http') ? compUrl : `https://${compUrl}`;
        const compDomain = new URL(normalized).hostname.replace(/^www\./, '');
        try {
          const res = await axios.get(normalized, {
            timeout: 6000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
            validateStatus: (s) => s < 500,
          });
          const $ = cheerio.load(res.data as string);
          const rawTitle = $('title').first().text().split(/[-|·—]/)[0].trim().slice(0, 80);
          // Reject generic error/challenge page titles — fall back to domain
          const name = (rawTitle && !BAD_TITLE_RE.test(rawTitle)) ? rawTitle : compDomain;
          return { name, url: compUrl, snippet: 'Competidor seleccionado' };
        } catch {
          return { name: compDomain, url: compUrl, snippet: 'Competidor seleccionado' };
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

  const prompt = `Identify 4-5 direct competitors for this business.

Domain: ${domain}
Brand: ${brandName}
Sector: ${sector}
Description: ${description}

Reply ONLY with a valid JSON object (no explanation, no markdown):
{"competitors": [{"name": "Company Name", "url": "https://...", "snippet": "One sentence why they compete"}]}

Rules:
- Only include real companies with active websites
- Match the business scope (local vs global)
- Do not include ${domain} itself
- URL must be a real, valid domain you are confident exists`;

  const validated = await callHaikuWithValidation('competitors', prompt, 15000, 2);

  if (!validated) {
    return { competitors: [], error: 'LLM failed to produce valid competitors' };
  }

  // Filter and normalize
  const rawList = validated.competitors
    .filter((c) => !c.url.includes(domain))
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
