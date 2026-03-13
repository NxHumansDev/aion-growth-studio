import type { HealthScore } from './health-score';

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(n);
}

// ── Health summary ────────────────────────────────────────────────
export function diagnosisHealthSummary(score: HealthScore): string {
  const t = score.total;
  if (t >= 70) {
    return 'Tu presencia digital es sólida. Las oportunidades están en optimización fina y expansión de canales.';
  }
  if (t >= 50) {
    return 'Tienes fundamentos pero pierdes terreno frente a competidores más activos. Hay oportunidades claras de mejora en visibilidad y captación.';
  }
  if (t >= 30) {
    return 'Tu presencia digital tiene bases técnicas aceptables pero déficits significativos en visibilidad y posicionamiento. Estás perdiendo oportunidades de captación cada día.';
  }
  return 'Tu presencia digital necesita atención urgente. Competidores están captando demanda que debería ser tuya. Hay acciones de alto impacto disponibles a corto plazo.';
}

// ── SEO ───────────────────────────────────────────────────────────
export function diagnosisSEO(seo: any, ctItems: any[]): string {
  if (!seo || seo.skipped) {
    return 'No se pudieron obtener datos de posicionamiento orgánico para este dominio.';
  }
  const kw = fmt(seo.keywordsTop10);
  const etv = fmt(seo.organicTrafficEstimate);
  const dr = seo.domainRank ?? 0;

  let base = `Rankeas en ${kw} keywords dentro del top 10 de Google, generando aproximadamente ${etv} visitas orgánicas al mes.`;

  if (ctItems.length > 0) {
    const avgKW = ctItems.reduce((s: number, c: any) => s + (c.keywordsTop10 || 0), 0) / ctItems.length;
    const avgDR = ctItems.reduce((s: number, c: any) => s + (c.domainRank || 0), 0) / ctItems.length;
    const capturePct = avgKW > 0 ? Math.round(((seo.keywordsTop10 || 0) / avgKW) * 100) : null;
    const drDiff = Math.round(avgDR - dr);

    if (capturePct !== null) {
      base += ` Comparado con la media de tus competidores (${fmt(Math.round(avgKW))} keywords top 10), capturas el ${capturePct}% de la demanda orgánica del sector.`;
    }
    if (drDiff > 5) {
      base += ` Tu Domain Rank (${dr}) está ${drDiff} puntos por debajo de la media competidora (${Math.round(avgDR)}), lo que limita tu autoridad frente a Google.`;
    } else if (drDiff < -5) {
      base += ` Tu Domain Rank (${dr}) supera la media del sector (${Math.round(avgDR)}), lo que es una ventaja de autoridad clara.`;
    }
  }
  return base;
}

// ── GEO / AI Visibility ───────────────────────────────────────────
export function diagnosisGEO(geo: any): string {
  if (!geo || geo.skipped) {
    return 'No se pudo evaluar la visibilidad en motores de IA (ChatGPT, Perplexity) para este dominio.';
  }
  const queries: any[] = geo.queries || [];
  const total = queries.length;
  const mentioned = queries.filter((q: any) => q.mentioned).length;
  const pct = total > 0 ? Math.round(((total - mentioned) / total) * 100) : 0;

  let msg = `Tu marca aparece en ${mentioned} de ${total} consultas simuladas en IA. `;
  if (mentioned === 0) {
    msg += 'En este momento no tienes presencia en los motores de respuesta de IA. Los usuarios que consultan ChatGPT o Perplexity sobre tu sector no te ven.';
  } else if (pct > 50) {
    msg += `En el ${pct}% de las búsquedas tipo en IA, tu marca no está en la consideración inicial. Los motores de IA priorizan marcas con autoridad de contenido, menciones externas y datos estructurados.`;
  } else {
    msg += `Tienes presencia parcial en IA. Consolidar tu estrategia de contenido y menciones externas reforzará tu visibilidad en este canal emergente.`;
  }
  return msg;
}

// ── Traffic mix ───────────────────────────────────────────────────
export function diagnosisTrafficMix(traffic: any): string {
  if (!traffic || traffic.skipped) {
    return 'No se dispone de datos de tráfico estimado para este dominio.';
  }
  const channels = traffic.channels || {};
  const total = Object.values(channels).reduce((s: number, c: any) => s + (c.visits || 0), 0);
  if (total === 0) return 'El volumen de tráfico es insuficiente para obtener estimaciones de canal.';

  const organicPct = Math.round(((channels.organic?.visits || 0) / total) * 100);
  const directPct = Math.round(((channels.direct?.visits || 0) / total) * 100);
  const paidPct = Math.round(((channels.paid?.visits || 0) / total) * 100);
  const socialPct = Math.round(((channels.social?.visits || 0) / total) * 100);

  const parts: string[] = [];

  if (organicPct < 15) {
    parts.push('Dependencia crítica de canales de pago o tráfico de marca — no tienes un motor de adquisición orgánico.');
  } else if (organicPct > 60) {
    parts.push(`Fuerte posicionamiento orgánico (${organicPct}% del tráfico). Diversificar canales reduciría el riesgo de dependencia de un solo origen.`);
  } else {
    parts.push(`El canal orgánico aporta el ${organicPct}% del tráfico total.`);
  }

  if (directPct > 60) {
    parts.push(`El tráfico directo (${directPct}%) es dominante: tus clientes ya te conocen, pero no estás captando demanda nueva de personas que aún no saben que existes.`);
  }
  if (paidPct > 40) {
    parts.push(`Alta dependencia de tráfico de pago (${paidPct}%): cada euro que dejas de invertir en paid, el tráfico desaparece.`);
  }
  if (socialPct < 5) {
    parts.push('La presencia en redes sociales apenas genera tráfico web — hay oportunidad en este canal.');
  }

  return parts.join(' ');
}

// ── PageSpeed ─────────────────────────────────────────────────────
export function diagnosisPageSpeed(ps: any): string {
  if (!ps || ps.skipped) return 'No se pudieron obtener datos de rendimiento web.';
  const mobile = ps.mobile;
  if (!mobile) return 'Sin datos de rendimiento móvil disponibles.';

  const perf = mobile.performance ?? 0;
  if (perf < 50) {
    return `Tu web tarda demasiado en cargar en móvil (score ${perf}/100). Según datos de Google, cada segundo adicional de carga reduce conversiones un 20%. Es una prioridad de mejora alta.`;
  }
  if (perf < 75) {
    return `Rendimiento móvil aceptable (${perf}/100) pero con margen de mejora. Hay quick wins en optimización de imágenes y reducción de JavaScript que pueden elevar el score significativamente.`;
  }
  return `Buen rendimiento web en móvil (${perf}/100). Tu equipo técnico ha hecho un trabajo sólido en velocidad de carga.`;
}

// ── Funnel / Conversión ───────────────────────────────────────────
export function diagnosisFunnel(cv: any): string {
  if (!cv || cv.skipped) return 'No se pudieron evaluar los elementos de conversión del sitio.';
  const score = cv.funnelScore ?? 0;
  if (score < 40) {
    return 'Tu web está diseñada como escaparate, no como máquina de captación. No hay caminos claros hacia la conversión y los elementos de confianza son limitados.';
  }
  if (score < 70) {
    return 'Tienes elementos de conversión básicos pero el funnel no está optimizado. Hay fricción entre la llegada del usuario y la acción deseada que limita la tasa de conversión.';
  }
  return 'Buen diseño de conversión. Los elementos clave (formularios, CTAs, prueba social) están presentes y bien estructurados.';
}

// ── Tech Stack ────────────────────────────────────────────────────
export function diagnosisTechStack(ts: any): string {
  if (!ts || ts.skipped) return 'No se pudieron detectar herramientas de marketing en el sitio.';

  const has = (arr: any) => arr && arr.length > 0;
  const parts: string[] = [];

  if (!has(ts.analytics)) {
    parts.push('Sin herramienta de analytics detectada — estás tomando decisiones de marketing sin datos objetivos.');
  }
  if (!has(ts.tagManager)) {
    parts.push('Sin Tag Manager — implementar nuevas herramientas o píxeles requiere cambios de código en cada ocasión.');
  }
  if (!has(ts.conversionPixels)) {
    parts.push('Sin píxeles de conversión (Meta, Google Ads) — no puedes hacer remarketing ni optimizar campañas de pago.');
  }
  if (!has(ts.crmAutomation)) {
    parts.push('Sin CRM o automatización de marketing detectados — los leads probablemente se gestionan manualmente.');
  }
  if (!has(ts.heatmaps)) {
    parts.push('Sin mapas de calor o grabaciones de sesión — no sabes qué hacen los usuarios realmente en tu web.');
  }

  if (parts.length === 0) {
    return `Stack de marketing maduro (${ts.maturityScore ?? 0}/100) con las categorías clave cubiertas.`;
  }
  return `El stack de marketing tiene un nivel de madurez de ${ts.maturityScore ?? 0}/100. Carencias detectadas: ${parts.join(' ')}`;
}

// ── Competitive gap ───────────────────────────────────────────────
export function diagnosisCompetitiveGap(seo: any, ctItems: any[], kg: any): string {
  if (!ctItems.length) return '';

  const parts: string[] = [];
  const avgETV = ctItems.reduce((s: number, c: any) => s + (c.organicTrafficEstimate || 0), 0) / ctItems.length;
  const ownETV = seo?.organicTrafficEstimate || 0;
  const gap = Math.max(0, Math.round(avgETV - ownETV));

  if (gap > 500) {
    parts.push(`La media de tus competidores genera ~${fmt(Math.round(avgETV))} visitas orgánicas/mes frente a tus ~${fmt(ownETV)}. Hay una brecha de ~${fmt(gap)} visitas/mes que podrían ser tuyas.`);
  }

  if (kg && !kg.skipped && kg.items?.length) {
    const totalSV = kg.items.reduce((s: number, i: any) => s + (i.searchVolume || 0), 0);
    parts.push(`Se han identificado ${kg.items.length} keywords en top 10 de ${kg.competitor} donde no apareces, con un volumen combinado de ~${fmt(totalSV)} búsquedas/mes.`);
  }

  return parts.join(' ');
}
