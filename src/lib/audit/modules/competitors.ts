import axios from 'axios';
import * as cheerio from 'cheerio';
import type { CompetitorsResult, CrawlResult } from '../types';

const ANTHROPIC_KEY = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

export async function runCompetitors(
  url: string,
  sector: string,
  crawl: CrawlResult = {},
  userCompetitorUrls?: string[],
): Promise<CompetitorsResult> {
  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');

  // If user selected competitors, fetch their names and use them directly
  if (userCompetitorUrls && userCompetitorUrls.length > 0) {
    const competitors = await Promise.all(
      userCompetitorUrls.slice(0, 5).map(async (compUrl) => {
        const normalized = compUrl.startsWith('http') ? compUrl : `https://${compUrl}`;
        const compDomain = new URL(normalized).hostname.replace(/^www\./, '');
        try {
          const res = await axios.get(normalized, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
            validateStatus: (s) => s < 500,
          });
          const $ = cheerio.load(res.data as string);
          const name = $('title').first().text().split(/[-|]/)[0].trim().slice(0, 80) || compDomain;
          return { name, url: compUrl, snippet: 'Competidor seleccionado' };
        } catch {
          return { name: compDomain, url: compUrl, snippet: 'Competidor seleccionado' };
        }
      }),
    );
    return { competitors };
  }

  // Otherwise: use Claude to detect competitors
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

Reply ONLY with a valid JSON array (no explanation, no markdown):
[{"name": "Company Name", "url": "https://...", "snippet": "One sentence why they compete"}]

Rules:
- Only include real companies with active websites
- Match the business scope (local vs global)
- Do not include ${domain} itself`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return { competitors: [] };

    const parsed = JSON.parse(match[0]);
    const competitors = (parsed as any[])
      .filter((c) => c.url && !c.url.includes(domain))
      .slice(0, 5)
      .map((c) => ({
        name: (c.name || '').slice(0, 80),
        url: (c.url || '').slice(0, 120),
        snippet: (c.snippet || '').slice(0, 150),
      }));

    return { competitors };
  } catch (err: any) {
    return { competitors: [], error: err.message?.slice(0, 100) };
  }
}
