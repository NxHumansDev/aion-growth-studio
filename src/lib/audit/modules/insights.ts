import type { InsightsResult, ModuleResult } from '../types';

const API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

export async function runInsights(
  url: string,
  results: Record<string, ModuleResult>,
): Promise<InsightsResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const summary = buildSummary(url, results);
  const prompt = buildPrompt(summary);

  // Extract balanced JSON from LLM response
  function extractJSON(str: string): string | null {
    const start = str.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
    }
    return null;
  }

  // Retry up to 2 times if JSON extraction fails
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await res.json();
      const text: string = data?.content?.[0]?.text || '';

      const jsonStr = extractJSON(text);
      if (!jsonStr) {
        console.log(`[audit:insights] Attempt ${attempt}/${MAX_ATTEMPTS}: No JSON found (${text.length} chars)`);
        if (attempt < MAX_ATTEMPTS) { clearTimeout(timer); continue; }
        return { bullets: [], initiatives: [], error: 'No JSON in response after retries' };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        const fixed = jsonStr.replace(/,\s*([\]}])/g, '$1');
        parsed = JSON.parse(fixed);
      }
      const result = {
        summary: parsed.summary || undefined,
        visibilitySummary: parsed.visibilitySummary || undefined,
        benchmarkSummary: parsed.benchmarkSummary || undefined,
        experienceSummary: parsed.experienceSummary || undefined,
        bullets: (parsed.bullets || []).slice(0, 6),
        initiatives: (parsed.initiatives || []).slice(0, 3),
      };
      console.log(`[audit:insights] OK — ${result.bullets.length} bullets, ${result.initiatives.length} initiatives`);
      return result;
    } catch (err: any) {
      clearTimeout(timer);
      if (attempt < MAX_ATTEMPTS && err.name !== 'AbortError') {
        console.log(`[audit:insights] Attempt ${attempt} failed: ${err.message?.slice(0, 60)}, retrying...`);
        continue;
      }
      const msg = err.name === 'AbortError' ? 'Insights timed out (55s)' : err.message?.slice(0, 100);
      return { bullets: [], initiatives: [], error: msg };
    } finally {
      clearTimeout(timer);
    }
  }

  return { bullets: [], initiatives: [], error: 'Exhausted retries' };
}

function buildSummary(url: string, r: Record<string, ModuleResult>): string {
  const domain = new URL(url.startsWith('http') ? url : `https://${url}`)
    .hostname.replace(/^www\./, '');

  const score           = r.score             as any;
  const crawl           = r.crawl             as any;
  const ssl             = r.ssl               as any;
  const ps              = r.pagespeed         as any;
  const sector          = r.sector            as any;
  const content         = r.content           as any;
  const geo             = r.geo               as any;
  const ig              = r.instagram         as any;
  const li              = r.linkedin          as any;
  const gbp             = r.gbp               as any;
  const traffic         = r.traffic           as any;
  const seo             = r.seo               as any;
  const techstack       = r.techstack         as any;
  const conversion      = r.conversion        as any;
  const competitors     = r.competitors       as any;
  const compTraffic     = r.competitor_traffic as any;
  const kg              = r.keyword_gap       as any;

  const bd = score?.breakdown;

  const lines: string[] = [];

  // ── DATOS CLAVE PARA EL VEREDICTO (top-of-prompt for LLM salience) ──
  const lcpMs = ps?.mobile?.lcp;
  const lcpS = lcpMs != null ? (lcpMs / 1000).toFixed(1) : null;
  const geoMR = geo?.mentionRate ?? 0; // 0-100
  const kgCount = (kg?.items || []).length;
  const kw4to10 = seo?.keywordsPos4to10 ?? Math.max(0, (seo?.keywordsTop10 ?? 0) - (seo?.keywordsTop3 ?? 0));
  const compGeo: string[] = (geo?.competitorMentions || []).map(
    (m: any) => `${m.name || m.domain} (${m.mentionRate ?? 0}% IA)`
  );
  const compBench: string[] = (compTraffic?.items || [])
    .filter((c: any) => !c.apiError && c.keywordsTop10 != null)
    .map((c: any) => `${c.name || c.domain} (${c.keywordsTop10} kw${c.type === 'aspirational' ? ' — referencia' : ''})`);
  lines.push('=== DATOS CLAVE PARA EL VEREDICTO ===');
  lines.push(`Dominio analizado: ${domain}`);
  lines.push(`Sector: ${sector?.sector || 'desconocido'} | Tipo de negocio: ${(crawl as any)?.businessType || 'unknown'}`);
  lines.push(`Score global: ${score?.total ?? '?'}/100`);
  lines.push(`Keywords top 10: ${seo?.keywordsTop10 ?? '?'} | Keywords posición 4-10 (optimizables): ${kw4to10}`);
  lines.push(`Tráfico orgánico estimado: ${seo?.organicTrafficEstimate ?? '?'} visitas/mes`);
  lines.push(`Visibilidad en IA (GEO): ${geoMR}% de consultas con mención`);
  lines.push(`PageSpeed móvil: ${ps?.mobile?.performance ?? '?'}/100${lcpS ? ` | LCP: ${lcpS}s (Google recomienda <2.5s)` : ''}`);
  lines.push(`Funnel score: ${conversion?.funnelScore ?? '?'}/100`);
  lines.push(`Blog activo: ${(r.content_cadence as any)?.totalPosts > 0 ? 'sí' : 'no'} | Sitemap: ${(crawl as any)?.hasSitemap ? 'sí' : 'no'}`);
  lines.push(`Keyword gaps detectados: ${kgCount}`);
  if (compBench.length > 0) lines.push(`Competidores benchmark: ${compBench.join(', ')}`);
  if (compGeo.length > 0) lines.push(`Competidores en IA: ${compGeo.join(', ')}`);

  // ── Identidad ────────────────────────────────────────────────────
  lines.push('\n=== IDENTIDAD DE LA MARCA ===');
  lines.push(`Dominio: ${domain}`);
  lines.push(`Sector: ${sector?.sector || 'desconocido'} (confianza: ${sector?.confidence ? Math.round(sector.confidence * 100) + '%' : '?'})`);
  lines.push(`Tipo de negocio: ${(crawl as any)?.businessType || 'unknown'}`);
  lines.push(`Propuesta de valor detectada: "${content?.valueProposition || 'no detectada'}"`);
  lines.push(`CTA principal en la web: "${content?.cta || 'no detectado'}"`);
  lines.push(`Palabras en la página principal: ${crawl?.wordCount ?? '?'} (solo homepage, no el sitio completo)`);

  // ── Score global ─────────────────────────────────────────────────
  lines.push('\n=== AION DIGITAL HEALTH SCORE ===');
  lines.push(`Score global: ${score?.total ?? '?'}/100`);
  if (bd) {
    lines.push(`  · Pilar 1 — SEO orgánico:   ${bd.seo ?? bd.seoVisibility ?? '?'}/100`);
    lines.push(`  · Pilar 2 — Visibilidad IA: ${bd.geo ?? '?'}/100`);
    lines.push(`  · Pilar 3 — Web & técnico:  ${bd.web ?? bd.technical ?? '?'}/100`);
    lines.push(`  · Pilar 4 — Conversión:     ${bd.conversion ?? '?'}/100`);
    lines.push(`  · Pilar 5 — Reputación:     ${bd.reputation ?? bd.socialReputation ?? '?'}/100`);
  }

  // ── Técnico ──────────────────────────────────────────────────────
  lines.push('\n=== TÉCNICO (Pilar 1) ===');
  lines.push(`PageSpeed móvil: ${ps?.mobile?.performance ?? '?'}/100${ps?.mobile?.lcp ? ` · LCP ${ps.mobile.lcp}ms` : ''}`);
  lines.push(`PageSpeed escritorio: ${ps?.desktop?.performance ?? '?'}/100`);
  lines.push(`Accesibilidad: ${ps?.mobile?.accessibility ?? '?'}/100 · SEO Lighthouse: ${ps?.mobile?.seo ?? '?'}/100`);
  const sslDays = ssl?.daysUntilExpiry;
  const sslUrgency = sslDays == null ? '' : sslDays > 90 ? ' — a monitorizar, sin acción inmediata' : sslDays > 30 ? ' — planificar renovación próxima' : sslDays > 7 ? ' — renovación urgente recomendada' : ' — CRÍTICO, renovar inmediatamente';
  lines.push(`SSL: ${ssl?.valid ? 'válido' : 'inválido'}${sslDays != null ? ` (expira en ${sslDays} días${sslUrgency})` : ''}`);
  lines.push(`Schema.org: ${crawl?.hasSchemaMarkup ? 'sí' : 'no'} · Canonical: ${crawl?.hasCanonical ? 'sí' : 'no'} · Sitemap: ${crawl?.hasSitemap ? 'sí' : 'no'}`);

  // ── SEO orgánico ─────────────────────────────────────────────────
  lines.push('\n=== SEO ORGÁNICO (Pilar 1) ===');
  if (!seo?.skipped && seo?.domainRank != null) {
    lines.push(`Domain Rank: ${seo.domainRank}/100 (0=sin autoridad, 100=dominio top mundial)`);
    lines.push(`Keywords en top 3: ${seo.keywordsTop3 ?? 0} · top 10: ${seo.keywordsTop10 ?? 0} · posición 4-10 (optimizables): ${seo.keywordsPos4to10 ?? kw4to10} · top 30: ${seo.keywordsTop30 ?? 0}`);
    lines.push(`Tráfico orgánico estimado: ${seo.organicTrafficEstimate ?? 0} visitas/mes`);
    if (seo.organicTrend) {
      const tDir = seo.organicTrend === 'up' ? 'CRECIENTE' : seo.organicTrend === 'down' ? 'DESCENDENTE' : 'ESTABLE';
      lines.push(`Tendencia orgánica últimos 12 meses: ${tDir} (${seo.organicTrendPct > 0 ? '+' : ''}${seo.organicTrendPct ?? 0}%)`);
      if (seo.organicHistory?.length) {
        const first = seo.organicHistory[0];
        const last = seo.organicHistory[seo.organicHistory.length - 1];
        lines.push(`  Hace 12 meses: ~${first.etv} visitas/mes → Ahora: ~${last.etv} visitas/mes`);
      }
    }
    lines.push(`Dominios referentes: ${seo.referringDomains ?? 0} · Backlinks totales: ${seo.backlinksTotal ?? 0}`);
  } else {
    lines.push('SEO orgánico: sin datos disponibles');
  }

  // ── Tráfico ──────────────────────────────────────────────────────
  if (!traffic?.skipped && traffic?.visits) {
    lines.push('\n=== TRÁFICO ===');
    lines.push(`Visitas anuales estimadas: ${traffic.visits}`);
    if (traffic.channels) {
      const ch = traffic.channels;
      const sorted = Object.entries(ch)
        .map(([k, v]: [string, any]) => ({ k, visits: v.visits || 0, share: v.share || 0 }))
        .sort((a, b) => b.visits - a.visits);
      sorted.forEach(({ k, visits, share }) => {
        const labels: Record<string, string> = { organic: 'Orgánico', direct: 'Directo', social: 'Social', referral: 'Referral', paid: 'Pago', email: 'Email' };
        lines.push(`  · ${labels[k] || k}: ${share}% (${visits} visitas/año)`);
      });
    }
    if (traffic.bounceRate) lines.push(`Tasa de rebote: ${traffic.bounceRate}%`);
  }

  // ── Contenido ────────────────────────────────────────────────────
  lines.push('\n=== CONTENIDO (Pilar 3) ===');
  lines.push(`Claridad del contenido: ${content?.clarity ?? '?'}/100`);
  if (content?.strengths?.length) lines.push(`Fortalezas del copy: ${content.strengths.join(' · ')}`);
  if (content?.weaknesses?.length) lines.push(`Debilidades del copy: ${content.weaknesses.join(' · ')}`);
  if (content?.audienceMatch) lines.push(`Audiencia objetivo detectada: ${content.audienceMatch}`);

  // ── Visibilidad en IA ─────────────────────────────────────────────
  lines.push('\n=== VISIBILIDAD EN IA — GEO ===');
  lines.push(`GEO score global: ${geo?.overallScore ?? '?'}/100`);
  lines.push(`  · Visibilidad espontánea (sector + valor): ${geo?.sectorScore ?? '?'}/40`);
  lines.push(`  · Reconocimiento de marca (keywords + directo): ${geo?.brandScore ?? '?'}/60`);
  if (geo?.queries?.length) {
    const LABELS = ['Sector general (sin nombrar la marca)', 'Propuesta de valor', 'Keywords específicas', 'Consulta directa por nombre'];
    geo.queries.slice(0, 4).forEach((q: any, i: number) => {
      const status = q.mentioned ? `APARECE (${q.pts ?? 0} pts)` : `NO aparece (0 pts)`;
      lines.push(`  · Nivel ${i + 1} — ${LABELS[i] || '?'}: ${status}`);
      if (q.mentioned && q.context) lines.push(`    Contexto: "${q.context.slice(0, 120)}"`);
    });
  }

  // ── Social y Reputación ──────────────────────────────────────────
  lines.push('\n=== SOCIAL Y REPUTACIÓN (Pilar 4) ===');
  if (ig?.found === true) {
    lines.push(`Instagram: @${ig.handle}${ig.followers != null ? ` · ${ig.followers} seguidores` : ' · seguidores: no disponible'}${ig.engagementRate != null ? ` · engagement ${ig.engagementRate}%` : ''}`);
    if (ig.reason) lines.push(`  (nota: ${ig.reason})`);
  } else {
    lines.push('Instagram: no detectado en la web');
  }
  if (li?.found === true) {
    lines.push(`LinkedIn: ${li.url}${li.followers != null ? ` · ${li.followers} seguidores` : ' · seguidores: no disponible'}${li.employees ? ` · ${li.employees} empleados` : ''}`);
    if (li.reason) lines.push(`  (nota: ${li.reason})`);
  } else {
    lines.push('LinkedIn: no detectado en la web');
  }
  if (gbp?.found) {
    lines.push(`Google Business Profile: ${gbp.rating ?? '?'}⭐ con ${gbp.reviewCount ?? 0} reseñas`);
    if (gbp.address) lines.push(`  Dirección: ${gbp.address}`);
  } else {
    lines.push('Google Business Profile: no encontrado');
  }

  // ── Conversión ───────────────────────────────────────────────────
  lines.push('\n=== CONVERSIÓN (Pilar 5) ===');
  lines.push(`Funnel score: ${conversion?.funnelScore ?? '?'}/100`);
  lines.push(`Formulario de contacto: ${conversion?.hasContactForm ? `sí (${conversion.formFieldCount} campos)` : 'no'}`);
  lines.push(`CTAs detectados: ${conversion?.ctaCount ?? 0}`);
  lines.push(`Lead magnet: ${conversion?.hasLeadMagnet ? 'sí' : 'no'} · Testimonios: ${conversion?.hasTestimonials ? 'sí' : 'no'} · Precios visibles: ${conversion?.hasPricing ? 'sí' : 'no'}`);
  lines.push(`Chat en vivo: ${conversion?.hasChatWidget ? 'sí' : 'no'} · Vídeo: ${conversion?.hasVideo ? 'sí' : 'no'}`);
  if (conversion?.summary) lines.push(`Análisis LLM: "${conversion.summary}"`);
  if (conversion?.weaknesses?.length) lines.push(`Brechas: ${conversion.weaknesses.join(' · ')}`);

  // ── Tech stack ───────────────────────────────────────────────────
  lines.push('\n=== MEDICIÓN Y STACK (Pilar 6) ===');
  lines.push(`Madurez del stack: ${techstack?.maturityScore ?? '?'}/100`);
  if (techstack?.cms) lines.push(`CMS: ${techstack.cms}`);
  lines.push(`Analytics: ${techstack?.analytics?.join(', ') || 'ninguno detectado'}`);
  lines.push(`Tag Manager: ${techstack?.tagManager?.join(', ') || 'ninguno'}`);
  lines.push(`Píxeles conversión: ${techstack?.conversionPixels?.join(', ') || 'ninguno'}`);
  lines.push(`CRM/Automatización: ${techstack?.crmAutomation?.join(', ') || 'ninguno'}`);
  lines.push(`Chat: ${techstack?.chatSupport?.join(', ') || 'ninguno'}`);

  // ── Competidores ─────────────────────────────────────────────────
  const comps = competitors?.competitors || [];
  if (comps.length > 0) {
    lines.push('\n=== COMPETIDORES ===');
    comps.slice(0, 5).forEach((c: any, i: number) => {
      lines.push(`${i + 1}. ${c.name} (${c.url})`);
    });
  } else {
    lines.push('\n=== COMPETIDORES ===');
    lines.push('AVISO: No hay datos de competidores disponibles para este análisis. NO hagas comparativas con competidores en los bullets ni en las iniciativas. Basa el análisis únicamente en los datos propios del dominio.');
  }

  // ── Benchmark competitivo (tráfico SEO comparativo) ───────────────
  const ctItems: any[] = (compTraffic?.items || []).filter((c: any) => !c.apiError && (c.organicTrafficEstimate != null || c.keywordsTop10 != null));
  if (ctItems.length > 0) {
    lines.push('\n=== BENCHMARK COMPETITIVO ===');
    lines.push(`Cliente — Keywords Top 10: ${seo?.keywordsTop10 ?? 0} · Tráfico orgánico est.: ${seo?.organicTrafficEstimate ?? 0}/mes · Domain Rank: ${seo?.domainRank ?? '?'}/100`);
    ctItems.slice(0, 3).forEach((c: any) => {
      lines.push(`${c.name || c.domain}: kw top10=${c.keywordsTop10 ?? '?'} · tráfico est.=${c.organicTrafficEstimate ?? '?'}/mes · paid kw=${c.paidKeywordsTotal ?? 0}`);
    });
    const kgItems: any[] = kg?.items || [];
    if (kgItems.length > 0) {
      lines.push(`Keyword gap vs competidores: ${kgItems.length} keywords donde el competidor posiciona y el cliente no. Top: ${kgItems.slice(0, 3).map((k: any) => `"${k.keyword}" (vol ${k.searchVolume ?? '?'})`).join(', ')}`);
    } else {
      lines.push('Keyword gap: 0 gaps detectados — NO recomiendes atacar gaps de keywords.');
    }
  } else {
    lines.push('\n=== BENCHMARK COMPETITIVO ===');
    lines.push('Sin datos de tráfico competitivo disponibles. No hagas comparativas numéricas precisas con competidores.');
  }

  return lines.join('\n');
}

function buildPrompt(summary: string): string {
  return `Eres el director de estrategia de AION Growth Studio, con 15 años de experiencia en growth y marketing digital. Acabas de completar un análisis automatizado de presencia digital. Tienes todos los datos a continuación.

Tu misión: redactar el diagnóstico ejecutivo que verá el dueño de la empresa cuando abra su informe. Debe sentirse como si lo hubiera escrito un consultor senior que se ha empapado a fondo de su negocio, no como un output genérico de IA.

Genera seis cosas: (1) un resumen ejecutivo de 2 frases para el hero del informe, (2) una línea de contexto sobre la visibilidad digital del negocio, (3) una línea de contexto sobre el benchmark competitivo, (4) una línea de contexto sobre la experiencia web y conversión, (5) los bullets de diagnóstico detallado, (6) las iniciativas estratégicas.

DATOS DEL ANÁLISIS:
${summary}

REGLAS DE COHERENCIA — OBLIGATORIAS (violarlas hace que el QA rechace el output):

C1. REGLA DEL VEREDICTO — OBLIGATORIA:
El "summary" es lo primero que lee el Director de Marketing. Debe demostrar en 3-4 frases que hemos analizado SU empresa, no una plantilla genérica.

ESTRUCTURA OBLIGATORIA del veredicto:
1. Una frase sobre lo MEJOR del análisis — con el dato numérico concreto
2. Una frase sobre lo PEOR — con dato numérico y comparación (vs competidor o vs benchmark)
3. Una frase sobre la OPORTUNIDAD más clara — qué podría ganar si actúa

REGLAS DEL VEREDICTO:
- MÍNIMO 4 datos numéricos concretos (keywords, %, segundos, score, conteos)
- DEBE mencionar el dominio analizado o el nombre de la empresa
- DEBE comparar al menos 1 dato con un competidor real O con un benchmark conocido (ej: "Google recomienda <2.5s")
- PROHIBIDO usar: "bases técnicas aceptables", "déficits significativos", "oportunidades de captación", "presencia digital" sin dato
- PROHIBIDO un veredicto que sea 100% genérico (que podría aplicarse a cualquier empresa)

EJEMPLO CORRECTO DE VEREDICTO:
"Andbank aparece en el 45% de las consultas de IA — por encima de Lombard Odier (0%) pero por debajo de Banco Sabadell (73%). Con 69 keywords en top 10 hay tracción orgánica real, pero la web tarda 6s en cargar en móvil (Google recomienda <2.5s) y no hay blog ni sitemap XML. Optimizar las 37 keywords en posición 4-10 es la acción de mayor retorno inmediato."

EJEMPLO INCORRECTO DE VEREDICTO (RECHAZAR):
"Tu presencia digital tiene bases técnicas aceptables pero déficits significativos en visibilidad y posicionamiento. Estás perdiendo oportunidades de captación cada día."
→ Rechazado: 0 datos concretos, 0 menciones del dominio, 0 comparaciones, 100% genérico.

C2. NO CONTRADECIR DATOS: Si el análisis dice 0 keyword gaps, NO recomendes "atacar gaps de keywords". Si GEO es ≥60%, NO digas que la marca es invisible en IA. Lee los datos antes de escribir.

C3. SECTOR-AWARE — OBLIGATORIO: Las recomendaciones DEBEN adaptarse al tipo de negocio.
  - Banca privada, wealth management, finanzas, seguros: NO recomendes "formulario de contacto visible" ni "chat de soporte en tiempo real". SÍ recomienda "canal de contacto privado", "solicitar cita con advisor", "calculadora de rentabilidad", "acceso a plataforma segura". El lenguaje es de asesoramiento, no de captación masiva.
  - Hostelería / restauración: SÍ "reservas online", "menú visible", "Google Business Profile optimizado".
  - Ecommerce: SÍ formulario, carrito, chat de soporte, valoraciones de producto.
  - Servicios B2B: prioriza credibilidad, casos de éxito, solicitar presupuesto / agendar llamada.

C4. INICIATIVAS = LAS 3 ACCIONES DE MAYOR IMPACTO PARA ESTE NEGOCIO CONCRETO:
  - NO son una por temática (SEO, GEO, conversión). Son las 3 que MÁS moverían la aguja para ESTA empresa.
  - Si el mayor problema es la velocidad web → la primera iniciativa es velocidad, aunque ya haya una de SEO.
  - Si la empresa tiene 0 presencia orgánica → las 3 pueden ser de SEO. No repartas por categoría.
  - PRIORIZA por impacto de negocio: ¿qué acción generaría más ingresos/leads en menos tiempo?
  - Cada título es un verbo imperativo + resultado. MAL: "Tu presencia digital obtiene un 57/100". BIEN: "Optimizar 37 keywords en posición 4–10 para doblar el tráfico".
  - Cada descripción: problema con dato → qué hacer concretamente → resultado esperado con timeline.
  - ADAPTA al sector y al tamaño: un ecommerce necesita conversión, un despacho de abogados necesita credibilidad, un hotel necesita reviews.

C5. KEYWORDS GAP HONESTO: Si keyword_gap tiene 0 items o está vacío, NO recomiendes "atacar el gap de keywords". Recomenda en su lugar optimizar las keywords en posición 4-10 o crear contenido nuevo.

REGLAS DE REDACCIÓN ESTRICTAS:
0. El campo "summary" es 1-2 frases que capturan la situación real del negocio con UN dato clave. Es lo primero que leerá el CEO. Sé directo y específico: di qué tiene bien y cuál es el mayor gap, con el dato que lo demuestra. Si no hay datos de competidores, NO menciones comparativas con competidores.
0b. El campo "visibilitySummary" es UNA frase (máx. 25 palabras) que resume exclusivamente los tres pilares de Visibilidad Digital: SEO orgánico (keywords/tráfico), GEO/IA (mention rate) y Publicidad (paid keywords). Indica qué pilar domina, cuál es el gap más crítico y qué implica para el negocio. Solo datos de estos tres canales, nada de conversión, técnico ni reputación.
0c. El campo "benchmarkSummary" es UNA frase (máx. 25 palabras) que resume la posición competitiva del negocio frente a sus competidores: quién lidera en SEO orgánico (keywords top 10), cuál es la brecha más crítica y si el cliente está perdiendo o ganando terreno. Si no hay datos de tráfico competitivo, describe la posición SEO del cliente en términos absolutos.
0d. El campo "experienceSummary" es UNA frase (máx. 25 palabras) que resume la experiencia web y capacidad de conversión: velocidad en móvil (PageSpeed), capacidad de captación (funnel score) y madurez del stack de medición (tech maturity). Solo estos tres aspectos, sin SEO ni competidores.
1. CADA bullet y CADA frase de iniciativa DEBE citar un dato específico del análisis en paréntesis, p.ej.: "(Domain Rank 18/100, por debajo del benchmark sectorial de 35)" o "(0 keywords en top 10 en Google)" o "(GEO nivel 1: la IA no menciona la marca en consultas de sector)".
2. Habla en términos de NEGOCIO, nunca de tecnología. Prohíbido: "canonical tags", "schema markup", "LCP", "CLS". Permitido: "tu web no aparece bien configurada para Google", "Google tarda más de 4 segundos en cargar tu página en móvil", "ningún asistente de IA menciona tu marca cuando alguien pregunta por servicios de [sector]".
3. El GEO score debe traducirse a impacto de negocio real: si score < 30, di que la marca es invisible para la IA; si > 60, destaca la ventaja competitiva.
4. Sé directo sobre las brechas más graves. No suavices lo que merece urgencia.
5. Las iniciativas deben fluir de los datos: si el funnel score es bajo, la primera iniciativa debe atacar la conversión con los datos exactos que lo demuestran.
6. Tono: experto que respeta al empresario. No condescendiente, no hiperentusiasta. Como un buen médico que te da el diagnóstico real.

EJEMPLO DE OUTPUT CORRECTO (para una empresa de consultoría con score 42/100):
{
  "summary": "Tienes una base SEO sólida (8 keywords en top 10, ~4.200 visitas/mes) pero tu marca es invisible en IA: aparece en 1 de 12 respuestas de ChatGPT sobre tu sector, y sin analytics ni píxeles instalados no puedes medir ni optimizar nada.",
  "bullets": [
    "Invisible en IA: tu marca aparece en 1 de 12 respuestas cuando alguien pregunta por consultoría de sostenibilidad en ChatGPT o Perplexity (GEO score 8/100) — tu principal competidor aparece en 7 de 12.",
    "Web lenta en móvil: Google tarda 4.8 segundos en mostrar tu contenido en móvil (LCP 4.8s, umbral recomendado: 2.5s). Cada segundo adicional reduce la conversión un 10-20%.",
    "Sin captación activa: tu web tiene 1.400 palabras de contenido pero sin formulario visible ni CTA claro en las páginas de servicio (funnel score 22/100).",
    "SEO en construcción: 8 keywords en top 10 de Google (Domain Rank 18/100) — tu competidor más cercano tiene 68 keywords en top 10.",
    "Reputación sólida: 4.7 estrellas con 124 reseñas en Google Business Profile — por encima del promedio del sector.",
    "Stack de medición incompleto: no hay píxel de conversión ni tag manager instalado — sin datos para optimizar campañas futuras."
  ],
  "initiatives": [
    {
      "title": "Añadir captación a páginas de servicio",
      "description": "Tus páginas de servicio acumulan tráfico pero no convierten: sin formulario visible ni CTA directo (funnel score 22/100). Añadir un formulario de 3-5 campos y un CTA claro en cada página de servicio es la acción de mayor impacto inmediato. Resultado esperado: 2-4 leads adicionales/mes sin incrementar el tráfico."
    },
    {
      "title": "Posicionarte en los 8 gaps de keywords",
      "description": "Hay 8 consultas donde tu competidor aparece en top 10 y tú no — términos como 'consultoría sostenibilidad empresas' con 590 búsquedas/mes. Crear páginas específicas para estas keywords es la palanca de mayor retorno orgánico. Resultado esperado: +30-50% de tráfico orgánico en 4-6 meses."
    },
    {
      "title": "Crear contenido para ser visible en IA",
      "description": "Apareces en 1 de 12 respuestas de ChatGPT y Perplexity cuando alguien pregunta por tu sector (GEO score 8/100). Publicar artículos de autoridad que respondan las preguntas exactas que la IA usa como fuente mejora esta métrica. Resultado: incremento progresivo de visibilidad en IA en 3-6 meses."
    }
  ]
}

EJEMPLO DE OUTPUT INCORRECTO — NO HAGAS ESTO:
{
  "bullets": [
    "Tu presencia digital tiene bases técnicas aceptables pero déficits significativos.",
    "La visibilidad online es mejorable."
  ],
  "initiatives": [
    {
      "title": "Tu presencia digital global obtiene un 44/100",
      "description": "La infraestructura técnica aguanta, pero SEO, reputación social y medición están en estado crítico."
    }
  ]
}
Los bullets sin datos numéricos y las iniciativas que son diagnósticos en vez de acciones serán rechazados por el sistema de QA.

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin texto fuera del JSON):
{
  "summary": "1-2 frases ejecutivas con el dato clave que define la situación del negocio. Sin competidores si no hay datos de ellos.",
  "visibilitySummary": "Una frase sobre SEO orgánico, presencia en IA (GEO) y publicidad de pago — solo estos tres canales.",
  "benchmarkSummary": "Una frase sobre la posición competitiva en SEO y tráfico vs los principales competidores.",
  "experienceSummary": "Una frase sobre velocidad web móvil, funnel de conversión y madurez del stack de medición.",
  "bullets": [
    "Bullet 1: estado actual de un aspecto clave con dato citado en paréntesis",
    "Bullet 2",
    "Bullet 3",
    "Bullet 4",
    "Bullet 5",
    "Bullet 6"
  ],
  "initiatives": [
    {
      "title": "La acción #1 de mayor impacto para ESTE negocio (verbo + resultado)",
      "description": "2-3 frases: dato que demuestra el problema → qué hacer concretamente → resultado esperado con timeline"
    },
    {
      "title": "Acción #2 por prioridad de impacto",
      "description": "..."
    },
    {
      "title": "Acción #3 por prioridad de impacto",
      "description": "..."
    }
  ]
}`;
}
