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
  // null = datos insuficientes — nunca mostrar un número inventado
  let competitividad: number | null = null;

  if (seo && !seo.skipped && ctItems.length > 0) {
    const anyHasData = ctItems.some(
      (c: any) => c.organicTrafficEstimate != null || c.keywordsTop10 != null
    );
    if (anyHasData) {
      const avgETV = ctItems.reduce((s: number, c: any) => s + (c.organicTrafficEstimate || 0), 0) / ctItems.length;
      const avgKW  = ctItems.reduce((s: number, c: any) => s + (c.keywordsTop10 || 0), 0) / ctItems.length;
      // ratio: 1.0 = parity, 2.0 = double → capped at 2.0 → maps to 0-100
      const etvRatio = avgETV > 0 ? Math.min(2, (seo.organicTrafficEstimate || 0) / avgETV) : 0;
      const kwRatio  = avgKW  > 0 ? Math.min(2, (seo.keywordsTop10 || 0) / avgKW) : 0;
      competitividad = Math.min(100, Math.round(((etvRatio + kwRatio) / 2) * 50));
    }
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

  // Redistribute weights proportionally if competitividad is null
  const pillars = [
    { value: visibilidad,    weight: 0.30 },
    { value: competitividad, weight: 0.25 },
    { value: experiencia,    weight: 0.20 },
    { value: conversion,     weight: 0.25 },
  ];
  const active = pillars.filter((p) => p.value !== null) as { value: number; weight: number }[];
  const totalWeight = active.reduce((s, p) => s + p.weight, 0);
  const total = totalWeight > 0
    ? Math.round(active.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight)
    : 0;

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
