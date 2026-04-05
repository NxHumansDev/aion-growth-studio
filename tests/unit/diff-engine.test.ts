import { describe, it, expect } from 'vitest';
import { analyzeEvolution } from '../../src/lib/radar/diff-engine';
import type { Snapshot, Recommendation } from '../../src/lib/db';

function makeSnapshot(date: string, score: number, seoKw: number, geoRate: number, webMobile: number): Snapshot {
  return {
    id: `snap-${date}`,
    client_id: 'test-client',
    date,
    month: `test-${date}`,
    score,
    pipeline_output: {
      seo: { keywordsTop10: seoKw, organicTrafficEstimate: seoKw * 100 },
      geo: { mentionRate: geoRate },
      pagespeed: { mobile: { performance: webMobile }, desktop: { performance: webMobile + 10 } },
      conversion: { funnelScore: 50 },
      score: { breakdown: { reputation: 40 } },
    },
  } as Snapshot;
}

describe('Diff Engine', () => {
  it('returns empty result with no snapshots', () => {
    const result = analyzeEvolution([], []);
    expect(result.timelines).toHaveLength(0);
    expect(result.correlations).toHaveLength(0);
    expect(result.snapshotCount).toBe(0);
  });

  it('builds timelines from snapshots', () => {
    const snapshots = [
      makeSnapshot('2026-01-01', 40, 10, 15, 60),
      makeSnapshot('2026-02-01', 50, 20, 25, 70),
      makeSnapshot('2026-03-01', 60, 30, 35, 80),
    ];
    const result = analyzeEvolution(snapshots, []);

    expect(result.snapshotCount).toBe(3);
    expect(result.timelines.length).toBeGreaterThan(0);

    const scoreTl = result.timelines.find(t => t.key === 'score');
    expect(scoreTl).toBeDefined();
    expect(scoreTl!.current).toBe(60);
    expect(scoreTl!.previous).toBe(50);
    expect(scoreTl!.delta).toBe(10);
    expect(scoreTl!.trend).toBe('up');
  });

  it('detects upward trend', () => {
    const snapshots = [
      makeSnapshot('2026-01-01', 30, 5, 10, 50),
      makeSnapshot('2026-02-01', 40, 15, 20, 60),
      makeSnapshot('2026-03-01', 55, 25, 30, 75),
    ];
    const result = analyzeEvolution(snapshots, []);
    const seoTl = result.timelines.find(t => t.key === 'seo.keywordsTop10');
    expect(seoTl!.trend).toBe('up');
  });

  it('detects downward trend', () => {
    const snapshots = [
      makeSnapshot('2026-01-01', 70, 50, 40, 90),
      makeSnapshot('2026-02-01', 55, 35, 30, 75),
      makeSnapshot('2026-03-01', 40, 20, 20, 60),
    ];
    const result = analyzeEvolution(snapshots, []);
    const scoreTl = result.timelines.find(t => t.key === 'score');
    expect(scoreTl!.trend).toBe('down');
  });

  it('calculates moving average', () => {
    const snapshots = [
      makeSnapshot('2026-01-01', 40, 10, 10, 60),
      makeSnapshot('2026-02-01', 50, 20, 20, 70),
      makeSnapshot('2026-03-01', 60, 30, 30, 80),
      makeSnapshot('2026-04-01', 70, 40, 40, 90),
    ];
    const result = analyzeEvolution(snapshots, []);
    const scoreTl = result.timelines.find(t => t.key === 'score');
    // Moving avg of [40,50,60,70] = 55
    expect(scoreTl!.movingAvg).toBe(55);
  });

  it('finds correlations between actions and KPI changes', () => {
    const snapshots = [
      makeSnapshot('2026-01-01', 30, 5, 10, 50),
      makeSnapshot('2026-02-01', 35, 8, 12, 55),
      makeSnapshot('2026-03-01', 55, 25, 20, 70),  // big jump after action
      makeSnapshot('2026-04-01', 60, 28, 22, 75),
    ];
    const recs: Recommendation[] = [
      {
        id: 'rec-1',
        client_id: 'test-client',
        source: 'briefing',
        title: 'Optimizar meta titles y descriptions',
        status: 'done',
        impact: 'high',
        updated_at: '2026-02-15T00:00:00Z',  // done between snapshot 2 and 3
      } as any,
    ];
    const result = analyzeEvolution(snapshots, recs);
    expect(result.completedActions).toHaveLength(1);
    expect(result.correlations.length).toBeGreaterThan(0);

    const seoCorrelation = result.correlations.find(c => c.kpiKey === 'seo.keywordsTop10');
    if (seoCorrelation) {
      expect(seoCorrelation.correlationType).toBe('probable_cause');
    }
  });

  it('does not find correlations when no actions completed', () => {
    const snapshots = [
      makeSnapshot('2026-01-01', 30, 5, 10, 50),
      makeSnapshot('2026-02-01', 50, 20, 25, 70),
      makeSnapshot('2026-03-01', 55, 25, 30, 75),
    ];
    const result = analyzeEvolution(snapshots, []);
    expect(result.correlations).toHaveLength(0);
    expect(result.completedActions).toHaveLength(0);
  });

  it('provides date range', () => {
    const snapshots = [
      makeSnapshot('2026-01-01', 40, 10, 15, 60),
      makeSnapshot('2026-03-01', 60, 30, 35, 80),
    ];
    const result = analyzeEvolution(snapshots, []);
    expect(result.dateRange).toEqual({ from: '2026-01-01', to: '2026-03-01' });
  });
});
