/** Fallback competitors by sector when no real data is available */
const SECTOR_DEFAULT_COMPETITORS: Record<string, string[]> = {
  'banca_privada':     ['Andbank', 'Banca March', 'Singular Bank', 'Indosuez', 'A&G Banca Privada'],
  'banca privada':     ['Andbank', 'Banca March', 'Singular Bank', 'Indosuez', 'A&G Banca Privada'],
  'wealth management': ['Andbank', 'Banca March', 'Singular Bank', 'Indosuez', 'A&G Banca Privada'],
  'seguros':           ['Mapfre', 'Axa', 'Zurich', 'Generali', 'Allianz'],
  'ecommerce':         ['Amazon', 'Zalando', 'El Corte Inglés', 'Miravia', 'PC Componentes'],
  'saas':              ['HubSpot', 'Salesforce', 'Mailchimp', 'ActiveCampaign', 'Zoho'],
  'hostelería':        ['TheFork', 'TripAdvisor', 'El Tenedor', 'Booking', 'Airbnb'],
  'inmobiliaria':      ['Idealista', 'Fotocasa', 'Habitaclia', 'pisos.com', 'Engel & Völkers'],
  'consultoría':       ['McKinsey', 'BCG', 'Bain', 'Accenture', 'Deloitte'],
  'legal':             ['Garrigues', 'Cuatrecasas', 'Uría Menéndez', 'Pérez-Llorca', 'Baker McKenzie'],
  'salud':             ['Quirónsalud', 'Sanitas', 'HM Hospitales', 'Vithas', 'Ribera Salud'],
  'educación':         ['IE University', 'ESADE', 'IESE', 'EAE', 'ISDI'],
  'logística':         ['SEUR', 'MRW', 'DHL', 'Nacex', 'GLS'],
  'tecnología':        ['Indra', 'Telefónica Tech', 'NTT Data', 'Capgemini', 'Sopra Steria'],
};

/** Sanitize internal error reasons — never expose env var names or stack traces */
function sanitizeReason(reason?: string): string {
  if (!reason) return 'Métrica no disponible en este análisis.';
  // Hide any env var name patterns
  if (/[A-Z_]{3,}(KEY|TOKEN|LOGIN|PASSWORD|SECRET|URL)/i.test(reason)) {
    return 'Métrica no disponible en este análisis.';
  }
  if (/not configured|not set|missing|undefined/i.test(reason)) {
    return 'Métrica no disponible en este análisis.';
  }
  return reason;
}

/**
 * Converts pipeline results into the plain-text equivalent of the HTML report.
 * Used as input for the Opus quality evaluator.
 */
export function renderReportText(results: Record<string, any>, domain: string): string {
  const seo       = results.seo || {};
  const geo       = results.geo || {};
  const ps        = results.pagespeed || {};
  const mobile    = ps.mobile || {};
  const comps     = results.competitors || {};
  const ct        = results.competitor_traffic || {};
  const ctItems   = (ct.items || []).filter((c: any) => !c.apiError);
  // Growth Agent unified analysis (replaces old insights). Normalizes to the
  // legacy shape (summary + bullets + initiatives) so the rest of this renderer
  // doesn't need to change.
  const growthAnalysis = (results.growth_agent || {}) as any;
  const exec = growthAnalysis.executiveSummary || {};
  const insights = {
    summary: [exec.headline, exec.situation].filter(Boolean).join(' '),
    bullets: Array.isArray(exec.criticalGaps) ? [
      exec.headline || '',
      ...exec.criticalGaps,
    ].filter(Boolean) : [],
    initiatives: Array.isArray(growthAnalysis.prioritizedActions)
      ? growthAnalysis.prioritizedActions.slice(0, 4).map((a: any) => ({
          title: a.title,
          description: a.description,
        }))
      : [],
  };
  const rep       = results.reputation || {};
  const conv      = results.conversion || {};
  const score     = results.score || {};
  const sector    = results.sector?.sector || 'desconocido';
  const kg        = results.keyword_gap || {};
  const crawl     = results.crawl || {};
  const techstack = results.techstack || {};

  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────
  lines.push('═══════════════════════════════════════════════════');
  lines.push(`DIAGNÓSTICO DIGITAL — ${domain.toUpperCase()}`);
  lines.push(`Sector: ${sector}  |  Score global: ${score.total ?? 'N/A'}/100`);
  if (crawl.companyName) lines.push(`Empresa: ${crawl.companyName}`);
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  // ── Veredicto ejecutivo ───────────────────────────────────────────
  lines.push('【 VEREDICTO EJECUTIVO 】');
  const firstBullet = insights.bullets?.[0];
  if (firstBullet) {
    lines.push(firstBullet);
  } else {
    lines.push('(Sin veredicto generado)');
  }
  lines.push('');

  // ── SEO ───────────────────────────────────────────────────────────
  lines.push('【 SEO — VISIBILIDAD ORGÁNICA 】');
  if (seo.skipped) {
    lines.push(`Datos SEO: No disponibles — ${sanitizeReason(seo.reason) === 'Métrica no disponible en este análisis.' ? 'el dominio no aparece en los índices de tráfico orgánico, lo que indica una presencia orgánica muy baja o nula en Google.' : sanitizeReason(seo.reason)}`);
  } else {
    lines.push(`Keywords en top 10:   ${seo.keywordsTop10 ?? 0}`);
    lines.push(`Keywords en top 3:    ${seo.keywordsTop3 ?? 0}`);
    lines.push(`Keywords pos. 4-10:   ${seo.keywordsPos4to10 ?? 0}`);
    lines.push(`Tráfico estimado:     ${fmtNum(seo.organicTrafficEstimate)} visitas/mes`);
    if (seo.organicTrend) {
      const dir = seo.organicTrend === 'up' ? '↑ Creciente' : seo.organicTrend === 'down' ? '↓ Descendente' : '→ Estable';
      lines.push(`Tendencia 12 meses:   ${dir} (${seo.organicTrendPct > 0 ? '+' : ''}${seo.organicTrendPct ?? 0}%)`);
    }
    if (seo.domainRank != null) {
      lines.push(`Domain rank:          ${seo.domainRank}`);
    } else if ((seo.keywordsTop10 ?? 0) > 100) {
      // High-authority domain but DR API failed — don't say "no authority"
      lines.push(`Domain rank:          No disponible (API no devolvió dato, el dominio tiene ${fmtNum(seo.keywordsTop10)} keywords posicionadas)`);
    } else {
      lines.push(`Domain rank:          No disponible`);
    }
  }
  if (seo.trendLost > 0 || seo.trendUp > 0) {
    lines.push(`Tendencia:            +${seo.trendUp ?? 0} subidas / -${seo.trendLost ?? 0} bajadas`);
  }
  if (seo.topKeywords?.length) {
    lines.push(`Top keywords:`);
    seo.topKeywords.slice(0, 6).forEach((k: any) => {
      lines.push(`  "${k.keyword}"  pos ${k.position}  vol ${fmtNum(k.searchVolume)}`);
    });
  }
  lines.push('');

  // ── GEO (IA visibility) ───────────────────────────────────────────
  lines.push('【 GEO — VISIBILIDAD EN IA 】');
  lines.push(`Score GEO:       ${geo.overallScore ?? 'N/A'}/100`);
  lines.push(`Tasa de mención: ${geo.mentionRate ?? 'N/A'}%`);
  lines.push(`Score de marca:  ${geo.brandScore ?? 'N/A'}/100`);
  lines.push(`Score de sector: ${geo.sectorScore ?? 'N/A'}/100`);
  if (geo.queries?.length) {
    const mentioned = geo.queries.filter((q: any) => q.mentioned).length;
    lines.push(`Aparece en: ${mentioned} de ${geo.queries.length} respuestas IA`);
    lines.push('Consultas evaluadas:');
    geo.queries.slice(0, 5).forEach((q: any) => {
      const mark = q.mentioned ? '✓' : '✗';
      lines.push(`  ${mark} "${q.query}"`);
    });
  }
  if (geo.competitorMentions?.length) {
    lines.push('Menciones de competidores en IA:');
    geo.competitorMentions.slice(0, 3).forEach((m: any) => {
      lines.push(`  ${m.name}: ${m.mentionRate ?? '?'}% de mención`);
    });
  }
  lines.push('');

  // ── Competidores ──────────────────────────────────────────────────
  lines.push('【 COMPETIDORES Y BENCHMARK 】');
  const compList = comps.competitors || [];
  if (compList.length) {
    lines.push(`Competidores identificados: ${compList.map((c: any) => c.name || c.url).join(', ')}`);
  }
  if (ctItems.length) {
    lines.push('Comparativa de tráfico:');
    lines.push(`  ${domain}: ${seo.keywordsTop10 ?? 0} kw top10 | ${fmtNum(seo.organicTrafficEstimate)} vis/mes | DR ${seo.domainRank ?? 'N/A'}`);
    ctItems.forEach((c: any) => {
      const tag = c.type === 'aspirational' ? ' [aspiracional]' : '';
      lines.push(`  ${c.name}${tag}: ${c.keywordsTop10 ?? 'N/A'} kw | ${fmtNum(c.organicTrafficEstimate)} vis/mes | DR ${c.domainRank ?? 'N/A'}`);
    });
  } else if (compList.length === 0) {
    // Fallback: reference competitors by sector
    const defaults = SECTOR_DEFAULT_COMPETITORS[sector.toLowerCase()] || SECTOR_DEFAULT_COMPETITORS[Object.keys(SECTOR_DEFAULT_COMPETITORS).find(k => sector.toLowerCase().includes(k)) || ''] || [];
    if (defaults.length) {
      lines.push(`Benchmark de referencia del sector: ${defaults.join(', ')}`);
      lines.push('  (Datos de tráfico competitivo específicos disponibles en plan de monitorización)');
    } else {
      lines.push('Sin datos de competidores disponibles para este sector.');
    }
  }
  lines.push('');

  // ── Rendimiento web ───────────────────────────────────────────────
  lines.push('【 RENDIMIENTO WEB 】');
  const ssl = results.ssl || {};
  if (mobile.performance != null) {
    lines.push(`Performance móvil:   ${mobile.performance}/100`);
  } else if (ssl.valid === false) {
    lines.push(`Performance móvil:   No medible — el certificado SSL inválido impide el análisis de rendimiento.`);
  } else if (ps.skipped) {
    lines.push(`Performance móvil:   No medible — ${sanitizeReason(ps.reason) === 'Métrica no disponible en este análisis.' ? 'la web no respondió al test de PageSpeed.' : sanitizeReason(ps.reason)}`);
  } else {
    lines.push(`Performance móvil:   No disponible.`);
  }
  if (mobile.lcp) {
    const lcpSec = (mobile.lcp / 1000).toFixed(1);
    const lcpLabel = mobile.lcp < 2500 ? 'bueno' : mobile.lcp < 4000 ? 'mejorable' : 'lento';
    lines.push(`LCP:                 ${lcpSec}s (${lcpLabel})`);
  }
  if (mobile.cls != null) lines.push(`CLS:                 ${mobile.cls}`);
  if (mobile.fcp) lines.push(`FCP:                 ${(mobile.fcp / 1000).toFixed(1)}s`);
  const desktop = ps.desktop || {};
  if (desktop.performance) lines.push(`Performance desktop: ${desktop.performance}/100`);
  lines.push('');

  // ── Reputación ────────────────────────────────────────────────────
  lines.push('【 REPUTACIÓN Y PRESENCIA DE MARCA 】');
  if (rep.combinedRating) {
    lines.push(`Rating combinado: ${rep.combinedRating}/5`);
    lines.push(`Total reseñas:    ${rep.totalReviews ?? rep.gbpReviews ?? 'N/A'}`);
    lines.push(`Nivel:            ${rep.reputationLevel ?? 'N/A'}`);
  } else {
    lines.push('Sin datos de reputación suficientes.');
  }
  if (rep.newsCount > 0) {
    lines.push(`Noticias de prensa: ${rep.newsCount}`);
    rep.newsHeadlines?.slice(0, 3).forEach((h: any) => {
      if (typeof h === 'string') {
        lines.push(`  • ${h}`);
      } else if (h && h.title) {
        lines.push(`  • ${h.title}${h.source ? ' — ' + h.source : ''}${h.date ? ' (' + h.date + ')' : ''}`);
      }
    });
  }
  lines.push('');

  // ── Conversión ────────────────────────────────────────────────────
  lines.push('【 CONVERSIÓN 】');
  const funnelVal = conv.funnelScore != null && conv.funnelScore !== undefined
    ? `${conv.funnelScore}/100`
    : 'No calculado';
  lines.push(`Funnel score:          ${funnelVal}`);
  lines.push(`Formulario de contacto: ${conv.hasContactForm ? 'Sí' : 'No'}`);
  lines.push(`Tiene CTA:              ${conv.hasCTA ? 'Sí' : 'No'}`);
  lines.push(`Tiene testimonios:      ${conv.hasTestimonials ? 'Sí' : 'No'}`);
  lines.push(`Tiene pricing:          ${conv.hasPricing ? 'Sí' : 'No'}`);
  if (conv.strengths?.length) lines.push(`Puntos fuertes: ${conv.strengths.join(', ')}`);
  if (conv.weaknesses?.length) lines.push(`Puntos débiles: ${conv.weaknesses.join(', ')}`);
  lines.push('');

  // ── Tech stack ────────────────────────────────────────────────────
  if (techstack.cms || techstack.analytics?.length) {
    lines.push('【 TECNOLOGÍA 】');
    if (techstack.cms) lines.push(`CMS: ${techstack.cms}`);
    if (techstack.analytics?.length) lines.push(`Analytics: ${techstack.analytics.join(', ')}`);
    lines.push(`Madurez digital: ${techstack.maturityScore ?? 'N/A'}/100`);
    lines.push('');
  }

  // ── Keyword gaps ──────────────────────────────────────────────────
  if (kg.items?.length) {
    lines.push('【 GAPS DE KEYWORDS 】');
    lines.push(`Oportunidades encontradas: ${kg.items.length}`);
    kg.items.slice(0, 5).forEach((item: any) => {
      lines.push(`  "${item.keyword}" — vol ${fmtNum(item.searchVolume)}, dificultad ${item.difficulty ?? '?'}`);
    });
    lines.push('');
  }

  // ── Diagnóstico y plan ────────────────────────────────────────────
  lines.push('【 DIAGNÓSTICO 】');
  if (insights.bullets?.length > 1) {
    insights.bullets.slice(1).forEach((b: string) => lines.push(`• ${b}`));
  } else {
    lines.push('(Sin bullets de diagnóstico)');
  }
  lines.push('');

  lines.push(`【 PLAN DE ACCIÓN 】 (Sector: ${sector})`);
  if (insights.initiatives?.length) {
    insights.initiatives.forEach((init: any) => {
      lines.push(`→ ${init.title}`);
      lines.push(`  ${init.description}`);
    });
  } else {
    lines.push('(Sin iniciativas generadas)');
  }
  lines.push('');

  return lines.join('\n');
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return 'N/A';
  return n.toLocaleString('es-ES');
}
