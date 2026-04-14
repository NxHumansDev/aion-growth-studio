import type { SectorResult, CrawlResult } from '../types';

const API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

const VALID_PROFILES = [
  'freelance',
  'professional-services',
  'saas',
  'ecommerce',
  'local-single',
  'local-chain',
  'media-education',
  'nonprofit-institutional',
] as const;
const VALID_SCOPES = ['local', 'national', 'regional-multi', 'global'] as const;

export async function runSector(url: string, crawl: CrawlResult): Promise<SectorResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const prompt = `Analyze this website. Classify it into ONE of 8 business profiles AND infer its geographic scope. Then estimate realistic digital marketing benchmarks.

URL: ${url}
Title: ${crawl.title || 'N/A'}
Meta description: ${crawl.description || 'N/A'}
H1 headings: ${(crawl.h1s || []).join(' | ') || 'N/A'}
Company name (auto-detected): ${crawl.companyName || 'unknown'}
Business type (auto-detected): ${crawl.businessType || 'unknown'}
${crawl.locationHint ? `Location hint: ${crawl.locationHint}` : ''}
${crawl.hreflangAlternates?.length ? `Language alternates (hreflang): ${crawl.hreflangAlternates.map(h => h.hreflang).join(', ')}` : ''}
TLD: ${(() => { try { return new URL(url).hostname.split('.').slice(-1)[0]; } catch { return 'unknown'; } })()}

The 8 BUSINESS PROFILES (choose exactly one):
- freelance: personal brand — 1 person selling their expertise (consultor, abogado, coach, diseñador)
- professional-services: small/mid company selling services B2B (agencia, despacho, consultora)
- saas: software platform, app, digital tool with subscription/freemium
- ecommerce: B2C online store selling products
- local-single: physical business with 1 location (restaurante, clínica, tienda)
- local-chain: chain / franchise / multi-location physical business
- media-education: monetized blog, publisher, online academy, training/formación
- nonprofit-institutional: NGO, foundation, association, institution

The 4 GEOGRAPHIC SCOPES (choose exactly one):
- local: city / district only
- national: single country (default for most Spanish businesses)
- regional-multi: several countries — Europe, LATAM, EMEA
- global: worldwide

SCOPE PISTAS:
- If TLD is .es and all content is in Spanish → national
- If has physical address and no mention of shipping/remote → likely local (if single store) or national
- If multiple languages (es+en+fr...) → regional-multi or global
- If SaaS with English + USD pricing → global
- If .com but only Spanish content → national
- If has "tiendas en..." / "sedes en..." across cities → local-chain national
- If site is a publisher/news → usually national or regional-multi

Respond with ONLY a valid JSON object (no markdown, no explanation):
{
  "sector": "specific sector in Spanish (e.g. 'Servicios Legales', 'E-commerce de moda', 'SaaS B2B', 'Hostelería')",
  "businessProfile": "one of the 8 profiles above",
  "geoScope": "one of the 4 scopes above",
  "confidence": 0.85,
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "rationale": "brief sentence explaining the sector",
  "profileRationale": "brief sentence explaining why this profile + scope (cite pistas used)",
  "benchmarks": {
    "keywordsTop10": {"low": 50, "median": 300, "high": 1500},
    "organicTrafficMonthly": {"low": 2000, "median": 15000, "high": 80000},
    "instagramFollowers": {"low": 500, "median": 3000, "high": 15000},
    "linkedinFollowers": {"low": 200, "median": 1500, "high": 8000}
  }
}

Benchmark rules:
- Numbers must reflect the chosen profile + geoScope combination
- "low" = bottom 25% of established players (not startups)
- "median" = typical well-established example
- "high" = top 25% / sector leader in that geoScope`;

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
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const parsed = JSON.parse(match[0]);

    // Validate enums — fall back to safe defaults if the classifier drifts
    if (!VALID_PROFILES.includes(parsed.businessProfile)) {
      parsed.businessProfile = 'professional-services';
      parsed.confidence = Math.min(parsed.confidence ?? 0.5, 0.5);
    }
    if (!VALID_SCOPES.includes(parsed.geoScope)) {
      parsed.geoScope = 'national';
    }

    return parsed;
  } catch (err: any) {
    return {
      sector: 'Business Services',
      businessProfile: 'professional-services',
      geoScope: 'national',
      confidence: 0.3,
      keywords: [],
      rationale: 'Could not detect sector automatically',
      profileRationale: 'Fallback — classifier error',
      error: err.message?.slice(0, 100),
    };
  }
}
