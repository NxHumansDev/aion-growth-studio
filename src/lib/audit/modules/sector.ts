import type { SectorResult, CrawlResult } from '../types';

const API_KEY = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

export async function runSector(url: string, crawl: CrawlResult): Promise<SectorResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const prompt = `Analyze this website and detect its business sector.

URL: ${url}
Title: ${crawl.title || 'N/A'}
Meta description: ${crawl.description || 'N/A'}
H1 headings: ${(crawl.h1s || []).join(' | ') || 'N/A'}

Respond with ONLY a valid JSON object (no markdown, no explanation):
{
  "sector": "sector name in English (e.g. 'Digital Marketing Agency', 'SaaS B2B', 'E-commerce', 'Consulting')",
  "confidence": 0.85,
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "rationale": "brief one-sentence explanation"
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    return JSON.parse(match[0]);
  } catch (err: any) {
    return {
      sector: 'Business Services',
      confidence: 0.3,
      keywords: [],
      rationale: 'Could not detect sector automatically',
      error: err.message?.slice(0, 100),
    };
  }
}
