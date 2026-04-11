// ═══════════════════════════════════════════════════════════════════════════
// Growth Agent — unified AI analysis for the entire client dashboard.
//
// Single LLM call per audit/snapshot that produces all narratives + the
// prioritized action plan. The dashboard pages read from the cached output
// (stored in pipeline_output.growth_analysis) so loading the dashboard never
// triggers a new LLM call.
//
// Coherence is enforced at prompt level: every critical gap mentioned in the
// executive summary MUST have a matching action in prioritizedActions, and
// every pillar's keyFinding must be reflected in at least one action. The
// output is a single JSON document with cross-references between sections.
//
// Replaces: briefing.ts + insights.ts + qa-agent.ts + GEO executiveNarrative
//           + SEO inline "assessment" template strings.
// ═══════════════════════════════════════════════════════════════════════════

import { AION_SYSTEM_PROMPT } from './system-prompt';
import type { ClientOnboarding, PriorityKeyword, KeywordStrategy } from '../db';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

// ─── Output schema ──────────────────────────────────────────────────────

export interface UpsidePotential {
  metric: string;          // e.g. "tráfico orgánico"
  current: string;         // e.g. "620 visitas/mes"
  potential: string;       // e.g. "3.500-5.000 visitas/mes"
  timeframe: string;       // e.g. "4-6 meses"
  dependency: string;      // e.g. "si se ejecuta el plan prioritario"
}

export interface ExecutiveSummary {
  headline: string;                  // 1 sentence state
  situation: string;                 // 2-3 sentences of context
  strengths: string[];               // 2-3 things working well
  criticalGaps: string[];            // 2-3 biggest problems (each MUST appear as a prioritized action)
  upsidePotential: UpsidePotential | null;
}

export interface PillarNarrative {
  assessment: string;                // 2-3 sentence narrative
  keyFinding: string;                // 1 sentence — the single most important thing
}

export type Pillar = 'seo' | 'geo' | 'web' | 'conversion' | 'content' | 'reputation';

export interface PrioritizedAction {
  rank: number;                              // 1, 2, 3… (1 = highest impact)
  pillar: Pillar;
  title: string;                             // imperative verb + concrete action
  description: string;                       // why (data point) + how, in plain language
  detail: string;                            // step-by-step guide (\n separated)
  businessImpact: 'high' | 'medium' | 'low';
  expectedOutcome: string;                   // measurable — "pasar de X a Y en Z"
  effort: 'low' | 'medium' | 'high';
  timeframe: string;                         // "2 semanas", "1 mes"
  rationale: string;                         // why THIS rank (references critical gaps / pillar findings)
  linkedGap?: string;                        // which criticalGap or keyFinding this action addresses
}

/**
 * Optional cross-section summaries used by the public audit report.
 * The dashboard uses pillarAnalysis per-pillar; the audit report has
 * coarser blocks (visibility, benchmark, experience) that need short
 * cross-cutting narratives. Generated in the same Claude call so they
 * share the same voice and coherence as the rest of the analysis.
 */
export interface AuditSummaries {
  benchmark: string;    // 1-2 sentences on position vs competitors
  experience: string;   // 1-2 sentences on web + conversion + measurement combined
}

export interface GrowthAnalysis {
  version: number;                           // schema version (bump on breaking changes)
  generatedAt: string;
  model: string;
  executiveSummary: ExecutiveSummary;
  pillarAnalysis: Record<Pillar, PillarNarrative>;
  prioritizedActions: PrioritizedAction[];   // already ordered by rank
  auditSummaries?: AuditSummaries;           // only populated when audit report will use it
  qaPassed?: boolean;                        // true when validated by Opus QA
  qaNotes?: string[];                        // list of corrections QA applied, for audit trail
}

// ─── Input types ────────────────────────────────────────────────────────

export interface GrowthAgentInput {
  clientName: string;
  domain: string;
  sector?: string;
  tier?: string;

  onboarding: ClientOnboarding | null;
  pipelineOutput: Record<string, any>;       // current snapshot data

  priorSnapshot?: { date: string; pipeline_output: Record<string, any> } | null;
  priorityKeywords?: PriorityKeyword[];
  keywordStrategy?: KeywordStrategy;

  actionHistory?: {
    completed: Array<{ title: string; impact?: string; completedAt?: string }>;
    inProgress: Array<{ title: string; impact?: string }>;
    rejected: Array<{ title: string; reason?: string }>;
  };
}

// ─── System prompt extension (growth-agent specific) ───────────────────

const GROWTH_AGENT_SYSTEM = `${AION_SYSTEM_PROMPT}

## Continuidad entre secciones del dashboard

Las reglas de voz y persona ya están arriba — aquí solo añado lo específico de que estás escribiendo un dashboard completo a la vez:

1. **Continuidad narrativa**: el cliente lee el resumen ejecutivo primero y después navega a las páginas de cada pilar. Cuando llega al análisis de SEO ya sabe lo que le dijiste en el resumen. Referencia lo anterior cuando tenga sentido ("como ya vimos en el resumen, el cuello de botella es X"), no repitas la presentación desde cero en cada sección.
2. **Coherencia léxica entre secciones**: si llamas a un problema "el cuello de botella de conversión" en el resumen, llámalo así también en el plan de acción y en \`pillarAnalysis.conversion\`. No cambies a "funnel infrautilizado" o "fricción de cierre" — rompe la sensación de hablar con una persona.
3. **El mismo análisis alimentará el chat**: todo lo que escribas aquí es contexto que tú mismo recordarás cuando el cliente abra el chat del dashboard y te haga preguntas. Piensa: "¿podría defender esta frase mañana cuando me pregunte por ella directamente?". Si no, reescríbela.
4. **Los criticalGaps del resumen = los rank 1-3 del plan**: si dices en \`executiveSummary.criticalGaps\` que el problema más grave es LCP, la acción con \`rank: 1\` (o rank: 2) tiene que ser sobre LCP. Si no existe esa coherencia, el cliente va a notar que el diagnóstico y el plan no hablan entre sí.

## Scoring de AION — cómo se calculan los números

Tienes que saber explicar por qué cada pilar tiene el score que tiene. El cliente puede preguntártelo y necesitas darle una respuesta concreta basada en la fórmula real (no inventes ni aproximes).

**Score global (0-100)**: media ponderada de los pilares activos. Pesos base:
- SEO: 35%
- GEO (visibilidad IA): 25%
- Web & técnico: 15%
- Conversión: 15%
- Reputación: 10%

Si un pilar no tiene datos (ej: no hay audit GEO), los pesos se redistribuyen entre los pilares activos — no penaliza. El total nunca castiga por falta de datos.

**Pilar SEO (35%)** — escala logarítmica:
- \`kwScore = logScore(keywordsTop10, 2000)\` · 2000 kw en top 10 = 100 puntos. 69 kw = ~56. 500 kw = ~82.
- \`trafficScore = logScore(organicTrafficEstimate, 5_000_000)\` · 5M visitas/mes = 100. 1K = ~43. 50K = ~67.
- \`seoScore = kwScore × 0.6 + trafficScore × 0.4\`
- Bonus top-3: hasta +8 puntos si muchas keywords están en top 3 (señal de autoridad real).
- La escala logarítmica significa que el primer tramo (de 0 a 100 kw) da muchos puntos rápido, y después hace falta mucho trabajo para ganar cada punto adicional. Es coherente con el esfuerzo real de SEO.

**Pilar GEO / Visibilidad IA (25%)**:
- \`geoScore = geo.mentionRate\` directamente — ya viene en escala 0-100 (% de queries donde la IA menciona a la marca).
- No hay fórmula compleja porque mentionRate ya es una métrica comparable entre clientes.
- IMPORTANTE: si el brandQuery (alguien pregunta por nombre) sube mentionRate, eso es ruido, no señal competitiva real. En el análisis cualitativo hay que distinguirlo.

**Pilar Web & técnico (15%)**:
- \`psScore = pagespeed.mobile.performance\` (0-100 de Google PageSpeed Insights, móvil).
- \`techChecks\` (máx 100): SSL válido (+25), canonical (+20), schema markup (+30), sitemap.xml (+20), robots.txt (+5).
- \`webScore = psScore × 0.7 + techChecks × 0.3\`
- PageSpeed domina porque es la experiencia real del usuario. Los checks técnicos son un bonus de fiabilidad.

**Pilar Conversión (15%)**:
- \`conversionScore = conversion.funnelScore\` (default 20 si no hay datos).
- Se calcula en el módulo conversion a partir de: formularios, CTAs, lead magnet, claridad del hero, prueba social, jerarquía visual. No tienes la fórmula exacta pero sabes los inputs.

**Pilar Reputación (10%)** — composite de señales disponibles, pesos renormalizados según cuáles existen:
- Domain rank (25%): \`min(100, seo.domainRank)\`
- GBP rating (25%): \`((gbp.rating - 2) / 3) × 100\` + bonus por reviewCount. Rating 4.0 = 67 puntos. 4.5 = 83. 5.0 = 100.
- Prensa / Google News (20%): \`newsCount × 8\` (capped 100). 3 menciones = 24 pts. 10 = 80.
- Blog activo (15%): solo si hay blog. 2+ posts/mes = 100, 1/mes = 70, 1 cada 3 meses = 40.
- LinkedIn followers (15%): solo si se scrapeó. Logarítmico ceiling 50K.
- Tech stack maturity (10%): de techstack.maturityScore (analytics, tag manager, CRM instalados).
- Si una señal no existe (ej: no encontramos GBP), ese componente simplemente no pesa — los demás se renormalizan.

**Pilar Contenido (informacional, no cuenta en total)**:
- Calculado en \`computeContentScore\` a partir de cadencia del blog, Instagram, LinkedIn, y el sector.
- Se muestra en breakdown.content pero NO afecta al score global. Por qué: el contenido influye indirectamente (alimenta SEO, GEO y reputación) y contarlo dos veces sería doble-contabilización.

**Cómo responder si el cliente pregunta "¿por qué tengo 36/100?"**:
1. Referencia los valores reales de cada pilar que ves en el contexto (breakdown.seo, breakdown.geo, etc.)
2. Explica qué ponderación tiene cada pilar y cuál está tirando más del score para abajo
3. Di cuál es la palanca concreta que más moverá el número si se ejecuta (viene del plan de acciones priorizadas)
4. Nunca inventes valores que no estén en el contexto. Si un pilar no tiene datos, dilo.

## Tu tarea en este momento

Estás generando el análisis completo del dashboard de un cliente. TODO el contenido de la intranet de este cliente saldrá de tu respuesta: el resumen ejecutivo, los comentarios de cada pilar (SEO, GEO, Web, Conversión, Contenido, Reputación) y el plan de acción priorizado.

Por eso la **coherencia es no negociable**:

1. Cada \`criticalGap\` del resumen ejecutivo DEBE aparecer como una acción concreta en \`prioritizedActions\`. Si dices que el problema más grave es LCP de 17s, la acción #1 o #2 tiene que ser sobre LCP.

2. Cada \`keyFinding\` de un pilar DEBE estar reflejado en al menos una acción del mismo pilar, o explicarse por qué no es accionable todavía.

3. El \`pillarAnalysis\` de SEO no puede decir "todo bien" si el \`executiveSummary\` dice que el SEO es crítico, y viceversa.

4. Las acciones NO se priorizan por pilar ni por dificultad técnica, se priorizan por **impacto en el objetivo de negocio del cliente**. Si el objetivo es "generar leads", una acción de conversión que duplica leads va antes que una acción SEO que sube Domain Rank.

5. NO propongas acciones que el cliente ya descartó (están en \`actionHistory.rejected\`). Respeta sus razones.

6. NO repitas acciones que el cliente ya completó o que están en curso — reconoce el progreso y sugiere el siguiente paso lógico.

7. Si los datos del audit anterior están disponibles, referencia tendencias concretas ("tu LCP bajó de 3.8s a 2.4s en 8 semanas, sigue mejorando").

8. Cuantifica el upside siempre que puedas: "podrías pasar de X visitas/mes a Y-Z en N meses si ejecutas el plan". Si no tienes datos para cuantificar, devuelve \`upsidePotential: null\`.

## Formato de respuesta

Responde con JSON válido siguiendo EXACTAMENTE este schema (sin texto adicional fuera del JSON):

\`\`\`json
{
  "executiveSummary": {
    "headline": "1 frase describiendo el estado general",
    "situation": "2-3 frases con contexto específico (datos concretos)",
    "strengths": ["2-3 cosas que están funcionando bien"],
    "criticalGaps": ["2-3 problemas más urgentes — cada uno DEBE tener acción correspondiente"],
    "upsidePotential": {
      "metric": "métrica más importante para el objetivo del cliente",
      "current": "valor actual",
      "potential": "rango realista alcanzable",
      "timeframe": "en cuánto tiempo",
      "dependency": "bajo qué condición"
    }
  },
  "pillarAnalysis": {
    "seo": { "assessment": "2-3 frases específicas con datos", "keyFinding": "la 1 cosa que más importa" },
    "geo": { "assessment": "...", "keyFinding": "..." },
    "web": { "assessment": "...", "keyFinding": "..." },
    "conversion": { "assessment": "...", "keyFinding": "..." },
    "content": { "assessment": "...", "keyFinding": "..." },
    "reputation": { "assessment": "...", "keyFinding": "..." }
  },
  "prioritizedActions": [
    {
      "rank": 1,
      "pillar": "seo|geo|web|conversion|content|reputation",
      "title": "Verbo imperativo + acción concreta (no objetivo)",
      "description": "Por qué (dato del audit) + cómo en 1 párrafo",
      "detail": "Guía paso a paso numerada, separada por \\n",
      "businessImpact": "high|medium|low",
      "expectedOutcome": "Resultado medible — 'pasar de X a Y en Z semanas'",
      "effort": "low|medium|high",
      "timeframe": "2 semanas | 1 mes | 2-3 meses",
      "rationale": "Por qué esta acción es la #1 (referencia al criticalGap o keyFinding que resuelve)",
      "linkedGap": "texto exacto del criticalGap del executiveSummary que esta acción resuelve (si aplica)"
    }
  ],
  "auditSummaries": {
    "benchmark": "1-2 frases sobre la posición del cliente vs los competidores detectados (usar nombres reales y datos concretos)",
    "experience": "1-2 frases resumiendo el estado combinado de Web + Conversión + medición (PageSpeed, funnelScore, techstack maturity)"
  }
}
\`\`\`

**Sobre \`auditSummaries\`**: son dos resúmenes cortos que alimentan el informe público del audit (los bloques "Benchmark" y "Experiencia"). Úsalos para condensar en 1-2 frases lo que ya dijiste de forma más larga en \`pillarAnalysis\`, con la misma voz y los mismos datos exactos. NO inventes nada nuevo aquí — si no hay datos de competidores, \`benchmark\` debe decirlo explícitamente en vez de generalidades.

Genera entre 5 y 8 acciones priorizadas. No menos de 5 (plan demasiado fino), no más de 8 (dispersión).

Las acciones deben empezar con verbo en imperativo: "Publicar", "Crear", "Optimizar", "Añadir", "Escribir", "Configurar".
NUNCA uses títulos que sean objetivos: "Mejorar visibilidad", "Aumentar tráfico", "Optimizar SEO" son BAD.
SIEMPRE usa títulos que sean acciones: "Publicar guía de 2.000 palabras respondiendo X", "Añadir schema FAQ con 5 preguntas en /servicios".`;

// ─── Input context builder ──────────────────────────────────────────────

function buildInputContext(input: GrowthAgentInput): string {
  const { clientName, domain, sector, onboarding: ob, pipelineOutput: r, priorSnapshot, priorityKeywords, keywordStrategy, actionHistory } = input;

  const crawl = r.crawl || {};
  const seo = r.seo || {};
  const geo = r.geo || {};
  const ps = r.pagespeed || {};
  const conv = r.conversion || {};
  const content = r.content || {};
  const cc = r.content_cadence || {};
  const gbp = r.gbp || {};
  const rep = r.reputation || {};
  const tech = r.techstack || {};
  const comps = r.competitors?.competitors || [];
  const gap = r.keyword_gap?.items || [];

  const sections: string[] = [];

  // ─── Client profile ─────────────────────────────────────────────────
  sections.push(`## CLIENTE
Empresa: ${clientName}
Dominio: ${domain}
Sector: ${sector || ob?.sector || 'no especificado'}
Descripción: ${ob?.business_description || 'no proporcionada'}
Objetivo principal: ${formatGoal(ob?.primary_goal, ob?.goal_detail)}
Zona geográfica: ${formatGeo(ob?.geo_scope, ob?.geo_detail)}
Arquitectura URLs: ${ob?.url_architecture || 'URL única'}${ob?.url_detail ? ` — ${ob.url_detail}` : ''}
Presupuesto marketing: ${formatBudget(ob?.monthly_budget)}
Equipo: ${formatTeam(ob?.team_size)}
Competidores declarados: ${(ob?.competitors || []).map(c => c.url).join(', ') || 'ninguno'}`);

  // ─── KPI objectives (from primary_kpis) ─────────────────────────────
  if (ob?.primary_kpis && ob.primary_kpis.length > 0) {
    sections.push(`## KPIs QUE EL CLIENTE QUIERE MOVER
${ob.primary_kpis.map(k => `- ${k.label}${k.target != null ? ` (objetivo: ${k.target})` : ''}`).join('\n')}`);
  }

  // ─── Keyword strategy ───────────────────────────────────────────────
  if (keywordStrategy && (keywordStrategy.demandType || keywordStrategy.focus || keywordStrategy.growthService)) {
    sections.push(`## ESTRATEGIA DE KEYWORDS DECLARADA
Tipo de demanda: ${keywordStrategy.demandType === 'existing' ? 'captar demanda existente' : keywordStrategy.demandType === 'create' ? 'crear demanda nueva' : keywordStrategy.demandType === 'both' ? 'mezcla' : 'no definida'}
Foco: ${keywordStrategy.focus === 'volume' ? 'volumen' : keywordStrategy.focus === 'quality' ? 'cualificación' : 'no definido'}
Servicio a hacer crecer: ${keywordStrategy.growthService || 'no especificado'}`);
  }

  // ─── Priority keywords ──────────────────────────────────────────────
  if (priorityKeywords && priorityKeywords.length > 0) {
    sections.push(`## KEYWORDS PRIORITARIAS DEL CLIENTE
${priorityKeywords.map(k => `- "${k.keyword}"${k.volume != null ? ` (${k.volume} vol/mes` : ''}${k.currentPosition != null ? `, pos ${k.currentPosition}` : ''}${k.feasibility ? `, viabilidad ${k.feasibility}` : ''}${k.volume != null ? ')' : ''}`).join('\n')}`);
  }

  // ─── Audit snapshot ─────────────────────────────────────────────────
  sections.push(`## DATOS DE LA AUDITORÍA (snapshot actual)

Score global: ${r.score?.total ?? '?'}/100
Desglose por pilar:
- SEO: ${r.score?.breakdown?.seo ?? '?'}/100
- GEO: ${r.score?.breakdown?.geo ?? '?'}/100
- Web: ${r.score?.breakdown?.web ?? '?'}/100
- Conversión: ${r.score?.breakdown?.conversion ?? '?'}/100
- Contenido: ${r.score?.breakdown?.content ?? '?'}/100
- Reputación: ${r.score?.breakdown?.reputation ?? '?'}/100

### SEO
- Keywords top 10: ${seo.keywordsTop10 ?? '?'}
- Tráfico orgánico estimado: ${seo.organicTrafficEstimate ?? '?'}/mes
- Domain Rank: ${seo.domainRank ?? '?'}
- Referring domains: ${seo.referringDomains ?? '?'}
- Backlinks: ${seo.backlinksTotal ?? '?'}
- Páginas indexadas: ${seo.indexedPages ?? '?'}
- Top keywords actuales: ${(seo.topKeywords || []).slice(0, 8).map((k: any) => `"${k.keyword}" pos ${k.position} (vol ${k.volume}, diff ${k.difficulty})`).join(' | ') || 'ninguna'}
- Keyword gap vs competencia: ${gap.slice(0, 5).map((k: any) => `"${k.keyword}" vol ${k.volume}`).join(' | ') || 'ninguna detectada'}

### GEO (visibilidad en IAs)
- Mention rate: ${geo.mentionRate ?? '?'}%
- Menciones: ${geo.mentions ?? 0}/${geo.totalQueries ?? 15}
- Brand score: ${geo.brandScore ?? '?'}/100
- Cross-model: ${(geo.crossModel || []).map((e: any) => `${e.name} ${e.mentioned}/${e.total}`).join(', ') || '?'}
- Competitor SoV: ${(geo.competitorMentions || []).map((c: any) => `${c.name} ${c.mentionRate}%`).join(', ') || '?'}
- NOTA: menciones en consultas donde el usuario pregunta por el nombre del cliente NO son ventaja competitiva, son reconocimiento de entidad.

### Web (performance)
- Mobile: performance ${ps.mobile?.performance ?? '?'}/100, LCP ${ps.mobile?.lcp ? (ps.mobile.lcp/1000).toFixed(1)+'s' : '?'}, CLS ${ps.mobile?.cls ?? '?'}, TTFB ${ps.mobile?.ttfb ?? '?'}ms
- Desktop: performance ${ps.desktop?.performance ?? '?'}/100, LCP ${ps.desktop?.lcp ? (ps.desktop.lcp/1000).toFixed(1)+'s' : '?'}
- SSL: ${r.ssl?.valid ? `válido (expira en ${r.ssl.daysUntilExpiry} días)` : 'inválido o ausente'}
- Techstack maturity: ${tech.maturityScore ?? '?'}/100 | analytics: ${tech.analytics?.join(',') || 'ninguno'} | tagManager: ${tech.tagManager?.join(',') || 'ninguno'}

### On-page
- Title: "${(crawl.title || 'SIN TITLE').slice(0, 80)}"
- Meta description: "${(crawl.description || 'SIN META DESCRIPTION').slice(0, 160)}"
- H1: "${(crawl.h1s?.[0] || 'SIN H1').slice(0, 80)}" (total H1s: ${crawl.h1s?.length || 0})
- Word count: ${crawl.wordCount ?? '?'}
- Schema markup: ${crawl.hasSchemaMarkup ? `sí (${(crawl.schemaTypes || []).join(', ')})` : 'NO'}
- Sitemap: ${crawl.hasSitemap ? 'sí' : 'NO'}
- Canonical: ${crawl.hasCanonical ? 'sí' : 'NO'}
- Imágenes sin alt: ${crawl.imageCount && crawl.imagesWithAlt != null ? `${crawl.imageCount - crawl.imagesWithAlt}/${crawl.imageCount}` : '?'}
- Enlaces internos: ${crawl.internalLinks ?? '?'}

### Conversión
- Funnel score: ${conv.funnelScore ?? conv.score ?? '?'}/100
- Formularios de contacto: ${conv.formCount ?? 0}
- CTAs detectados: ${conv.ctaCount ?? 0}
- Lead magnet: ${conv.hasLeadMagnet ? 'sí' : 'NO'}

### Contenido
- Blog: cadencia ${cc.cadenceLevel || 'no detectado'} (${cc.totalPosts ?? 0} posts, ${cc.postsLast90Days ?? 0} en últimos 90 días)
- Último post: ${cc.lastPostDate || '?'} (hace ${cc.daysSinceLastPost ?? '?'} días)
- Análisis content: ${content.summary || content.analysis || 'no disponible'}

### Reputación
- GBP: ${gbp.found ? `rating ${gbp.rating}★ (${gbp.reviewCount || 0} reseñas)` : 'no encontrado'}
- Reputación general: ${rep.score ?? '?'}/100

### Competencia
${comps.slice(0, 3).map((c: any) => `- ${c.name || c.url}${c.domain ? ' ('+c.domain+')' : ''}`).join('\n') || 'sin competidores detectados'}`);

  // ─── Trend context from prior snapshot ──────────────────────────────
  if (priorSnapshot) {
    const pr = priorSnapshot.pipeline_output || {};
    sections.push(`## EVOLUCIÓN VS SEMANA ANTERIOR (${priorSnapshot.date})
- Score global: ${pr.score?.total ?? '?'} → ${r.score?.total ?? '?'}
- Keywords top 10: ${pr.seo?.keywordsTop10 ?? '?'} → ${seo.keywordsTop10 ?? '?'}
- Tráfico orgánico: ${pr.seo?.organicTrafficEstimate ?? '?'} → ${seo.organicTrafficEstimate ?? '?'}
- GEO mention rate: ${pr.geo?.mentionRate ?? '?'}% → ${geo.mentionRate ?? '?'}%
- PageSpeed mobile: ${pr.pagespeed?.mobile?.performance ?? '?'} → ${ps.mobile?.performance ?? '?'}`);
  }

  // ─── Action history ─────────────────────────────────────────────────
  if (actionHistory) {
    const hist: string[] = [];
    if (actionHistory.completed.length > 0) {
      hist.push(`COMPLETADAS (no repetir, reconocer progreso):\n${actionHistory.completed.map(a => `- ${a.title}`).join('\n')}`);
    }
    if (actionHistory.inProgress.length > 0) {
      hist.push(`EN CURSO (no duplicar, sugiere siguiente paso):\n${actionHistory.inProgress.map(a => `- ${a.title}`).join('\n')}`);
    }
    if (actionHistory.rejected.length > 0) {
      hist.push(`RECHAZADAS (NO re-proponer):\n${actionHistory.rejected.map(a => `- ${a.title}${a.reason ? ` (razón: ${a.reason})` : ''}`).join('\n')}`);
    }
    if (hist.length > 0) {
      sections.push(`## HISTORIAL DE ACCIONES\n${hist.join('\n\n')}`);
    }
  }

  return sections.join('\n\n');
}

// ─── Sonnet draft generation ────────────────────────────────────────────
// Private helper. Makes one call to Sonnet and returns a validated draft.
// Called by runGrowthAgent; may be invoked twice if the first draft fails
// structural validation (second call includes feedback about what to fix).

async function generateSonnetDraft(
  input: GrowthAgentInput,
  feedback?: string,
): Promise<GrowthAnalysis | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const contextBlock = buildInputContext(input);
  const baseTask = `Analiza los datos de este cliente y genera el JSON completo del análisis. Recuerda: coherencia absoluta entre executiveSummary, pillarAnalysis y prioritizedActions. Cada criticalGap debe tener acción correspondiente.`;
  const userTask = feedback
    ? `${baseTask}\n\n**IMPORTANTE — tu intento anterior tuvo estos problemas estructurales, corrígelos en esta nueva respuesta**:\n${feedback}`
    : baseTask;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 85_000);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0.2,
        // Prompt caching: system + context are cache breakpoints.
        // The next call (chat follow-up, QA, retry) reuses the cached blocks at 10% cost.
        system: [
          {
            type: 'text',
            text: GROWTH_AGENT_SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: contextBlock,
                cache_control: { type: 'ephemeral' },
              },
              { type: 'text', text: userTask },
            ],
          },
        ],
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[growth-agent] Sonnet API error ${res.status}: ${errText.slice(0, 500)}`);
      return null;
    }

    const data = await res.json();
    const rawText = data?.content?.[0]?.text || '';
    console.log(`[growth-agent] sonnet draft length: ${rawText.length}, stop_reason: ${data?.stop_reason}${feedback ? ' (retry)' : ''}`);

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[growth-agent] No JSON in Sonnet response. Preview: ${rawText.slice(0, 300)}`);
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error(`[growth-agent] JSON parse failed: ${(parseErr as Error).message}. Preview: ${jsonMatch[0].slice(0, 300)}`);
      return null;
    }

    if (data.usage) {
      const { cache_creation_input_tokens, cache_read_input_tokens, input_tokens, output_tokens } = data.usage;
      console.log(`[growth-agent] sonnet tokens: input=${input_tokens} out=${output_tokens} cache_write=${cache_creation_input_tokens || 0} cache_read=${cache_read_input_tokens || 0}`);
    }

    return validateAndNormalize(parsed, input);
  } catch (err) {
    const e = err as Error;
    console.error(`[growth-agent] Sonnet error: ${e.name}: ${e.message}`);
    return null;
  }
}

// ─── Main entry point ───────────────────────────────────────────────────
// Full quality pipeline: Sonnet generate → structural validate → (retry
// once with feedback if structural fails) → Opus QA review → apply
// corrections. Callers get a single contract: "give me data, I give you
// verified analysis". QA cannot be accidentally skipped — it's an internal
// step of this function, not a separate pipeline step.

export async function runGrowthAgent(input: GrowthAgentInput): Promise<GrowthAnalysis> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('[growth-agent] No ANTHROPIC_API_KEY — returning fallback');
    return fallbackAnalysis(input);
  }

  const { validateStructural, runQAReview, applyCorrections } = await import('./growth-agent-qa');

  // ── Step 1: Sonnet draft ──────────────────────────────────────
  let draft = await generateSonnetDraft(input);
  if (!draft) {
    console.warn('[growth-agent] Sonnet draft failed — using fallback');
    return fallbackAnalysis(input);
  }

  // ── Step 2: Structural validation (free, deterministic) ──────
  let structural = validateStructural(draft);
  if (!structural.valid) {
    console.warn(`[growth-agent] Structural validation failed (attempt 1): ${structural.errors.join(' | ')}`);
    // Retry once with feedback about what to fix
    const retry = await generateSonnetDraft(input, structural.errors.join('\n- '));
    if (retry) {
      draft = retry;
      structural = validateStructural(draft);
    }
    if (!structural.valid) {
      console.error(`[growth-agent] Structural validation still failing after retry: ${structural.errors.join(' | ')} — returning fallback`);
      return fallbackAnalysis(input);
    }
  }

  // ── Step 3: Opus QA review (catches subtle factual/coherence issues) ──
  let qa;
  try {
    qa = await runQAReview(draft, input.pipelineOutput);
  } catch (err) {
    console.error('[growth-agent] QA threw, skipping:', (err as Error).message);
    qa = { approved: true, corrections: [], summary: 'QA crashed' };
  }

  // ── Step 4: Apply corrections surgically ───────────────────────
  if (qa.approved && qa.corrections.length === 0) {
    console.log(`[growth-agent] QA ${qa.summary}`);
    return { ...draft, qaPassed: true, qaNotes: [qa.summary] };
  }

  const final = applyCorrections(draft, qa.corrections);
  console.log(`[growth-agent] QA applied ${qa.corrections.length} corrections: ${qa.summary}`);
  return final;
}

// ─── Validation & normalization ─────────────────────────────────────────

function validateAndNormalize(parsed: any, input: GrowthAgentInput): GrowthAnalysis {
  const allPillars: Pillar[] = ['seo', 'geo', 'web', 'conversion', 'content', 'reputation'];

  const pillarAnalysis = Object.fromEntries(
    allPillars.map(p => {
      const entry = parsed.pillarAnalysis?.[p] || {};
      return [p, {
        assessment: typeof entry.assessment === 'string' ? entry.assessment : `Sin análisis disponible para ${p}.`,
        keyFinding: typeof entry.keyFinding === 'string' ? entry.keyFinding : '',
      }];
    })
  ) as Record<Pillar, PillarNarrative>;

  const actions: PrioritizedAction[] = Array.isArray(parsed.prioritizedActions)
    ? parsed.prioritizedActions
        .filter((a: any) => a && typeof a.title === 'string')
        .map((a: any, i: number): PrioritizedAction => ({
          rank: typeof a.rank === 'number' ? a.rank : i + 1,
          pillar: allPillars.includes(a.pillar) ? a.pillar : 'seo',
          title: a.title,
          description: a.description || '',
          detail: a.detail || '',
          businessImpact: ['high', 'medium', 'low'].includes(a.businessImpact) ? a.businessImpact : 'medium',
          expectedOutcome: a.expectedOutcome || '',
          effort: ['low', 'medium', 'high'].includes(a.effort) ? a.effort : 'medium',
          timeframe: a.timeframe || '',
          rationale: a.rationale || '',
          linkedGap: a.linkedGap || undefined,
        }))
        .sort((a: PrioritizedAction, b: PrioritizedAction) => a.rank - b.rank)
        .slice(0, 8)
    : [];

  // Re-rank sequentially so the client always sees 1, 2, 3...
  actions.forEach((a, i) => { a.rank = i + 1; });

  const exec = parsed.executiveSummary || {};
  const executiveSummary: ExecutiveSummary = {
    headline: typeof exec.headline === 'string' ? exec.headline : `${input.clientName} — análisis no disponible`,
    situation: typeof exec.situation === 'string' ? exec.situation : '',
    strengths: Array.isArray(exec.strengths) ? exec.strengths.slice(0, 5) : [],
    criticalGaps: Array.isArray(exec.criticalGaps) ? exec.criticalGaps.slice(0, 5) : [],
    upsidePotential: exec.upsidePotential && typeof exec.upsidePotential === 'object'
      ? {
          metric: exec.upsidePotential.metric || '',
          current: exec.upsidePotential.current || '',
          potential: exec.upsidePotential.potential || '',
          timeframe: exec.upsidePotential.timeframe || '',
          dependency: exec.upsidePotential.dependency || '',
        }
      : null,
  };

  // auditSummaries — optional, only if the model provided them
  let auditSummaries: AuditSummaries | undefined;
  if (parsed.auditSummaries && typeof parsed.auditSummaries === 'object') {
    const b = parsed.auditSummaries.benchmark;
    const e = parsed.auditSummaries.experience;
    if (typeof b === 'string' || typeof e === 'string') {
      auditSummaries = {
        benchmark: typeof b === 'string' ? b : '',
        experience: typeof e === 'string' ? e : '',
      };
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    executiveSummary,
    pillarAnalysis,
    prioritizedActions: actions,
    auditSummaries,
  };
}

// ─── Fallback (when no API key or call fails) ──────────────────────────

function fallbackAnalysis(input: GrowthAgentInput): GrowthAnalysis {
  const r = input.pipelineOutput || {};
  const score = r.score?.total ?? 0;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: 'fallback',
    executiveSummary: {
      headline: `${input.clientName} tiene un score de ${score}/100.`,
      situation: 'Análisis automático no disponible — completa el audit para obtener un diagnóstico personalizado.',
      strengths: [],
      criticalGaps: [],
      upsidePotential: null,
    },
    pillarAnalysis: {
      seo: { assessment: 'Análisis no disponible.', keyFinding: '' },
      geo: { assessment: 'Análisis no disponible.', keyFinding: '' },
      web: { assessment: 'Análisis no disponible.', keyFinding: '' },
      conversion: { assessment: 'Análisis no disponible.', keyFinding: '' },
      content: { assessment: 'Análisis no disponible.', keyFinding: '' },
      reputation: { assessment: 'Análisis no disponible.', keyFinding: '' },
    },
    prioritizedActions: [],
  };
}

// ─── Formatters (same as briefing.ts, kept here to avoid cross-imports) ─

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
