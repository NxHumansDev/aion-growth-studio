/**
 * Health score for the informe visual layout.
 *
 * IMPORTANT: this no longer computes its own scores. Every value is DERIVED
 * from score.breakdown (the pipeline's single source of truth). This ensures
 * the donut, bento grid, chapter headers and Growth Agent all cite the same
 * numbers. The only "new" value is competitividad, which is a relative
 * comparison metric that doesn't exist in the pipeline score.
 */

export interface HealthScore {
  total: number;                // = score.total (pipeline)
  visibilidad: number;          // derived: SEO weighted + GEO weighted
  competitividad: number | null; // relative to competitors (visual only, not in pipeline score)
  experiencia: number;          // derived: Web weighted + Reputation weighted
  conversion: number;           // = breakdown.conversion directly
}

export function computeHealthScore(results: Record<string, any>): HealthScore {
  const breakdown = results.score?.breakdown || {};
  const seo = results.seo;
  const ctItems: any[] = results.competitor_traffic?.items || [];

  // Pipeline score is the global truth
  const total = results.score?.total ?? 0;

  // ── VISIBILIDAD — derived from SEO (65%) + GEO (35%) ─────────
  const seoScore = breakdown.seo ?? 0;
  const geoScore = breakdown.geo ?? 0;
  const visibilidad = Math.round(seoScore * 0.65 + geoScore * 0.35);

  // ── COMPETITIVIDAD — relative comparison (visual only) ────────
  // This is the only value NOT in score.breakdown because it measures
  // the client's position RELATIVE to competitors, not absolute quality.
  let competitividad: number | null = null;

  if (seo && !seo.skipped && ctItems.length > 0) {
    const withData = ctItems.filter(
      (c: any) => !c.apiError && (c.keywordsTop10 != null || c.organicTrafficEstimate != null)
    );
    if (withData.length > 0) {
      const avgETV = withData.reduce((s: number, c: any) => s + (c.organicTrafficEstimate || 0), 0) / withData.length;
      const avgKW  = withData.reduce((s: number, c: any) => s + (c.keywordsTop10 || 0), 0) / withData.length;
      const etvRatio = avgETV > 0 ? Math.min(2, (seo.organicTrafficEstimate || 0) / avgETV) : 0;
      const kwRatio  = avgKW  > 0 ? Math.min(2, (seo.keywordsTop10 || 0) / avgKW) : 0;
      competitividad = Math.min(100, Math.round(((etvRatio + kwRatio) / 2) * 50));
      if ((seo.keywordsTop10 ?? 0) < 200 && competitividad > 80) {
        competitividad = 80;
      }
    }
  }

  // ── EXPERIENCIA — derived from Web (70%) + Reputation (30%) ───
  const webScore = breakdown.web ?? 0;
  const repScore = breakdown.reputation ?? 0;
  const experiencia = Math.round(webScore * 0.70 + repScore * 0.30);

  // ── CONVERSIÓN — directly from pipeline ───────────────────────
  const conversion = breakdown.conversion ?? 0;

  return { total, visibilidad, competitividad, experiencia, conversion };
}

export function scoreColor(score: number): string {
  if (score >= 70) return '#10B981';
  if (score >= 40) return '#F59E0B';
  return '#EF4444';
}

export function scoreLabel(score: number): string {
  if (score >= 85) return 'Líder digital';
  if (score >= 70) return 'Competitivo';
  if (score >= 50) return 'En desarrollo';
  if (score >= 30) return 'Básico';
  return 'Crítico';
}

export function scoreEmoji(score: number): string {
  if (score >= 70) return '🟢';
  if (score >= 40) return '🟡';
  return '🔴';
}
