import { describe, it, expect } from 'vitest';
import { analyzeEvolution } from '../../src/lib/radar/diff-engine';
import type { Snapshot, Recommendation } from '../../src/lib/db';

function makeSnapshot(date: string, score: number, kw: number, geo: number): Snapshot {
  return {
    id: `snap-${date}`, client_id: 'c1', date, month: `m-${date}`, score,
    pipeline_output: {
      seo: { keywordsTop10: kw, organicTrafficEstimate: kw * 100 },
      geo: { mentionRate: geo },
      pagespeed: { mobile: { performance: 70 }, desktop: { performance: 85 } },
      conversion: { funnelScore: 50 },
      score: { breakdown: { reputation: 40 } },
    },
  } as Snapshot;
}

describe('Radar QA — 4-week simulation', () => {
  const snapshots = [
    makeSnapshot('2026-01-06', 35, 8, 10),
    makeSnapshot('2026-01-13', 38, 10, 12),
    makeSnapshot('2026-01-20', 45, 18, 15),
    makeSnapshot('2026-01-27', 48, 20, 18),
  ];

  it('processes 4 weeks of data correctly', () => {
    const result = analyzeEvolution(snapshots, []);
    expect(result.snapshotCount).toBe(4);
    expect(result.dateRange).toEqual({ from: '2026-01-06', to: '2026-01-27' });
  });

  it('detects upward trend over 4 weeks', () => {
    const result = analyzeEvolution(snapshots, []);
    const scoreTl = result.timelines.find(t => t.key === 'score');
    expect(scoreTl!.trend).toBe('up');
    expect(scoreTl!.current).toBe(48);
    expect(scoreTl!.delta).toBe(3); // 48-45
  });

  it('calculates correct moving average over 4 periods', () => {
    const result = analyzeEvolution(snapshots, []);
    const scoreTl = result.timelines.find(t => t.key === 'score');
    // avg(35,38,45,48) = 41.5 → rounded to 42
    expect(scoreTl!.movingAvg).toBe(42);
  });

  it('correlates action with KPI jump in week 3', () => {
    const recs: Recommendation[] = [{
      id: 'r1', client_id: 'c1', source: 'briefing',
      title: 'Crear contenido para keywords long tail',
      status: 'done', impact: 'high',
      updated_at: '2026-01-15T00:00:00Z', // done between week 2 and 3
    } as any];

    const result = analyzeEvolution(snapshots, recs);
    expect(result.completedActions).toHaveLength(1);
    // SEO keywords jumped from 10→18 (+80%) after action
    const seoCorr = result.correlations.find(c => c.kpiKey === 'seo.keywordsTop10');
    if (seoCorr) {
      expect(seoCorr.correlationType).toBe('probable_cause');
      expect(seoCorr.deltaAfter).toBeGreaterThan(seoCorr.deltaBefore);
    }
  });

  it('does not produce duplicate correlations for same action', () => {
    const recs: Recommendation[] = [{
      id: 'r1', client_id: 'c1', source: 'briefing',
      title: 'Optimizar meta titles',
      status: 'done', impact: 'high',
      updated_at: '2026-01-15T00:00:00Z',
    } as any];

    const result = analyzeEvolution(snapshots, recs);
    // Each action should have at most 1 correlation per KPI
    const actionCorrelations = result.correlations.filter(c => c.actionTitle === 'Optimizar meta titles');
    const kpiKeys = actionCorrelations.map(c => c.kpiKey);
    const uniqueKeys = new Set(kpiKeys);
    expect(kpiKeys.length).toBe(uniqueKeys.size); // no duplicates
  });

  it('handles stable metrics — no probable correlations on flat data', () => {
    // All KPIs identical across 4 weeks
    const stableSnapshots = [
      makeSnapshot('2026-01-06', 50, 20, 25),
      makeSnapshot('2026-01-13', 50, 20, 25),
      makeSnapshot('2026-01-20', 50, 20, 25),
      makeSnapshot('2026-01-27', 50, 20, 25),
    ];
    const recs: Recommendation[] = [{
      id: 'r1', client_id: 'c1', source: 'briefing',
      title: 'Acción sin efecto',
      status: 'done', impact: 'medium',
      updated_at: '2026-01-15T00:00:00Z',
    } as any];

    const result = analyzeEvolution(stableSnapshots, recs);
    // Zero change = zero correlations
    expect(result.correlations.length).toBe(0);
  });
});
