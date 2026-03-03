import type { InsightsResult, ModuleResult } from '../types';

const API_KEY = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

export async function runInsights(
  url: string,
  results: Record<string, ModuleResult>,
): Promise<InsightsResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const summary = buildSummary(url, results);
  const prompt = buildPrompt(summary);

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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]);
    return {
      bullets: (parsed.bullets || []).slice(0, 6),
      initiatives: (parsed.initiatives || []).slice(0, 3),
    };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'Insights timed out (55s)' : err.message?.slice(0, 100);
    return { bullets: [], initiatives: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function buildSummary(url: string, r: Record<string, ModuleResult>): string {
  const domain = new URL(url.startsWith('http') ? url : `https://${url}`)
    .hostname.replace(/^www\./, '');

  const score      = r.score      as any;
  const crawl      = r.crawl      as any;
  const ssl        = r.ssl        as any;
  const ps         = r.pagespeed  as any;
  const sector     = r.sector     as any;
  const content    = r.content    as any;
  const geo        = r.geo        as any;
  const ig         = r.instagram  as any;
  const li         = r.linkedin   as any;
  const gbp        = r.gbp        as any;
  const traffic    = r.traffic    as any;
  const seo        = r.seo        as any;
  const techstack  = r.techstack  as any;
  const conversion = r.conversion as any;
  const competitors = r.competitors as any;

  const bd = score?.breakdown;

  const lines: string[] = [];

  // ── Identidad ────────────────────────────────────────────────────
  lines.push('=== IDENTIDAD DE LA MARCA ===');
  lines.push(`Dominio: ${domain}`);
  lines.push(`Sector: ${sector?.sector || 'desconocido'} (confianza: ${sector?.confidence ? Math.round(sector.confidence * 100) + '%' : '?'})`);
  lines.push(`Propuesta de valor detectada: "${content?.valueProposition || 'no detectada'}"`);
  lines.push(`CTA principal en la web: "${content?.cta || 'no detectado'}"`);
  lines.push(`Palabras en la web: ${crawl?.wordCount ?? '?'}`);

  // ── Score global ─────────────────────────────────────────────────
  lines.push('\n=== AION DIGITAL HEALTH SCORE ===');
  lines.push(`Score global: ${score?.total ?? '?'}/100`);
  if (bd) {
    lines.push(`  · Pilar 1 — Técnico:       ${bd.technical ?? '?'}/100`);
    lines.push(`  · Pilar 2 — SEO orgánico:  ${bd.seoVisibility ?? '?'}/100`);
    lines.push(`  · Pilar 3 — Contenido:     ${bd.content ?? '?'}/100`);
    lines.push(`  · Pilar 4 — Social/Rep.:   ${bd.socialReputation ?? '?'}/100`);
    lines.push(`  · Pilar 5 — Conversión:    ${bd.conversion ?? '?'}/100`);
    lines.push(`  · Pilar 6 — Medición:      ${bd.measurement ?? '?'}/100`);
  }

  // ── Técnico ──────────────────────────────────────────────────────
  lines.push('\n=== TÉCNICO (Pilar 1) ===');
  lines.push(`PageSpeed móvil: ${ps?.mobile?.performance ?? '?'}/100${ps?.mobile?.lcp ? ` · LCP ${ps.mobile.lcp}ms` : ''}`);
  lines.push(`PageSpeed escritorio: ${ps?.desktop?.performance ?? '?'}/100`);
  lines.push(`Accesibilidad: ${ps?.mobile?.accessibility ?? '?'}/100 · SEO Lighthouse: ${ps?.mobile?.seo ?? '?'}/100`);
  lines.push(`SSL: ${ssl?.valid ? 'válido' : 'inválido'}${ssl?.daysUntilExpiry ? ` (expira en ${ssl.daysUntilExpiry} días)` : ''}`);
  lines.push(`Schema.org: ${crawl?.hasSchemaMarkup ? 'sí' : 'no'} · Canonical: ${crawl?.hasCanonical ? 'sí' : 'no'} · Sitemap: ${crawl?.hasSitemap ? 'sí' : 'no'}`);

  // ── SEO orgánico ─────────────────────────────────────────────────
  lines.push('\n=== SEO ORGÁNICO (Pilar 2) — DataForSEO ===');
  if (!seo?.skipped && seo?.domainRank != null) {
    lines.push(`Domain Rank: ${seo.domainRank}/100 (0=sin autoridad, 100=dominio top mundial)`);
    lines.push(`Keywords en top 3: ${seo.keywordsTop3 ?? 0} · top 10: ${seo.keywordsTop10 ?? 0} · top 30: ${seo.keywordsTop30 ?? 0}`);
    lines.push(`Tráfico orgánico estimado: ${seo.organicTrafficEstimate ?? 0} visitas/mes`);
    lines.push(`Dominios referentes: ${seo.referringDomains ?? 0} · Backlinks totales: ${seo.backlinksTotal ?? 0}`);
  } else {
    lines.push('DataForSEO: no disponible');
  }

  // ── Tráfico Similarweb ───────────────────────────────────────────
  if (!traffic?.skipped && traffic?.visits) {
    lines.push('\n=== TRÁFICO — Similarweb ===');
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
  }

  return lines.join('\n');
}

function buildPrompt(summary: string): string {
  return `Eres el director de estrategia de AION Growth Studio, con 15 años de experiencia en growth y marketing digital. Acabas de completar un análisis automatizado de presencia digital. Tienes todos los datos a continuación.

Tu misión: redactar el diagnóstico ejecutivo que verá el dueño de la empresa cuando abra su informe. Debe sentirse como si lo hubiera escrito un consultor senior que se ha empapado a fondo de su negocio, no como un output genérico de IA.

DATOS DEL ANÁLISIS:
${summary}

REGLAS DE REDACCIÓN ESTRICTAS:
1. CADA bullet y CADA frase de iniciativa DEBE citar un dato específico del análisis en paréntesis, p.ej.: "(Domain Rank 18/100, por debajo del benchmark sectorial de 35)" o "(0 keywords en top 10 en Google)" o "(GEO nivel 1: la IA no menciona la marca en consultas de sector)".
2. Habla en términos de NEGOCIO, nunca de tecnología. Prohíbido: "canonical tags", "schema markup", "LCP", "CLS". Permitido: "tu web no aparece bien configurada para Google", "Google tarda más de 4 segundos en cargar tu página en móvil", "ningún asistente de IA menciona tu marca cuando alguien pregunta por servicios de [sector]".
3. El GEO score debe traducirse a impacto de negocio real: si score < 30, di que la marca es invisible para la IA; si > 60, destaca la ventaja competitiva.
4. Sé directo sobre las brechas más graves. No suavices lo que merece urgencia.
5. Las iniciativas deben fluir de los datos: si el funnel score es bajo, la primera iniciativa debe atacar la conversión con los datos exactos que lo demuestran.
6. Tono: experto que respeta al empresario. No condescendiente, no hiperentusiasta. Como un buen médico que te da el diagnóstico real.

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin texto fuera del JSON):
{
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
      "title": "Título de la iniciativa (máx. 6 palabras, orientado a resultado)",
      "description": "2-3 frases. La primera señala el problema con el dato que lo demuestra. La segunda explica qué harías. La tercera proyecta el resultado esperado en términos de negocio (leads, visibilidad, clientes)."
    },
    { "title": "...", "description": "..." },
    { "title": "...", "description": "..." }
  ]
}`;
}
