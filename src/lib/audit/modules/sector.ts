import type { SectorResult, CrawlResult } from '../types';

const API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

export async function runSector(url: string, crawl: CrawlResult): Promise<SectorResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const prompt = `Analyze this website and detect its business sector. Then estimate realistic digital marketing benchmarks for a TYPICAL established company in this sector in Spain.

URL: ${url}
Title: ${crawl.title || 'N/A'}
Meta description: ${crawl.description || 'N/A'}
H1 headings: ${(crawl.h1s || []).join(' | ') || 'N/A'}

Respond with ONLY a valid JSON object (no markdown, no explanation):
{
  "sector": "sector name in Spanish (e.g. 'Servicios Legales', 'E-commerce', 'SaaS B2B', 'Hostelería')",
  "confidence": 0.85,
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "rationale": "brief one-sentence explanation",
  "benchmarks": {
    "keywordsTop10": {"low": 50, "median": 300, "high": 1500},
    "organicTrafficMonthly": {"low": 2000, "median": 15000, "high": 80000},
    "domainRank": {"low": 20, "median": 35, "high": 60},
    "instagramFollowers": {"low": 500, "median": 3000, "high": 15000},
    "linkedinFollowers": {"low": 200, "median": 1500, "high": 8000}
  }
}

Benchmark rules:
- Reflect REALISTIC ranges for this specific sector in Spain
- "low" = bottom 25% of established companies (not early-stage startups)
- "median" = score of a typical established company in this sector
- "high" = top 25% / clear sector leader
- For B2B sectors: instagramFollowers can be lower; linkedinFollowers more important
- For local/service businesses: all numbers should be much lower than national brands
- For e-commerce/media: traffic and social benchmarks are much higher
- Consider the geographic scope (local, national, or international)`;

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
        max_tokens: 600,
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
