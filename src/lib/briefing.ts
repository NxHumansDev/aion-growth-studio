import type { ClientOnboarding } from './db';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

interface BriefingInput {
  onboarding: ClientOnboarding;
  auditResults: Record<string, any>;
  clientName: string;
  domain: string;
  clientContext?: string;  // Extended context from buildClientContext()
}

export interface BriefingFix {
  type: string;       // 'meta_description', 'meta_title', 'schema_organization', 'schema_faq', etc.
  content: string;    // The actual content to copy-paste
  where: string;      // Where to put it
}

export interface Briefing {
  summary: string;
  priorities: Array<{ title: string; description: string; impact: 'high' | 'medium' | 'low' }>;
  quickWins: string[];
  warnings: string[];
  fixes: BriefingFix[];
  generatedAt: string;
}

export async function generateBriefing(input: BriefingInput): Promise<Briefing> {
  if (!ANTHROPIC_API_KEY) {
    return fallbackBriefing(input);
  }

  const { onboarding: ob, auditResults: r, clientName, domain, clientContext } = input;

  // Build on-page issues from crawl data for Sonnet to act on
  const crawl = r.crawl || {};
  const onPageIssues: string[] = [];
  if (!crawl.description) onPageIssues.push('SIN META DESCRIPTION — Google genera una automática que no optimiza clicks');
  else if (crawl.description.length < 70) onPageIssues.push(`META DESCRIPTION CORTA (${crawl.description.length} chars) — actual: "${crawl.description.slice(0, 80)}"`);
  if (!crawl.hasSchemaMarkup) onPageIssues.push('SIN SCHEMA MARKUP — ni Organization ni FAQ ni Product. Google y las IAs no entienden tu negocio');
  if (!crawl.hasSitemap) onPageIssues.push('SIN SITEMAP.XML');
  if (!crawl.hasCanonical) onPageIssues.push('SIN CANONICAL TAG');
  if (crawl.imageCount > 0 && crawl.imagesWithAlt < crawl.imageCount) onPageIssues.push(`${crawl.imageCount - crawl.imagesWithAlt} IMÁGENES SIN ALT TEXT de ${crawl.imageCount}`);
  if (r.pagespeed?.mobile?.performance < 50) onPageIssues.push(`PAGESPEED MOBILE BAJO: ${r.pagespeed.mobile.performance}/100, LCP: ${r.pagespeed.mobile.lcp ? (r.pagespeed.mobile.lcp / 1000).toFixed(1) + 's' : '?'}`);
  if (!r.gbp?.found && ob.geo_scope === 'local_city') onPageIssues.push('SIN GOOGLE BUSINESS PROFILE — siendo negocio local es crítico');
  if (r.techstack?.maturityScore < 30) onPageIssues.push(`TECHSTACK MUY BÁSICO (${r.techstack.maturityScore}/100): ${!r.techstack.analytics?.length ? 'sin analytics, ' : ''}${!r.techstack.tagManager?.length ? 'sin tag manager' : ''}`);

  // Use extended context if available, otherwise build basic context
  const context = clientContext || `
EMPRESA: ${clientName} (${domain})
DESCRIPCIÓN: ${ob.business_description || 'No proporcionada'}
OBJETIVO PRINCIPAL: ${formatGoal(ob.primary_goal, ob.goal_detail)}
ZONA GEOGRÁFICA: ${formatGeo(ob.geo_scope, ob.geo_detail)}
ARQUITECTURA URLs: ${ob.url_architecture || 'URL única'}${ob.url_detail ? ` — ${ob.url_detail}` : ''}
PRESUPUESTO MARKETING: ${formatBudget(ob.monthly_budget)}
EQUIPO: ${formatTeam(ob.team_size)}
COMPETIDORES: ${(ob.competitors || []).map(c => c.url).join(', ') || 'No especificados'}

DATOS DE LA AUDITORÍA:
- Score total: ${r.score?.total ?? 'N/A'}/100
- SEO: ${r.seo?.keywordsTop10 ?? '?'} keywords top10, tráfico orgánico ${r.seo?.organicTrafficEstimate ?? '?'}
- GEO (IA): mention rate ${r.geo?.mentionRate ?? '?'}%
- PageSpeed mobile: ${r.pagespeed?.mobile?.performance ?? '?'}/100
- Conversión: funnel score ${r.conversion?.funnelScore ?? r.conversion?.score ?? '?'}
- Competidores detectados: ${(r.competitors?.competitors || []).map((c: any) => c.name || c.url).join(', ') || 'ninguno'}
- SSL: ${r.ssl?.valid ? 'válido' : 'problema'}
- TechStack maturity: ${r.techstack?.maturityScore ?? '?'}/100
- Blog activo: ${r.content_cadence?.cadenceLevel ?? 'no detectado'}
- GBP: ${r.gbp?.found ? `rating ${r.gbp.rating}` : 'no encontrado'}
- Title actual: "${crawl.title?.slice(0, 60) || 'sin título'}"
- Meta description actual: "${crawl.description?.slice(0, 160) || 'SIN META DESCRIPTION'}"
- H1: "${crawl.h1s?.[0]?.slice(0, 60) || 'sin H1'}"
- Schema types: ${(crawl.schemaTypes || []).join(', ') || 'ninguno'}
- Contenido: ${crawl.wordCount || '?'} palabras, ${crawl.h2Count || 0} H2s
${onPageIssues.length > 0 ? '\nPROBLEMAS ON-PAGE DETECTADOS:\n' + onPageIssues.map(i => `- ${i}`).join('\n') : ''}
`.trim();

  const historyRules = clientContext
    ? `
7. NO repitas recomendaciones que ya están completadas o en el plan estratégico del cliente.
8. NO sugieras acciones que el cliente descartó — respeta sus razones. Si la razón fue "muy caro", busca una alternativa más económica.
9. Ten en cuenta el plan estratégico actual: prioriza acciones que complementen lo que ya está haciendo.
10. Si una acción completada tuvo buen impacto verificado, sugiere acciones similares.
11. Referencia datos concretos de la evolución (ej: "tu score subió de X a Y esta semana").`
    : '';

  const prompt = `Eres el consultor de growth marketing de AION Growth Studio. Genera un briefing semanal personalizado para este cliente.

${context}

REGLAS:
1. Adapta el tono al tamaño del equipo: si es "Solo yo", sé muy práctico y no sugieras cosas que requieran equipo.
2. Adapta al presupuesto: si es 0€, no sugieras campañas paid.
3. Prioriza según el objetivo principal del cliente.
4. Usa datos concretos de la auditoría (números, no generalidades).
5. Si la zona es local, enfatiza SEO local y GBP. Si es multi-country, enfatiza hreflang y arquitectura.
6. Genera entre 2 y 5 recomendaciones (priorities), SIEMPRE ordenadas de mayor a menor impacto. No menos de 2, no más de 5.
7. Máximo 3 quick wins, máximo 2 warnings.
8. CRÍTICO — Cada recomendación debe ser una ACCIÓN EJECUTABLE CONCRETA, no un objetivo genérico. El cliente no es experto ni consultor. Guíale paso a paso.
   - MAL: "Mejorar visibilidad en IAs" (es un objetivo, no una acción)
   - BIEN: "Añadir schema FAQ en las 3 páginas principales con las preguntas frecuentes de tus clientes"
   - MAL: "Crear estrategia SEO" (demasiado vago)
   - BIEN: "Escribir un artículo de 1500 palabras sobre 'cómo elegir software RRHH para tu pyme' y publicarlo en /blog"
   - MAL: "Instalar Analytics" (sin guía)
   - BIEN: "Crear cuenta en analytics.google.com, copiar el código de medición G-XXXXXX y pegarlo en el <head> de tu web"
   El título debe empezar con un VERBO de acción (Crear, Escribir, Añadir, Configurar, Publicar, Optimizar).
   La descripción debe explicar POR QUÉ (dato del problema) + CÓMO hacerlo + TIEMPO estimado.
9. Quick wins deben ser completables en menos de 1 hora por alguien sin conocimientos técnicos.
10. GENERA CONTENIDO LISTO PARA USAR: si falta meta description, escríbela. Si falta schema markup, genera el JSON-LD. Si falta un title mejor, proponlo. El cliente debe poder copiar y pegar directamente.
11. Adapta el contenido generado al negocio, objetivo y público del cliente.${historyRules}

RESPONDE EN JSON VÁLIDO:
{
  "summary": "2-3 frases de resumen ejecutivo personalizado con datos concretos",
  "priorities": [
    {"title": "Verbo + acción concreta y específica", "description": "Por qué (dato concreto del problema) + Cómo hacerlo paso a paso + Tiempo estimado", "impact": "high|medium|low", "pillar": "seo|geo|web|conversion|content|reputation"}
  ],
  "quickWins": ["Acción rápida completable en <1 hora sin conocimientos técnicos"],
  "warnings": ["Riesgo o problema urgente 1"],
  "fixes": [
    {"type": "meta_description", "content": "Meta description optimizada de 120-155 caracteres con CTA implícito", "where": "Pegar en el <meta name=description> de la home"},
    {"type": "meta_title", "content": "Title optimizado de 50-60 chars con keyword principal", "where": "Pegar en el <title> de la home"},
    {"type": "schema_organization", "content": "JSON-LD de Organization completo para pegar en el <head>", "where": "Añadir en el <head> de todas las páginas"},
    {"type": "schema_faq", "content": "JSON-LD de FAQ con 3-5 preguntas frecuentes del negocio", "where": "Añadir en la página de FAQ o home"}
  ]
}

IMPORTANTE sobre fixes:
- Solo genera fixes para lo que realmente falta o está mal (según los PROBLEMAS ON-PAGE)
- El contenido debe ser FINAL, listo para copiar y pegar, no un placeholder
- Meta descriptions: incluye la keyword principal + propuesta de valor + CTA implícito
- Schema: genera JSON-LD válido y completo
- Si no hay problemas on-page, fixes puede ser un array vacío`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.error(`[briefing] API error ${res.status}`);
      return fallbackBriefing(input);
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallbackBriefing(input);

    const parsed = JSON.parse(jsonMatch[0]);
    // Ensure 2-5 priorities, ordered by impact (high first)
    const impactOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    let priorities = (parsed.priorities || []).slice(0, 5);
    priorities.sort((a: any, b: any) => (impactOrder[a.impact] ?? 1) - (impactOrder[b.impact] ?? 1));
    return {
      summary: parsed.summary || '',
      priorities,
      quickWins: (parsed.quickWins || parsed.quick_wins || []).slice(0, 3),
      warnings: (parsed.warnings || []).slice(0, 2),
      fixes: (parsed.fixes || []).filter((f: any) => f.content && f.type),
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[briefing] Error:', (err as Error).message);
    return fallbackBriefing(input);
  }
}

function fallbackBriefing(input: BriefingInput): Briefing {
  const r = input.auditResults;
  const score = r.score?.total ?? 0;
  const mobilePS = r.pagespeed?.mobile?.performance;
  return {
    summary: `${input.clientName} tiene un score de presencia digital de ${score}/100. Se recomienda completar el análisis para obtener un briefing personalizado.`,
    priorities: [
      { title: 'Completar perfil de empresa', description: 'Añade más contexto sobre tu negocio para recibir recomendaciones personalizadas.', impact: 'high' as const },
      { title: mobilePS && mobilePS < 60 ? `Mejorar PageSpeed mobile (${mobilePS}/100)` : 'Revisar velocidad de carga mobile', description: 'La velocidad de carga afecta al SEO y a la tasa de conversión.', impact: 'high' as const },
    ],
    quickWins: ['Verificar que SSL está activo', 'Comprobar velocidad de carga mobile'],
    warnings: score < 40 ? ['Score de presencia digital por debajo del umbral crítico'] : [],
    fixes: [],
    generatedAt: new Date().toISOString(),
  };
}

function formatGoal(goal?: string, detail?: string): string {
  const goals: Record<string, string> = {
    generate_leads: 'Generar leads / contactos',
    sell_online: 'Vender online (ecommerce)',
    brand_positioning: 'Posicionar la marca',
    local_traffic: 'Atraer clientes locales',
    other: detail || 'Otro',
  };
  return goals[goal || ''] || 'No especificado';
}

function formatGeo(scope?: string, detail?: string): string {
  const scopes: Record<string, string> = {
    local_city: 'Local (ciudad)',
    national: 'Nacional',
    multi_country: 'Multi-país',
    global: 'Global',
  };
  const base = scopes[scope || ''] || 'No especificado';
  return detail ? `${base} — ${detail}` : base;
}

function formatBudget(budget?: string): string {
  const budgets: Record<string, string> = {
    '0': 'Sin presupuesto',
    '<500': 'Menos de 500€/mes',
    '500-2000': '500–2.000€/mes',
    '2000-5000': '2.000–5.000€/mes',
    '>5000': 'Más de 5.000€/mes',
  };
  return budgets[budget || ''] || 'No especificado';
}

function formatTeam(team?: string): string {
  const teams: Record<string, string> = {
    solo: '1 persona (founder)',
    '2-5': '2–5 personas',
    '6-20': '6–20 personas',
    '>20': 'Más de 20 personas',
  };
  return teams[team || ''] || 'No especificado';
}
