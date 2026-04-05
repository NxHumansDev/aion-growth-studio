import { describe, it, expect } from 'vitest';

// Test mapResultsForPlatform directly
const { mapResultsForPlatform } = await import('../../src/lib/api-auth');

describe('mapResultsForPlatform', () => {
  it('maps score breakdown correctly', () => {
    const raw = {
      score: { total: 65, breakdown: { seo: 70, geo: 30, web: 80, conversion: 55, reputation: 40 } },
    };
    const mapped = mapResultsForPlatform(raw);
    expect(mapped.score.total).toBe(65);
    expect(mapped.score.breakdown.seo).toBe(70);
    expect(mapped.score.breakdown.geo).toBe(30);
    expect(mapped.score.breakdown.web).toBe(80);
    expect(mapped.score.breakdown.conversion).toBe(55);
    expect(mapped.score.breakdown.reputation).toBe(40);
  });

  it('maps SEO fields from camelCase to snake_case', () => {
    const raw = {
      seo: {
        domainRank: 45,
        keywordsTop3: 5,
        keywordsTop10: 20,
        keywordsTop30: 50,
        organicTrafficEstimate: 8000,
        referringDomains: 120,
        backlinksTotal: 500,
      },
    };
    const mapped = mapResultsForPlatform(raw);
    expect(mapped.seo.domain_rank).toBe(45);
    expect(mapped.seo.keywords_top10).toBe(20);
    expect(mapped.seo.organic_traffic).toBe(8000);
  });

  it('handles missing data gracefully', () => {
    const mapped = mapResultsForPlatform({});
    expect(mapped.score.total).toBeUndefined();
    expect(mapped.seo.domain_rank).toBeUndefined();
    expect(mapped.ssl.valid).toBeUndefined();
  });
});
