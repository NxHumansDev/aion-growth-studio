import { describe, it, expect } from 'vitest';
import { getContentWeights, blogScore, instagramScore, linkedinScore, computeContentScore } from '../../src/lib/audit/content-score';

describe('Content Weights by Sector', () => {
  it('B2B software → blog + LinkedIn heavy', () => {
    const w = getContentWeights('Software B2B', 'generate_leads');
    expect(w.businessType).toBe('b2b');
    expect(w.blog).toBeGreaterThanOrEqual(0.4);
    expect(w.linkedin).toBeGreaterThanOrEqual(0.4);
    expect(w.instagram).toBeLessThanOrEqual(0.15);
  });

  it('B2C restaurant → Instagram heavy', () => {
    const w = getContentWeights('Restaurante', 'local_traffic');
    expect(w.businessType).toBe('b2c_local');
    expect(w.instagram).toBeGreaterThanOrEqual(0.5);
  });

  it('Ecommerce → Instagram + blog', () => {
    const w = getContentWeights('Tienda online de moda', 'sell_online');
    expect(w.businessType).toBe('ecommerce');
    expect(w.instagram).toBeGreaterThanOrEqual(0.45);
  });

  it('Unknown sector → mixed defaults', () => {
    const w = getContentWeights();
    expect(w.businessType).toBe('mixed');
    expect(w.blog + w.instagram + w.linkedin).toBeCloseTo(1, 1);
  });

  it('Distribucion frutas B2B → B2C (food)', () => {
    const w = getContentWeights('Distribución y Comercialización de Frutas y Verduras B2B');
    expect(w.businessType).toBe('b2c');
    expect(w.instagram).toBeGreaterThanOrEqual(0.5);
  });
});

describe('Blog Score', () => {
  it('active blog → high score', () => {
    expect(blogScore({ postsLast90Days: 10, lastPostDate: new Date().toISOString() })).toBeGreaterThanOrEqual(85);
  });

  it('no blog → low score', () => {
    expect(blogScore({ postsLast90Days: 0 })).toBeLessThanOrEqual(10);
  });

  it('stale blog penalized', () => {
    const active = blogScore({ postsLast90Days: 4, daysSinceLastPost: 5 });
    const stale = blogScore({ postsLast90Days: 4, daysSinceLastPost: 45 });
    expect(active).toBeGreaterThan(stale);
  });
});

describe('Instagram Score', () => {
  it('not found → 0', () => {
    expect(instagramScore({ found: false })).toBe(0);
  });

  it('high engagement → high score', () => {
    const score = instagramScore({ found: true, postsLast90Days: 8, engagementRate: 4.5 });
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('followers only (no post data) → moderate', () => {
    const score = instagramScore({ found: true, followers: 15000 });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(70);
  });
});

describe('Composite Score', () => {
  it('all channels active → high score', () => {
    const result = computeContentScore(
      { postsLast90Days: 8, lastPostDate: new Date().toISOString() },
      { found: true, postsLast90Days: 10, engagementRate: 3.5, followers: 5000 },
      { found: true, followers: 3000 },
      'Software B2B',
    );
    expect(result.total).toBeGreaterThanOrEqual(60);
    expect(result.breakdown).toContain('Blog');
  });

  it('no IG no LI → blog only, weight redistributed', () => {
    const result = computeContentScore(
      { postsLast90Days: 6 },
      { found: false },
      { found: false },
    );
    expect(result.weights.blog).toBe(1);
    expect(result.weights.instagram).toBe(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it('no IG → weight redistributed to blog + LI', () => {
    const result = computeContentScore(
      { postsLast90Days: 4 },
      { found: false },
      { found: true, followers: 2000 },
      'Consultoría',
    );
    expect(result.weights.instagram).toBe(0);
    expect(result.weights.blog + result.weights.linkedin).toBeCloseTo(1, 1);
  });
});
