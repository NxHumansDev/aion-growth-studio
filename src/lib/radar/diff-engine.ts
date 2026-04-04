import type { Snapshot, Recommendation } from '../db';

// ─── KPI Extraction ──────────────────────────────────────────────────────────

export interface KPIPoint {
  date: string;
  value: number;
}

export interface KPITimeline {
  key: string;
  label: string;
  category: 'seo' | 'geo' | 'web' | 'conversion' | 'reputation' | 'overall';
  points: KPIPoint[];
  current: number;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
  trend: 'up' | 'down' | 'stable';
  movingAvg: number;
  acceleration: 'accelerating' | 'decelerating' | 'steady';
}

function extractKPI(snapshot: Snapshot, key: string): number {
  const r = snapshot.pipeline_output || {};
  switch (key) {
    case 'score': return snapshot.score || 0;
    case 'seo.keywordsTop10': return r.seo?.keywordsTop10 || 0;
    case 'seo.traffic': return r.seo?.organicTrafficEstimate || 0;
    case 'seo.domainRank': return r.seo?.domainRank || 0;
    case 'geo.mentionRate': return r.geo?.mentionRate || 0;
    case 'web.mobile': return r.pagespeed?.mobile?.performance || 0;
    case 'web.desktop': return r.pagespeed?.desktop?.performance || 0;
    case 'conversion.score': return r.conversion?.funnelScore || r.conversion?.score || 0;
    case 'reputation.score': return r.score?.breakdown?.reputation || 0;
    default: return 0;
  }
}

const KPI_DEFS: Array<{ key: string; label: string; category: KPITimeline['category'] }> = [
  { key: 'score', label: 'Score Global', category: 'overall' },
  { key: 'seo.keywordsTop10', label: 'Keywords Top 10', category: 'seo' },
  { key: 'seo.traffic', label: 'Tráfico Orgánico', category: 'seo' },
  { key: 'seo.domainRank', label: 'Domain Rank', category: 'seo' },
  { key: 'geo.mentionRate', label: 'Mention Rate IA', category: 'geo' },
  { key: 'web.mobile', label: 'PageSpeed Mobile', category: 'web' },
  { key: 'web.desktop', label: 'PageSpeed Desktop', category: 'web' },
  { key: 'conversion.score', label: 'Funnel Score', category: 'conversion' },
  { key: 'reputation.score', label: 'Reputación', category: 'reputation' },
];

// ─── Trend Analysis ──────────────────────────────────────────────────────────

function movingAverage(values: number[], window: number): number {
  const slice = values.slice(-window);
  if (slice.length === 0) return 0;
  return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
}

function detectTrend(values: number[]): 'up' | 'down' | 'stable' {
  if (values.length < 2) return 'stable';
  const recent = values.slice(-3);
  const diffs = recent.slice(1).map((v, i) => v - recent[i]);
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  if (avgDiff > 1) return 'up';
  if (avgDiff < -1) return 'down';
  return 'stable';
}

function detectAcceleration(values: number[]): 'accelerating' | 'decelerating' | 'steady' {
  if (values.length < 4) return 'steady';
  const recent = values.slice(-4);
  const diffs = recent.slice(1).map((v, i) => v - recent[i]);
  if (diffs.length < 2) return 'steady';
  const lastDiff = diffs[diffs.length - 1];
  const prevDiff = diffs[diffs.length - 2];
  if (lastDiff > prevDiff + 1) return 'accelerating';
  if (lastDiff < prevDiff - 1) return 'decelerating';
  return 'steady';
}

// ─── Action Correlation ──────────────────────────────────────────────────────

export interface ActionCorrelation {
  actionTitle: string;
  actionDate: string;
  kpiKey: string;
  kpiLabel: string;
  deltaBefore: number;
  deltaAfter: number;
  correlationType: 'probable_cause' | 'possible_cause' | 'no_correlation';
  explanation: string;
}

interface CompletedAction {
  title: string;
  completedAt: string;
  source: string;
}

function findCorrelations(
  timelines: KPITimeline[],
  actions: CompletedAction[],
  snapshots: Snapshot[],
): ActionCorrelation[] {
  const correlations: ActionCorrelation[] = [];
  if (actions.length === 0 || snapshots.length < 3) return correlations;

  for (const action of actions) {
    const actionDate = new Date(action.completedAt);

    for (const timeline of timelines) {
      if (timeline.points.length < 3) continue;

      // Find the snapshot index closest to action date
      const actionIdx = snapshots.findIndex(s => new Date(s.date) >= actionDate);
      if (actionIdx < 1 || actionIdx >= snapshots.length - 1) continue;

      // KPI values before and after action (1-3 week window)
      const beforeValues = timeline.points.slice(Math.max(0, actionIdx - 2), actionIdx).map(p => p.value);
      const afterValues = timeline.points.slice(actionIdx, Math.min(timeline.points.length, actionIdx + 3)).map(p => p.value);

      if (beforeValues.length === 0 || afterValues.length === 0) continue;

      const avgBefore = beforeValues.reduce((a, b) => a + b, 0) / beforeValues.length;
      const avgAfter = afterValues.reduce((a, b) => a + b, 0) / afterValues.length;
      const delta = avgAfter - avgBefore;
      const deltaPct = avgBefore > 0 ? Math.round((delta / avgBefore) * 100) : 0;

      // Significance threshold: >5% change or >3 absolute points
      if (Math.abs(deltaPct) < 5 && Math.abs(delta) < 3) continue;

      const isPositive = delta > 0;
      let correlationType: ActionCorrelation['correlationType'] = 'no_correlation';
      let explanation = '';

      if (Math.abs(deltaPct) >= 15 || Math.abs(delta) >= 10) {
        correlationType = 'probable_cause';
        explanation = isPositive
          ? `${timeline.label} subió ${Math.abs(deltaPct)}% tras ejecutar "${action.title}"`
          : `${timeline.label} bajó ${Math.abs(deltaPct)}% tras ejecutar "${action.title}"`;
      } else if (Math.abs(deltaPct) >= 5) {
        correlationType = 'possible_cause';
        explanation = isPositive
          ? `${timeline.label} mejoró ligeramente (+${Math.abs(deltaPct)}%) — posible efecto de "${action.title}"`
          : `${timeline.label} empeoró ligeramente (${deltaPct}%) tras "${action.title}"`;
      }

      if (correlationType !== 'no_correlation') {
        correlations.push({
          actionTitle: action.title,
          actionDate: action.completedAt,
          kpiKey: timeline.key,
          kpiLabel: timeline.label,
          deltaBefore: Math.round(avgBefore),
          deltaAfter: Math.round(avgAfter),
          correlationType,
          explanation,
        });
      }
    }
  }

  // Sort: probable first, then by delta magnitude
  return correlations.sort((a, b) => {
    if (a.correlationType !== b.correlationType) {
      return a.correlationType === 'probable_cause' ? -1 : 1;
    }
    return Math.abs(b.deltaAfter - b.deltaBefore) - Math.abs(a.deltaAfter - a.deltaBefore);
  });
}

// ─── Main Diff Engine ────────────────────────────────────────────────────────

export interface DiffResult {
  timelines: KPITimeline[];
  correlations: ActionCorrelation[];
  completedActions: CompletedAction[];
  snapshotCount: number;
  dateRange: { from: string; to: string } | null;
}

export function analyzeEvolution(
  snapshots: Snapshot[],
  recommendations: Recommendation[],
): DiffResult {
  if (snapshots.length === 0) {
    return { timelines: [], correlations: [], completedActions: [], snapshotCount: 0, dateRange: null };
  }

  // Build KPI timelines
  const timelines: KPITimeline[] = KPI_DEFS.map(def => {
    const points = snapshots.map(s => ({
      date: s.date,
      value: extractKPI(s, def.key),
    }));
    const values = points.map(p => p.value);
    const current = values[values.length - 1] || 0;
    const previous = values.length >= 2 ? values[values.length - 2] : null;

    return {
      key: def.key,
      label: def.label,
      category: def.category,
      points,
      current,
      previous,
      delta: previous !== null ? current - previous : null,
      deltaPct: previous !== null && previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
      trend: detectTrend(values),
      movingAvg: movingAverage(values, 4),
      acceleration: detectAcceleration(values),
    };
  });

  // Extract completed actions with timestamps
  const completedActions: CompletedAction[] = recommendations
    .filter(r => r.status === 'done' && r.updated_at)
    .map(r => ({
      title: r.title,
      completedAt: (r as any).updated_at,
      source: r.source,
    }))
    .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());

  // Find correlations between actions and KPI changes
  const correlations = findCorrelations(timelines, completedActions, snapshots);

  return {
    timelines,
    correlations,
    completedActions,
    snapshotCount: snapshots.length,
    dateRange: {
      from: snapshots[0].date,
      to: snapshots[snapshots.length - 1].date,
    },
  };
}
