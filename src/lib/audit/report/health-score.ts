export interface HealthScore {
  total: number;                // 0-100 overall health
  visibilidad: number;          // 0-100 — ¿te encuentran?
  competitividad: number | null; // 0-100 — null = sin datos comparativos
  experiencia: number;          // 0-100 — ¿qué pasa cuando llegan?
  conversion: number;           // 0-100 — ¿convierten?
}

export function computeHealthScore(results: Record<string, any>): HealthScore {
  const breakdown = results.score?.breakdown || {};
  const geo = results.geo;
  const seo = results.seo;
  const ctItems: any[] = results.competitor_traffic?.items || [];

  // ── VISIBILIDAD (30%) ─────────────────────────────────────────
  // SEO pillar from existing breakdown + GEO score + organic traffic share
  const seoNorm = breakdown.seoVisibility ?? 0;
  const geoNorm = geo?.overallScore ?? 0;

  const trafficChannels: Record<string, any> = results.traffic?.channels || {};
  const totalVisits = Object.values(trafficChannels).reduce(
    (s: number, c: any) => s + (c.visits || 0), 0
  );
  const organicVisits = trafficChannels.organic?.visits || 0;
  const organicPct = totalVisits > 0 ? (organicVisits / totalVisits) * 100 : 0;
  // 67% organic → 100 pts; 0% organic → 0 pts
  const trafficNorm = Math.min(100, organicPct * 1.5);

  const visibilidad = Math.round(seoNorm * 0.5 + geoNorm * 0.3 + trafficNorm * 0.2);

  // ── COMPETITIVIDAD (25%) ──────────────────────────────────────
  // Ratio of own metrics vs competitor averages
  let competitividad = 50; // neutral default when no competitor data
  if (seo && !seo.skipped && ctItems.length > 0) {
    const avgDR = ctItems.reduce((s: number, c: any) => s + (c.domainRank || 0), 0) / ctItems.length;
    const avgETV = ctItems.reduce((s: number, c: any) => s + (c.organicTrafficEstimate || 0), 0) / ctItems.length;
    const avgKW = ctItems.reduce((s: number, c: any) => s + (c.keywordsTop10 || 0), 0) / ctItems.length;

    // ratio: 1.0 = parity, 2.0 = double → capped at 2.0 → maps to 0-100
    const drRatio = avgDR > 0 ? Math.min(2, (seo.domainRank || 0) / avgDR) : 0;
    const etvRatio = avgETV > 0 ? Math.min(2, (seo.organicTrafficEstimate || 0) / avgETV) : 0;
    const kwRatio = avgKW > 0 ? Math.min(2, (seo.keywordsTop10 || 0) / avgKW) : 0;
    competitividad = Math.min(100, Math.round(((drRatio + etvRatio + kwRatio) / 3) * 50));
  }

  // ── EXPERIENCIA (20%) ─────────────────────────────────────────
  // Technical foundations (PageSpeed, SSL, schema) + measurement/stack
  const technical = breakdown.technical ?? 0;
  const measurement = breakdown.measurement ?? 0;
  const experiencia = Math.round(technical * 0.7 + measurement * 0.3);

  // ── CONVERSIÓN (25%) ─────────────────────────────────────────
  // Funnel score + content quality
  const convScore = breakdown.conversion ?? 0;
  const contentScore = breakdown.content ?? 0;
  const conversion = Math.round(convScore * 0.7 + contentScore * 0.3);

  const total = Math.round(
    visibilidad * 0.30 +
    competitividad * 0.25 +
    experiencia * 0.20 +
    conversion * 0.25
  );

  return { total, visibilidad, competitividad, experiencia, conversion };
}

export function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
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
