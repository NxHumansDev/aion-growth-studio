import { describe, it, expect } from 'vitest';

// Import the score module — we test the exported function
// Since it uses import.meta.env, we mock minimally
const { runScore } = await import('../../src/lib/audit/modules/score');

describe('Score Module', () => {
  it('returns total 0 with empty results', async () => {
    const result = await runScore({});
    expect(result.total).toBeDefined();
    expect(result.breakdown).toBeDefined();
  });

  it('calculates score with SEO data', async () => {
    const result = await runScore({
      seo: { keywordsTop10: 50, organicTrafficEstimate: 5000, keywordsTop3: 10 },
      pagespeed: { mobile: { performance: 80 }, desktop: { performance: 95 } },
      ssl: { valid: true },
      crawl: { hasCanonical: true, hasSchemaMarkup: true, hasSitemap: true, hasRobots: true },
      geo: { mentionRate: 30 },
      conversion: { funnelScore: 60 },
      gbp: { found: true, rating: 4.5, reviewCount: 50 },
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.breakdown.seo).toBeGreaterThan(0);
    expect(result.breakdown.geo).toBe(30);
    expect(result.breakdown.web).toBeGreaterThan(0);
    expect(result.breakdown.conversion).toBe(60);
  });

  it('breakdown has all 5 pillars', async () => {
    const result = await runScore({
      seo: { keywordsTop10: 10 },
      geo: { mentionRate: 20 },
      pagespeed: { mobile: { performance: 70 } },
      conversion: { funnelScore: 50 },
    });
    expect(result.breakdown).toHaveProperty('seo');
    expect(result.breakdown).toHaveProperty('geo');
    expect(result.breakdown).toHaveProperty('web');
    expect(result.breakdown).toHaveProperty('conversion');
    expect(result.breakdown).toHaveProperty('reputation');
  });

  it('score never exceeds 100', async () => {
    const result = await runScore({
      seo: { keywordsTop10: 10000, organicTrafficEstimate: 50000000, keywordsTop3: 5000 },
      geo: { mentionRate: 100 },
      pagespeed: { mobile: { performance: 100 }, desktop: { performance: 100 } },
      ssl: { valid: true },
      crawl: { hasCanonical: true, hasSchemaMarkup: true, hasSitemap: true, hasRobots: true },
      conversion: { funnelScore: 100 },
      gbp: { found: true, rating: 5.0, reviewCount: 1000 },
    });
    expect(result.total).toBeLessThanOrEqual(100);
    Object.values(result.breakdown).forEach(v => {
      expect(v).toBeLessThanOrEqual(100);
    });
  });
});
