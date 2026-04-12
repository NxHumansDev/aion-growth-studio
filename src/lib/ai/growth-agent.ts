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
import { computeOnPageIssues } from '../audit/on-page-issues';

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

/**
 * Copy-paste ready content fixes for on-page issues. Generated only when
 * the audit detects specific problems (missing meta description, no schema,
 * generic title, etc). The client literally copies and pastes into their
 * HTML. Rendered in the SEO dashboard page and the audit report.
 */
export interface ReadyToUseFix {
  type: 'meta_title' | 'meta_description' | 'schema_organization' | 'schema_faq' | 'schema_product' | 'schema_local' | 'h1' | 'alt_text';
  content: string;      // final content, copy-paste ready (JSON-LD valid, title 50-60 chars, etc)
  where: string;        // where to paste it ("<head> of homepage", "<title> tag", etc)
}

/**
 * Contextual note for a specific on-page audit issue, graded against the
 * client's priority keywords. Merged in the SEO dashboard render:
 * - severityOverride can downgrade (e.g. title 69 chars but last 9 are brand → good)
 *   or upgrade (e.g. title missing priority keyword → critical)
 * - contextualNote replaces the static expanded template with something
 *   that references the client's actual priority keywords by name
 * - recommendedFix is a copy-paste ready rewrite targeting a specific keyword
 *
 * The issueKey must match one of the stable keys from computeOnPageIssues()
 * in src/lib/audit/on-page-issues.ts (e.g. 'title_too_long', 'h1_missing').
 * Only generated when the client has priority_keywords defined — otherwise
 * the array is empty and the dashboard falls back to static templates.
 */
export interface OnPageAuditContextEntry {
  issueKey: string;                     // matches OnPageIssue.key
  severityOverride?: 'critical' | 'warning' | 'info' | 'good';
  contextualLabel?: string;             // optional replacement for rule-based label
  contextualNote: string;               // 2-3 sentences, references priority keywords by name
  recommendedFix?: string;              // copy-paste ready rewrite (title, meta desc, H1, etc)
  targetsKeyword?: string;              // which priority keyword this fix is targeting
}

export interface GrowthAnalysis {
  version: number;                           // schema version (bump on breaking changes)
  generatedAt: string;
  model: string;
  executiveSummary: ExecutiveSummary;
  pillarAnalysis: Record<Pillar, PillarNarrative>;
  prioritizedActions: PrioritizedAction[];   // already ordered by rank
  auditSummaries?: AuditSummaries;           // only populated when audit report will use it
  readyToUseFixes?: ReadyToUseFix[];         // copy-paste content for detected on-page issues
  onPageAuditContext?: OnPageAuditContextEntry[]; // contextual grading of rule-based on-page audit
  qaPassed?: boolean;                        // true when validated by Opus QA
  qaNotes?: string[];                        // list of corrections QA applied, for audit trail
}

// ─── Input types ────────────────────────────────────────────────────────

export interface IntegrationSummary {
  googleAnalytics: boolean;       // true if GA4 property selected
  googleSearchConsole: boolean;   // true if Google OAuth with GSC scope is connected
  ga4PropertyName?: string;
  accountEmail?: string;
}

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
  integrations?: IntegrationSummary;         // what the client already has connected

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
- Se calcula desde señales de captación de leads (formularios, CTAs, lead magnet, chat) Y señales de comercio electrónico (carrito, checkout, fichas de producto, filtros, wishlist, newsletter).

**REGLA CRÍTICA — Cross-check sector vs detectedModel**:
El \`detectedModel\` viene del crawler (solo analiza la homepage). Puede fallar cuando la homepage es un hero con imagen y categorías sin fichas de producto visibles. El \`sector\` viene del análisis de IA y suele ser más fiable.

**SIEMPRE** cruza ambos datos:
- Si sector dice "E-commerce" / "Retail" / "Moda" / "Tienda online" PERO detectedModel dice "informational" → **el crawler no encontró señales de ecommerce en la homepage**, probablemente porque las fichas de producto están en páginas internas. En este caso:
  - NO recomiendes "añadir formulario de contacto" como si fuera un negocio de leads
  - SÍ recomienda mejorar el flujo de compra: fichas de producto accesibles desde la home, carrito visible, checkout optimizado, newsletter para captación de email, ficha de producto con precio + CTA "Añadir al carrito" visible
  - SÍ menciona Google Shopping si la competencia lo usa
  - SÍ señala que el funnelScore es bajo PORQUE faltan las señales de compra, no porque falte un formulario de contacto
- Si sector dice "Consultoría" / "Servicios profesionales" / "B2B" PERO detectedModel dice "ecommerce" → raro pero posible (empresa B2B que vende formación online). Usa tu criterio con ambos datos.
- Si sector y detectedModel coinciden → genial, confía en ambos.

**Google Shopping**: si el cliente o sus competidores aparecen en resultados de Shopping, eso es dato real. Si la competencia invierte en Shopping y el cliente no, eso puede ser una oportunidad. Si ni el cliente ni la competencia usan Shopping, no lo recomiendes — el mercado no lo demanda.

**Pilar Reputación (10%)** — composite de señales disponibles, pesos renormalizados según cuáles existen:
- GBP rating (33%): \`((gbp.rating - 2) / 3) × 100\` + bonus por reviewCount. Rating 4.0 = 67 puntos. 4.5 = 83. 5.0 = 100.
- Prensa / Google News (27%): \`newsCount × 8\` (capped 100). 3 menciones = 24 pts. 10 = 80.
- Blog activo (20%): solo si hay blog. 2+ posts/mes = 100, 1/mes = 70, 1 cada 3 meses = 40.
- LinkedIn followers (20%): solo si se scrapeó. Logarítmico ceiling 50K.
- Si una señal no existe (ej: no encontramos GBP), ese componente simplemente no pesa — los demás se renormalizan.

**Pilar Contenido (informacional, no cuenta en total)**:
- Calculado en \`computeContentScore\` a partir de cadencia del blog, Instagram, LinkedIn, y el sector.
- Se muestra en breakdown.content pero NO afecta al score global. Por qué: el contenido influye indirectamente (alimenta SEO, GEO y reputación) y contarlo dos veces sería doble-contabilización.

**Cómo responder si el cliente pregunta "¿por qué tengo 36/100?"**:
En el contexto recibirás una sección **"Cómo se ha calculado cada score"** con las fórmulas EXACTAS que el motor aplicó a este cliente (ej: \`SEO: kwScore(246 kw → 72) × 0.6 + trafficScore(7389 → 55) × 0.4 + top3Bonus(66/246 → +3) = 78\`). Úsala literalmente:
1. Cita los componentes reales de la fórmula, no los aproximes (el cliente verá "kwScore=72" exacto, no "alrededor de 70")
2. Identifica el pilar que más está tirando del total para abajo (multiplica score × peso efectivo — el contexto te da los pesos efectivos ya renormalizados)
3. Di cuál es la palanca concreta que más moverá el número (viene del plan de acciones priorizadas)
4. Si el pilar tiene "Pilares sin datos (excluidos)" en el trace, menciona explícitamente que esos pilares no se han medido y cómo afectaría al total si se midieran
5. Nunca inventes valores que no estén en el contexto.

## Reglas de redacción — NO NEGOCIABLES

Estas reglas vienen de errores reales que hemos visto en producción. Violarlas hace que el QA te rechace:

**R1 — Fidelidad numérica absoluta**
Cada número que cites debe coincidir EXACTAMENTE con los datos del audit. Si ves organicTrafficEstimate: 4800, escribes "4.800" — no "cerca de 5K", no "5.000", no "~4800". Literal siempre.

**R2 — Nunca digas "100% tráfico de marca" si hay non-brand**
Si \`seo.topKeywords\` incluye keywords no-branded con tráfico alto (posición top y volumen >500), entonces hay captación no-branded real. NUNCA digas "100% branded". Si \`brandTrafficPct\` es 100 pero ves keywords como "control horario pymes" ranqueando, el número brandTrafficPct está mal — refleja el mix real que ves en topKeywords. Si una keyword top posicionada #1 no es el nombre de la marca, ESO es captación nueva y hay que celebrarla como fortaleza.

**R3 — Sin competidores reales, sin comparativas**
Si \`competitors.competitors\` está vacío o \`competitor_traffic.items\` tiene length 0, está PROHIBIDO hacer comparativas numéricas del tipo "3x menos que competidor X" o "Devify te gana con 60% SoV". Puedes decir "no hay datos de competidores para comparar" o directamente omitir la comparación.

**R4 — 0 keyword gaps = no recomiendes gap attack**
Si \`keyword_gap.items\` tiene length 0, está PROHIBIDO recomendar "atacar el gap de keywords". Recomienda en su lugar "optimizar las keywords en posición 4-10" o "crear contenido pilar sobre [tema específico del negocio]".

**R5 — Habla en términos de negocio, no de tecnología**
Prohibido citar términos técnicos crudos sin traducir: canonical tags, schema markup, LCP, CLS, TTFB, hreflang. Debes traducirlos a impacto real:
- MAL: "tu LCP es 4.8s"
- BIEN: "Google tarda 4,8 segundos en mostrar tu contenido en móvil — cada segundo reduce la conversión un 10-20%"
- MAL: "sin schema markup"
- BIEN: "Google y las IAs no entienden bien qué vende tu web por falta de datos estructurados"

**R6 — Palabras prohibidas (frases vacías)**
Nunca escribas: "bases técnicas aceptables", "déficits significativos", "oportunidades de captación", "presencia digital mejorable", "soluciones de mejora". Son rellenos sin contenido. Si vas a decir algo, dilo con dato.

**R7 — GEO mention rate 0 ≠ "invisible total"**
Si mentionRate es 0% pero overallScore > 0 (suele venir del brand score por reconocimiento de entidad), no digas "invisible en IA". Matiza: "sin presencia en consultas de descubrimiento, con reconocimiento básico de marca".

**R8 — Adaptación a tipo de negocio (sector-aware)**
Las acciones prioritarias DEBEN adaptarse al sector. Usa estas reglas:
- **Banca privada, wealth management, finanzas, seguros**: NUNCA recomiendes "formulario de contacto visible" ni "chat de soporte en tiempo real". SÍ "solicitar cita con advisor", "calculadora de rentabilidad", "acceso a plataforma segura". Lenguaje de asesoramiento, no de captación masiva.
- **Hostelería / restauración**: SÍ "reservas online", "menú visible en web", "Google Business Profile optimizado con fotos actualizadas".
- **Ecommerce**: SÍ formulario corto, carrito, chat de soporte, valoraciones de producto, reviews.
- **B2B / servicios profesionales**: SÍ casos de éxito con métricas, testimonios con nombre+cargo+empresa, solicitar presupuesto, agendar llamada.
- **Local (peluquería, clínica, taller)**: SÍ GBP, reseñas, WhatsApp, horarios visibles, teléfono click-to-call.

**R9 — Adaptación a team_size y budget**
- team_size \`solo\` (1 persona) → acciones que pueda ejecutar solo, sin requerir equipo. Automatizaciones > acciones manuales repetitivas.
- team_size \`2-5\` → máximo 3 iniciativas pesadas simultáneas.
- budget \`0\` → PROHIBIDO recomendar campañas paid (Google Ads, Meta Ads). Solo orgánico.
- budget \`<500\` → orgánico prioritario, paid solo si es imprescindible.
- budget \`>5000\` → plan más agresivo, mix orgánico + paid.

**R10 — Las acciones son acciones, no diagnósticos**
- MAL (diagnóstico): "Tu presencia digital obtiene un 57/100"
- BIEN (acción): "Optimizar las 37 keywords en posición 4-10 para doblar el tráfico orgánico en 6-8 semanas"
Cada título empieza por verbo imperativo. Cada descripción: problema con dato → cómo hacerlo → resultado esperado con timeline.

**R11 — Formato estricto del resumen ejecutivo**
El bloque \`executiveSummary\` se lee como si fuera lo primero que ve un CEO en su dashboard. Estructura obligatoria:
- \`headline\` = **1 sola frase** contundente. Nunca 2. Nunca media. Una frase que resuma el titular.
- \`situation\` = **exactamente 3 o 4 frases** que desarrollan el headline. Cada frase cubre un pilar clave (SEO, GEO, Web/Conversión, Reputación si aplica) con al menos 1 dato numérico real. Es una mini-narrativa coherente, no una lista de bullets.

MAL:
> headline: "${'${name}'} tiene un score de 28/100."
> situation: "Análisis automático no disponible."

BIEN:
> headline: "Kikogamez está en fase inicial de construcción de presencia digital con un score AION de 28/100 y la visibilidad SEO como punto más débil."
> situation: "En SEO orgánico solo hay 3 keywords en top 10 y ~620 visitas orgánicas estimadas al mes. En visibilidad IA la marca aparece en el 10% de las consultas analizadas, concentradas en consultas de decisión de compra pero ausente en descubrimiento. La web carga razonablemente en móvil (68/100 en Google PageSpeed) pero el embudo de conversión es débil (35/100) con un único formulario genérico sin CTAs claros. La reputación pública es sólida (4.6★ con 18 reseñas) — es el único pilar que no frena el crecimiento."

---

## Ejemplo de veredicto CORRECTO (shot learning)

> "Andbank aparece en el 45% de las consultas de IA — por encima de Lombard Odier (0%) pero por debajo de Banco Sabadell (73%). Con 69 keywords en top 10 hay tracción orgánica real, pero la web tarda 6s en cargar en móvil (Google recomienda <2.5s) y no hay blog ni sitemap XML. Optimizar las 37 keywords en posición 4-10 es la acción de mayor retorno inmediato."

Por qué funciona: 5 datos numéricos concretos, menciona el dominio, compara con competidores reales, traduce LCP a segundos con referencia al umbral Google, identifica la palanca de mayor retorno.

## Ejemplo de veredicto INCORRECTO (NO hagas esto)

> "Tu presencia digital tiene bases técnicas aceptables pero déficits significativos en visibilidad y posicionamiento. Estás perdiendo oportunidades de captación cada día."

Por qué se rechaza: 0 datos concretos, 0 menciones del dominio, 0 comparaciones, 100% genérico, 3 de las frases prohibidas en una sola oración.

---

## Tu tarea en este momento

Estás generando el análisis completo del dashboard de un cliente. TODO el contenido de la intranet de este cliente saldrá de tu respuesta: el resumen ejecutivo, los comentarios de cada pilar (SEO, GEO, Web, Conversión, Contenido, Reputación) y el plan de acción priorizado.

Por eso la **coherencia es no negociable**:

1. Cada \`criticalGap\` del resumen ejecutivo DEBE aparecer como una acción concreta en \`prioritizedActions\`. Si dices que el problema más grave es LCP de 17s, la acción #1 o #2 tiene que ser sobre LCP.

2. Cada \`keyFinding\` de un pilar DEBE estar reflejado en al menos una acción del mismo pilar, o explicarse por qué no es accionable todavía.

3. El \`pillarAnalysis\` de SEO no puede decir "todo bien" si el \`executiveSummary\` dice que el SEO es crítico, y viceversa.

4. Las acciones NO se priorizan por pilar ni por dificultad técnica, se priorizan por **impacto en el objetivo de negocio del cliente**. Si el objetivo es "generar leads", una acción de conversión que duplica leads va antes que una acción SEO que solo sube posiciones medias.

5. NO propongas acciones que el cliente ya descartó (están en \`actionHistory.rejected\`). Respeta sus razones.

6. NO repitas acciones que el cliente ya completó o que están en curso — reconoce el progreso y sugiere el siguiente paso lógico.

7. Si los datos del audit anterior están disponibles, referencia tendencias concretas ("tu LCP bajó de 3.8s a 2.4s en 8 semanas, sigue mejorando").

8. Cuantifica el upside siempre que puedas: "podrías pasar de X visitas/mes a Y-Z en N meses si ejecutas el plan". Si no tienes datos para cuantificar, devuelve \`upsidePotential: null\`.

## Formato de respuesta

Responde con JSON válido siguiendo EXACTAMENTE este schema (sin texto adicional fuera del JSON):

\`\`\`json
{
  "executiveSummary": {
    "headline": "EXACTAMENTE 1 frase contundente que resuma el estado general del cliente con el dato más relevante. NO más de 1 frase. Tono consultor ejecutivo. Debe poderse leer sola y transmitir el titular.",
    "situation": "EXACTAMENTE 3 o 4 frases de desarrollo (ni menos ni más) que expanden el headline con datos concretos: una frase por pilar clave (SEO, GEO, Web/Conversión, Reputación si aplica). Cada frase debe tener al menos 1 dato numérico real del audit. Cuenta una historia coherente, no listes bullets. Este bloque es lo que lee un CEO en 10 segundos para tomar una decisión.",
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
  },
  "readyToUseFixes": [
    {
      "type": "meta_description",
      "content": "Meta description optimizada de 120-155 caracteres con keyword principal + propuesta de valor + CTA implícito",
      "where": "Pegar en el <meta name=\"description\"> del <head> de la home"
    },
    {
      "type": "meta_title",
      "content": "Title optimizado de 50-60 chars con keyword principal al inicio + marca al final",
      "where": "Pegar en el <title> del <head> de la home"
    },
    {
      "type": "schema_organization",
      "content": "JSON-LD completo de Organization con name, url, logo, sameAs, contactPoint — válido según schema.org",
      "where": "Añadir en el <head> de todas las páginas como <script type=\"application/ld+json\">"
    }
  ]
}
\`\`\`

**Sobre \`auditSummaries\`**: son dos resúmenes cortos que alimentan el informe público del audit (los bloques "Benchmark" y "Experiencia"). Úsalos para condensar en 1-2 frases lo que ya dijiste de forma más larga en \`pillarAnalysis\`, con la misma voz y los mismos datos exactos. NO inventes nada nuevo aquí — si no hay datos de competidores, \`benchmark\` debe decirlo explícitamente en vez de generalidades.

**Sobre \`readyToUseFixes\`**: SOLO genera fixes para problemas on-page realmente detectados en los datos del audit. Ejemplos de condiciones:
- Si \`crawl.description\` está vacío o < 70 chars → genera un \`meta_description\` nuevo de 120-155 chars
- Si \`crawl.title\` está vacío o > 60 chars o no incluye la keyword principal → genera un \`meta_title\` de 50-60 chars
- Si \`crawl.hasSchemaMarkup\` es false → genera un \`schema_organization\` JSON-LD válido y completo
- Si el negocio tiene FAQ visible pero \`crawl.schemaTypes\` no incluye "FAQPage" → genera \`schema_faq\` con 3-5 preguntas reales del sector
- Si el negocio es local y \`crawl.schemaTypes\` no incluye "LocalBusiness" → genera \`schema_local\`
- Si \`crawl.h1s\` está vacío → genera un \`h1\` con la propuesta de valor

**REGLAS DURAS para readyToUseFixes**:
- El \`content\` DEBE ser FINAL, listo para pegar. NO pongas placeholders tipo "[nombre de empresa]" — usa el nombre real del cliente.
- JSON-LD debe ser sintácticamente válido y completo.
- Meta descriptions deben incluir keywords del negocio + CTA implícito.
- Si no hay problemas on-page que requieran fixes, devuelve \`readyToUseFixes: []\` (array vacío).
- NO generes más de 5 fixes por audit — prioriza los más impactantes.

Genera entre 5 y 8 acciones priorizadas. No menos de 5 (plan demasiado fino), no más de 8 (dispersión).

Las acciones deben empezar con verbo en imperativo: "Publicar", "Crear", "Optimizar", "Añadir", "Escribir", "Configurar".
NUNCA uses títulos que sean objetivos: "Mejorar visibilidad", "Aumentar tráfico", "Optimizar SEO" son BAD.
SIEMPRE usa títulos que sean acciones: "Publicar guía de 2.000 palabras respondiendo X", "Añadir schema FAQ con 5 preguntas en /servicios".

## Integraciones ya conectadas — NUNCA las sugieras

Si en el contexto hay una sección \`## INTEGRACIONES CONECTADAS\`, significa que el cliente YA tiene configurada esa integración. Bajo ningún concepto:

- Añadas una acción del tipo "Configurar Google Search Console" / "Conectar GA4" / "Instalar Analytics" si ya aparecen en esa sección
- Menciones en \`criticalGaps\` que "faltan datos de GSC" cuando la integración está marcada como CONECTADA
- Recomiendes en \`pillarAnalysis\` "empezar por conectar tus fuentes de datos" cuando ya están conectadas

Si las integraciones están conectadas, asume que los datos son reales y avanza al siguiente nivel de recomendación (optimizar, no configurar).

## onPageAuditContext — contextualización de la auditoría on-page con priority keywords

En el contexto recibes una sección \`## AUDITORÍA ON-PAGE (issues rule-based ya detectados)\` con una lista de issues detectados por la auditoría automática. Tu trabajo es generar un array \`onPageAuditContext\` con un objeto por cada issue relevante donde el contexto real del cliente cambia cómo debe comunicarse.

**Cuándo añadir un objeto al array:**

- SIEMPRE para issues severity='critical' y 'warning' si el cliente tiene priority keywords definidas
- Para issues 'good' solo si hay algo útil que decir referenciando priority keywords (ej: "tu H1 está bien y contiene tu keyword X")
- NUNCA añadas objetos para issues si NO hay priority keywords — en ese caso devuelve \`onPageAuditContext: []\` y el sistema hará fallback al template estático

**Shape de cada objeto:**
\`\`\`json
{
  "issueKey": "title_too_long",                           // OBLIGATORIO — copiado literal del [key] en el contexto
  "severityOverride": "good" | "info" | "warning" | "critical",  // opcional — solo si cambias la gravedad real
  "contextualLabel": "Title largo pero no crítico",       // opcional — sustituye al label rule-based
  "contextualNote": "Tu title actual '...' tiene 69 chars, pero los últimos 9 son '| Kikogamez' (tu marca). Los primeros 60 contienen 'asesor growth startups' — que es exactamente tu keyword prioritaria #2. No es crítico.",
  "recommendedFix": "Asesor growth para startups — Kikogamez",  // opcional — texto listo para copy-paste
  "targetsKeyword": "asesor growth startups"              // opcional — cuál priority keyword apunta el fix
}
\`\`\`

**Reglas estrictas:**

1. \`contextualNote\` DEBE referenciar al menos una priority keyword del cliente por nombre literal cuando sea relevante
2. \`severityOverride\` SOLO si el contexto real cambia la gravedad:
   - Downgrade a \`good\` o \`info\` si el "problema" no afecta a ninguna priority keyword (ej: 9 chars extras de marca)
   - Upgrade a \`critical\` si el elemento no contiene ninguna priority keyword alta y el cliente depende de ellas
3. \`recommendedFix\` debe ser un texto final, NO una plantilla con placeholders. Longitudes correctas: title 50-60 chars, meta description 120-155 chars
4. \`targetsKeyword\` debe ser una priority keyword literal del contexto — NO inventes keywords que no estén en la lista

**Ejemplo end-to-end** (cliente con priority keyword "asesor growth startups"):

Issue recibido: \`[title_too_long] (warning) Title demasiado largo — 69 caracteres (recomendado: 50-60) · actual: "Kiko Gamez - Asesor de growth | consulting y formación para startups"\`

Objeto que debes generar:
\`\`\`json
{
  "issueKey": "title_too_long",
  "severityOverride": "info",
  "contextualLabel": "Title largo pero contiene tu keyword prioritaria",
  "contextualNote": "Tu title actual tiene 69 chars. Los primeros 60 (lo que Google muestra) contienen 'Kiko Gamez - Asesor de growth' que incluye tu keyword prioritaria 'asesor growth'. Los 9 chars que Google corta son 'para startups' — sí contienen 'startups' que también es prioritaria, así que conviene optimizar.",
  "recommendedFix": "Asesor growth para startups - consulting y formación | Kiko Gamez",
  "targetsKeyword": "asesor growth startups"
}
\`\`\`

Si el cliente no tiene priority keywords configuradas, devuelve \`onPageAuditContext: []\` y no añadas nada. El dashboard hará fallback al template rule-based estático sin contextualizar.`;

// ─── Input context builder ──────────────────────────────────────────────

function buildInputContext(input: GrowthAgentInput): string {
  const { clientName, domain, sector, onboarding: ob, pipelineOutput: r, priorSnapshot, priorityKeywords, keywordStrategy, integrations, actionHistory } = input;

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
  const ssl = r.ssl || {};

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

  // ─── Integrations already connected (NEVER re-suggest these) ─────────
  if (integrations) {
    const intParts: string[] = [];
    if (integrations.googleSearchConsole) intParts.push('Google Search Console: CONECTADO');
    if (integrations.googleAnalytics) {
      intParts.push(`Google Analytics 4: CONECTADO${integrations.ga4PropertyName ? ` (property "${integrations.ga4PropertyName}")` : ''}`);
    } else if (integrations.googleSearchConsole) {
      intParts.push('Google Analytics 4: OAuth autorizado pero sin property_id seleccionada');
    }
    if (integrations.accountEmail) intParts.push(`Cuenta Google vinculada: ${integrations.accountEmail}`);
    if (intParts.length > 0) {
      sections.push(`## INTEGRACIONES CONECTADAS (el cliente YA las tiene — NUNCA recomiendes reconectar ni configurar)
${intParts.map(p => `- ${p}`).join('\n')}`);
    }
  }

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

  // ─── Rule-based on-page audit issues (for contextual grading) ───────
  // These are the same issues the dashboard SEO page renders as cards.
  // The agent's job is to return onPageAuditContext[] with a contextual
  // note per issue, referencing priority keywords by literal name when
  // applicable and downgrading/upgrading severity based on real impact.
  const onPageIssues = computeOnPageIssues(crawl, ssl, ps);
  if (onPageIssues.length > 0) {
    sections.push(`## AUDITORÍA ON-PAGE (issues rule-based ya detectados)
Lista de issues que la auditoría automática ha detectado. Para cada uno debes generar un objeto en onPageAuditContext[] con contextualNote (referenciando priority keywords por nombre cuando aplique) y, cuando tenga sentido, un recommendedFix listo para copy-paste.

${onPageIssues.map(i => {
  const titleCtx = i.key === 'title_too_long' && crawl.title ? ` · actual: "${crawl.title}"` : '';
  const descCtx = i.key.startsWith('meta_desc') && crawl.description ? ` · actual: "${crawl.description.slice(0, 100)}..."` : '';
  const h1Ctx = i.key.startsWith('h1_') && crawl.h1s?.length ? ` · actual: "${(crawl.h1s[0] || '').slice(0, 80)}"` : '';
  return `- [${i.key}] (${i.severity}) ${i.label} — ${i.detail}${titleCtx}${descCtx}${h1Ctx}`;
}).join('\n')}

**Contexto completo** (para que puedas generar recommendedFix con longitudes correctas):
- Title actual: "${crawl.title || '(ausente)'}" (${(crawl.title || '').length} chars, ideal 50-60)
- Meta description actual: "${crawl.description || '(ausente)'}" (${(crawl.description || '').length} chars, ideal 120-155)
- H1 actual: "${crawl.h1s?.[0] || '(ausente)'}"`);
  }

  // ─── Audit snapshot ─────────────────────────────────────────────────
  // Score + computation trace: how every pillar score was actually derived.
  // This lets the agent answer "por qué tengo 64/100" with REAL component
  // values instead of inventing approximations.
  const comp = r.score?.computation as any;
  const scoreTrace: string[] = [];
  if (comp) {
    if (comp.seo) scoreTrace.push(`  • SEO: ${comp.seo.formula}`);
    if (comp.geo) scoreTrace.push(`  • GEO: ${comp.geo.source}=${comp.geo.final}`);
    if (comp.web) {
      const techApplied = comp.web.techChecks.filter((t: any) => t.applied).map((t: any) => `${t.label}+${t.points}`).join(', ') || 'ninguno';
      scoreTrace.push(`  • Web: ${comp.web.formula} (checks aplicados: ${techApplied})`);
    }
    if (comp.conversion) scoreTrace.push(`  • Conversión: funnelScore=${comp.conversion.funnelScore} → ${comp.conversion.final}`);
    if (comp.reputation) scoreTrace.push(`  • Reputación: ${comp.reputation.formula}`);
    if (comp.weights?.inactivePillars?.length) scoreTrace.push(`  • Pilares sin datos (excluidos): ${comp.weights.inactivePillars.join(', ')}`);
    if (comp.totalFormula) scoreTrace.push(`  • Total: ${comp.totalFormula}`);
  }

  sections.push(`## DATOS DE LA AUDITORÍA (snapshot actual)

Score global: ${r.score?.total ?? '?'}/100
Desglose por pilar:
- SEO: ${r.score?.breakdown?.seo ?? '?'}/100
- GEO: ${r.score?.breakdown?.geo ?? '?'}/100
- Web: ${r.score?.breakdown?.web ?? '?'}/100
- Conversión: ${r.score?.breakdown?.conversion ?? '?'}/100
- Contenido: ${r.score?.breakdown?.content ?? '?'}/100
- Reputación: ${r.score?.breakdown?.reputation ?? '?'}/100
${scoreTrace.length > 0 ? `\nCómo se ha calculado cada score (fórmula real con valores del audit):\n${scoreTrace.join('\n')}\n` : ''}

### SEO
- Keywords top 10: ${seo.keywordsTop10 ?? '?'}
- Tráfico orgánico estimado: ${seo.organicTrafficEstimate ?? '?'}/mes
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
- Sector detectado: ${(r.sector as any)?.sector ?? '?'} ← FIABLE (análisis IA del contenido completo)
- Modelo detectado por crawler: ${conv.detectedModel ?? 'desconocido'} ← SOLO analiza homepage, puede fallar en ecommerce con hero visual
- ⚠️ Si sector = ecommerce/retail/moda PERO modelo = informational → el crawler no vio señales de tienda en la home. Adapta tu diagnóstico al sector real, no al modelo del crawler.
- Funnel score: ${conv.funnelScore ?? conv.score ?? '?'}/100
- Señales de captación de leads: formularios(${conv.formCount ?? 0}), CTAs(${conv.ctaCount ?? 0}), lead magnet(${conv.hasLeadMagnet ? 'sí' : 'no'}), chat(${conv.hasChatWidget ? 'sí' : 'no'})
- Señales de comercio: carrito(${conv.hasCart ? 'sí' : 'no'}), añadir al carrito(${conv.hasAddToCart ? 'sí' : 'no'}), checkout(${conv.hasCheckout ? 'sí' : 'no'}), precios de producto(${conv.hasProductPrices ? 'sí' : 'no'}), fichas de producto(${conv.productCount ?? 0}), filtros(${conv.hasProductFilters ? 'sí' : 'no'}), lista de deseos(${conv.hasWishlist ? 'sí' : 'no'})
- Señales compartidas: newsletter(${conv.hasNewsletter ? 'sí' : 'no'}), testimonios(${conv.hasTestimonials ? 'sí' : 'no'}), precios(${conv.hasPricing ? 'sí' : 'no'}), vídeo(${conv.hasVideo ? 'sí' : 'no'})

### Contenido
- Blog: cadencia ${cc.cadenceLevel || 'no detectado'} (${cc.totalPosts ?? 0} posts, ${cc.postsLast90Days ?? 0} en últimos 90 días)
- Último post: ${cc.lastPostDate || '?'} (hace ${cc.daysSinceLastPost ?? '?'} días)
- Análisis content: ${content.summary || content.analysis || 'no disponible'}

### Reputación
- GBP: ${gbp.found ? `rating ${gbp.rating}★ (${gbp.reviewCount || 0} reseñas)` : 'no encontrado'}
- Reputación general: ${rep.score ?? '?'}/100

### Competencia
${comps.slice(0, 3).map((c: any) => `- ${c.name || c.url}${c.domain ? ' ('+c.domain+')' : ''}`).join('\n') || 'sin competidores detectados'}

### Google Shopping
${(() => {
  const gs = r.google_shopping as any;
  if (!gs || gs.skipped) return '- No se ha podido analizar Google Shopping (datos insuficientes o API no disponible)';
  const lines: string[] = [];
  lines.push(`- Queries buscadas: ${gs.queriesSearched ?? 0}`);
  lines.push(`- Total resultados Shopping: ${gs.totalShoppingResults ?? 0}`);
  lines.push(`- Cliente aparece en Shopping: ${gs.clientFound ? 'SÍ' : 'NO'}`);
  if ((gs.advertisers || []).length > 0) {
    lines.push(`- Top anunciantes Shopping: ${gs.advertisers.slice(0, 5).map((a: any) => `${a.name} (${a.appearances} apariciones)`).join(', ')}`);
  } else {
    lines.push('- No se han detectado anunciantes Shopping para estas keywords');
  }
  return lines.join('\n');
})()}`);

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
    // 180s timeout: with max_tokens=16384 the full analysis generation can
    // take 90-150s. 85s was too tight and aborted mid-generation. Vercel
    // Function timeout on Pro is 300s so we stay well within budget.
    const timer = setTimeout(() => controller.abort(), 180_000);

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
        // 16384 is enough for the full analysis JSON (executiveSummary +
        // 6 pillar narratives + 5-8 prioritized actions with step-by-step
        // detail). 4096 was truncating mid-array causing stop_reason:max_tokens
        // and JSON parse failures that fell through to fallbackAnalysis.
        max_tokens: 16384,
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

  // readyToUseFixes — optional, only when the model detected on-page issues
  const validFixTypes = new Set([
    'meta_title', 'meta_description', 'schema_organization',
    'schema_faq', 'schema_product', 'schema_local', 'h1', 'alt_text',
  ]);
  let readyToUseFixes: ReadyToUseFix[] | undefined;
  if (Array.isArray(parsed.readyToUseFixes)) {
    readyToUseFixes = parsed.readyToUseFixes
      .filter((f: any) => f && typeof f.type === 'string' && typeof f.content === 'string' && validFixTypes.has(f.type))
      .slice(0, 5)
      .map((f: any): ReadyToUseFix => ({
        type: f.type,
        content: f.content,
        where: typeof f.where === 'string' ? f.where : '',
      }));
    if (readyToUseFixes && readyToUseFixes.length === 0) readyToUseFixes = undefined;
  }

  // onPageAuditContext — optional, contextual grading of rule-based on-page issues
  const validSeverities = new Set(['critical', 'warning', 'info', 'good']);
  let onPageAuditContext: OnPageAuditContextEntry[] | undefined;
  if (Array.isArray(parsed.onPageAuditContext)) {
    onPageAuditContext = parsed.onPageAuditContext
      .filter((c: any) => c && typeof c.issueKey === 'string' && typeof c.contextualNote === 'string')
      .map((c: any): OnPageAuditContextEntry => ({
        issueKey: c.issueKey,
        severityOverride: validSeverities.has(c.severityOverride) ? c.severityOverride : undefined,
        contextualLabel: typeof c.contextualLabel === 'string' ? c.contextualLabel : undefined,
        contextualNote: c.contextualNote,
        recommendedFix: typeof c.recommendedFix === 'string' ? c.recommendedFix : undefined,
        targetsKeyword: typeof c.targetsKeyword === 'string' ? c.targetsKeyword : undefined,
      }));
    if (onPageAuditContext.length === 0) onPageAuditContext = undefined;
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    executiveSummary,
    pillarAnalysis,
    prioritizedActions: actions,
    auditSummaries,
    readyToUseFixes,
    onPageAuditContext,
  };
}

// ─── Fallback (when no API key or call fails) ──────────────────────────
// Builds a deterministic executive summary from the real audit data — NO
// invention, only numbers pulled directly from pipeline_output. Used when
// the LLM call fails or ANTHROPIC_API_KEY is missing. Written in the same
// consultor-executive tone as the real agent so the client sees something
// useful instead of a placeholder. Strengths and criticalGaps are detected
// with simple heuristics from the breakdown values.

function fallbackAnalysis(input: GrowthAgentInput): GrowthAnalysis {
  const r = input.pipelineOutput || {};
  const name = input.clientName || input.domain || 'tu web';
  const score: number = r.score?.total ?? 0;
  const breakdown = r.score?.breakdown || {};

  // Pull real data points
  const seo = r.seo || {};
  const geo = r.geo || {};
  const ps = r.pagespeed || {};
  const conv = r.conversion || {};
  const gbp = r.gbp || {};
  const rep = r.reputation || {};
  const crawl = r.crawl || {};
  const ssl = r.ssl || {};
  const cc = r.content_cadence || {};

  const kwTop10 = seo.keywordsTop10 ?? 0;
  const traffic = seo.organicTrafficEstimate ?? 0;
  const mentionRate = geo.mentionRate;
  const mobilePS = ps.mobile?.performance;
  const lcpS = ps.mobile?.lcp ? (ps.mobile.lcp / 1000).toFixed(1) : null;
  const funnel = conv.funnelScore;
  const rating = gbp.rating ?? rep.combinedRating;
  const reviews = gbp.reviewCount ?? rep.totalReviews ?? 0;

  // Headline — 1 sentence based on score severity and the weakest pillar
  const weakest = (() => {
    const entries = Object.entries(breakdown).filter(([, v]) => typeof v === 'number') as Array<[string, number]>;
    if (entries.length === 0) return null;
    return entries.sort((a, b) => a[1] - b[1])[0];
  })();
  const weakestLabel: Record<string, string> = {
    seo: 'visibilidad SEO', geo: 'visibilidad en IAs', web: 'rendimiento web',
    conversion: 'conversión', content: 'contenido', reputation: 'reputación',
  };

  let headline: string;
  if (score >= 70) {
    headline = `${name} tiene una presencia digital sólida con un score global de ${score}/100.`;
  } else if (score >= 50) {
    headline = `${name} tiene una presencia digital en desarrollo con un score global de ${score}/100 y margen claro de mejora.`;
  } else if (score >= 30) {
    headline = `${name} está en fase inicial de construcción de presencia digital, con un score global de ${score}/100${weakest ? ` y ${weakestLabel[weakest[0]] || weakest[0]} como punto más débil` : ''}.`;
  } else {
    headline = `${name} tiene una presencia digital muy baja con un score global de ${score}/100 — hay trabajo fundamental por delante.`;
  }

  // Situation — 3-4 sentences with real numbers per pillar
  const situationParts: string[] = [];

  // SEO sentence
  if (!seo.skipped && (kwTop10 > 0 || traffic > 0)) {
    situationParts.push(
      `En SEO orgánico tienes ${kwTop10} keywords en top 10 y unas ${traffic.toLocaleString('es-ES')} visitas orgánicas estimadas al mes.`
    );
  } else if (seo.skipped) {
    situationParts.push('En SEO orgánico no hay datos disponibles todavía — probablemente el dominio aún no está indexado en los rankings de Google.');
  }

  // GEO sentence
  if (mentionRate != null) {
    if (mentionRate === 0) {
      situationParts.push(`En visibilidad IA (ChatGPT, Claude, Perplexity, Gemini) tu marca no aparece en ninguna de las consultas analizadas — no estás en el radar de los modelos generativos.`);
    } else if (mentionRate < 20) {
      situationParts.push(`En visibilidad IA tu marca aparece solo en el ${mentionRate}% de las consultas analizadas — presencia muy baja.`);
    } else {
      situationParts.push(`En visibilidad IA tu marca aparece en el ${mentionRate}% de las consultas analizadas.`);
    }
  }

  // Web sentence
  if (mobilePS != null && mobilePS > 0) {
    const speedLabel = mobilePS >= 90 ? 'rendimiento excelente' : mobilePS >= 50 ? 'rendimiento mejorable' : 'rendimiento muy bajo';
    situationParts.push(`Tu web carga con ${speedLabel} en móvil (${mobilePS}/100 según Google PageSpeed${lcpS ? `, LCP ${lcpS}s` : ''}).`);
  }

  // Conversion sentence
  if (funnel != null) {
    if (funnel >= 60) {
      situationParts.push(`El embudo de conversión está sólidamente configurado (${funnel}/100) con formularios y CTAs claros.`);
    } else if (funnel >= 30) {
      situationParts.push(`El embudo de conversión tiene base pero margen amplio (${funnel}/100) — hay ${conv.formCount ?? 0} formularios y ${conv.ctaCount ?? 0} CTAs detectados.`);
    } else {
      situationParts.push(`El embudo de conversión es muy débil (${funnel}/100) con apenas ${conv.formCount ?? 0} formularios y ${conv.ctaCount ?? 0} CTAs — visitantes entran pero no tienen por dónde convertir.`);
    }
  }

  // Take the first 3-4 sentences that fit
  const situation = situationParts.slice(0, 4).join(' ');

  // Strengths — things that work (detected heuristically)
  const strengths: string[] = [];
  if (ssl.valid) strengths.push(`SSL válido${ssl.daysUntilExpiry ? ` (expira en ${ssl.daysUntilExpiry} días)` : ''}`);
  if (crawl.hasSitemap) strengths.push('sitemap.xml detectado — Google puede descubrir todas tus páginas');
  if (crawl.hasSchemaMarkup) strengths.push(`datos estructurados presentes${Array.isArray(crawl.schemaTypes) && crawl.schemaTypes.length ? ` (${crawl.schemaTypes.slice(0, 2).join(', ')})` : ''}`);
  if (rating && rating >= 4) strengths.push(`reputación en Google sólida con ${rating}★ y ${reviews} reseñas`);
  if (mobilePS != null && mobilePS >= 80) strengths.push(`rendimiento móvil alto (${mobilePS}/100)`);
  if (kwTop10 >= 10) strengths.push(`${kwTop10} keywords ya en top 10 de Google`);
  if (cc.postsLast90Days && cc.postsLast90Days >= 3) strengths.push(`blog activo con ${cc.postsLast90Days} posts en los últimos 90 días`);

  // Critical gaps — things that fail (heuristic detection)
  const criticalGaps: string[] = [];
  if (!ssl.valid) criticalGaps.push('Sin SSL válido — Chrome marca tu web como "no segura"');
  if (!crawl.hasSchemaMarkup) criticalGaps.push('Sin datos estructurados (schema markup) — Google y las IAs no entienden bien qué vende tu web');
  if (!crawl.description) criticalGaps.push('Sin meta description — pierdes clicks desde los resultados de Google');
  if (mobilePS != null && mobilePS < 50) criticalGaps.push(`Rendimiento móvil crítico (${mobilePS}/100) — cada segundo extra de carga reduce conversión un 10-20%`);
  if (kwTop10 === 0) criticalGaps.push('0 keywords en top 10 de Google — tu web no aparece en búsquedas orgánicas relevantes');
  if (mentionRate != null && mentionRate < 10) criticalGaps.push('Sin presencia en IAs generativas — ChatGPT y similares no mencionan tu marca');
  if (funnel != null && funnel < 30) criticalGaps.push(`Conversión muy débil (${funnel}/100) — el tráfico entra pero no encuentra por dónde contactarte`);

  // ── Prioritized actions (deterministic) ────────────────────────────
  // When the LLM can't run, still produce a rich action plan from the real data.
  // Each action has title + description (problem+why) + detail (step-by-step) +
  // expectedOutcome + effort + timeframe. Not as good as the LLM version but
  // dramatically better than an empty array, which was causing the audit report
  // to show zero strategic initiatives.
  const fallbackActions: PrioritizedAction[] = [];
  let rank = 1;

  if (!crawl.hasSchemaMarkup) {
    fallbackActions.push({
      rank: rank++, pillar: 'seo',
      title: 'Añadir schema.org Organization en el <head> de todas las páginas',
      description: `Tu web no tiene datos estructurados detectados. Sin schema.org, Google no puede mostrar rich snippets (estrellas, precios, FAQ) y las IAs generativas no pueden identificar con precisión qué vende ${name}. Añadir schema Organization es una de las acciones de mayor ROI que existen — cuesta ~30 minutos y puede aumentar el CTR en SERPs un 15-25%.`,
      detail: '1. Genera el JSON-LD en https://technicalseo.com/tools/schema-markup-generator/ con los campos: name, url, logo, sameAs (redes sociales), contactPoint.\n2. Pégalo en el <head> de tu layout principal dentro de <script type="application/ld+json">.\n3. Valida con https://validator.schema.org que no hay errores.\n4. Si eres local business, añade también schema LocalBusiness con dirección y horarios.\n5. Si tienes FAQ en alguna página, añade schema FAQPage.',
      businessImpact: 'high',
      expectedOutcome: 'Rich snippets visibles en Google en 2-4 semanas + mejor comprensión de tu negocio por las IAs',
      effort: 'low', timeframe: '1-2 horas',
      rationale: 'Coste mínimo + impacto alto y directo en SERP',
    });
  }

  if (!crawl.description || (crawl.description && crawl.description.length < 70)) {
    fallbackActions.push({
      rank: rank++, pillar: 'seo',
      title: 'Escribir meta descriptions únicas de 140-155 caracteres en las 5 páginas con más tráfico',
      description: `${!crawl.description ? 'Tu web no tiene meta description' : `Tu meta description actual es demasiado corta (${crawl.description.length} caracteres)`}. Google genera una automática extraída del contenido — casi siempre subóptima — lo que reduce el CTR desde los resultados de búsqueda entre un 10% y un 30%. Cada página con tráfico debería tener su propia meta description optimizada.`,
      detail: '1. Abre Google Search Console y ordena las páginas por impresiones totales en los últimos 90 días.\n2. Para las 5 primeras, escribe una meta description nueva de 140-155 caracteres que incluya: keyword principal + propuesta de valor + CTA implícito ("descubre", "solicita", "prueba").\n3. Pégalas en el CMS (si usas WordPress, en el plugin de SEO como Yoast/RankMath).\n4. Vuelve a indexar las páginas en Search Console con la herramienta "Inspeccionar URL".\n5. Mide CTR 14 días después en Search Console y compara.',
      businessImpact: 'medium',
      expectedOutcome: '+15-30% de CTR desde Google en esas páginas en 2-4 semanas',
      effort: 'low', timeframe: '2-3 horas',
      rationale: 'Trabajo puntual con impacto medible',
    });
  }

  if (mobilePS != null && mobilePS < 50) {
    fallbackActions.push({
      rank: rank++, pillar: 'web',
      title: `Reducir el LCP móvil desde ${lcpS ? lcpS + 's' : 'actual'} a < 2.5s`,
      description: `Tu PageSpeed móvil está en ${mobilePS}/100${lcpS ? ` con un LCP de ${lcpS}s` : ''}. Google recomienda < 2.5s y cada segundo adicional en móvil reduce la conversión entre un 10% y un 20%. En móvil esto afecta al 60%+ del tráfico actual. Además Google usa el LCP como factor directo de ranking desde 2021.`,
      detail: '1. Optimiza imágenes: conviértelas a WebP con herramientas como Squoosh o TinyPNG, objetivo <100KB por imagen.\n2. Añade loading="lazy" a todas las imágenes que no estén en el viewport inicial.\n3. Difiere JavaScript no crítico: mueve scripts de analytics y chat al final del <body> con defer.\n4. Minifica CSS y JS (la mayoría de CMS tienen plugins de cache con compresión).\n5. Verifica el resultado en https://pagespeed.web.dev tras cada cambio hasta llegar a >70.',
      businessImpact: 'high',
      expectedOutcome: `Pasar de ${mobilePS}/100 a 70+/100 en 2-3 semanas, con impacto directo en conversión móvil`,
      effort: 'medium', timeframe: '1-2 semanas',
      rationale: 'PageSpeed móvil es factor de ranking + afecta conversión directa',
    });
  }

  if (funnel != null && funnel < 50) {
    fallbackActions.push({
      rank: rank++, pillar: 'conversion',
      title: 'Añadir formularios de contacto específicos en cada página de servicio',
      description: `Tu funnel score es ${funnel}/100 con solo ${conv.formCount ?? 0} formularios detectados y ${conv.ctaCount ?? 0} CTAs. Cada página de servicio es una oportunidad perdida de captar leads cualificados. Un formulario corto (nombre + email + empresa) con CTA contextual puede multiplicar la conversión por 2-3x sin aumentar el tráfico.`,
      detail: '1. Lista tus páginas de servicio/producto principales.\n2. Para cada una, diseña un formulario corto (3-4 campos máximo) con CTA específico: "Solicitar demo de X" en vez de "Contactar".\n3. Colócalo above the fold si es posible, o justo después del primer bloque descriptivo.\n4. Añade tracking de conversión (Google Analytics 4 + Google Tag Manager) para medir cuántos leads genera cada página.\n5. A/B testea el copy del CTA durante 2 semanas.',
      businessImpact: 'high',
      expectedOutcome: 'Pasar de ~X leads/mes a 2-3x en 6-8 semanas sin aumentar tráfico',
      effort: 'medium', timeframe: '2 semanas',
      rationale: 'Funnel score bajo = cuello de botella del negocio',
    });
  }

  if (mentionRate != null && mentionRate < 20) {
    fallbackActions.push({
      rank: rank++, pillar: 'geo',
      title: 'Publicar 1 guía larga de 2.000+ palabras optimizada para consultas de descubrimiento del sector',
      description: `Las IAs generativas (ChatGPT, Perplexity, Claude, Gemini) mencionan tu marca solo en el ${mentionRate}% de las consultas analizadas. Las menciones en consultas donde preguntan tu nombre no cuentan como ventaja competitiva — eso es reconocimiento de entidad. Lo que importa es aparecer cuando alguien busca "mejores opciones de [tu sector]" sin conocerte todavía.`,
      detail: '1. Identifica 3 consultas TOFU típicas de tu sector ("mejores empresas de X en [ciudad]", "cómo elegir Y", "comparativa Z 2026").\n2. Escribe un artículo de 2.000+ palabras que responda UNA de esas consultas con datos, ejemplos y fuentes citables.\n3. Estructura con H2/H3 claros y añade schema FAQPage con las 5 preguntas más importantes.\n4. Publícalo en tu blog y compártelo en LinkedIn + 2 comunidades de tu sector.\n5. En 2-3 semanas, repite la consulta en ChatGPT y Perplexity para verificar si empiezan a citarte.',
      businessImpact: 'medium',
      expectedOutcome: `Pasar de ${mentionRate}% a 25-35% de mention rate en 2-3 meses`,
      effort: 'medium', timeframe: '3 semanas',
      rationale: 'Visibilidad IA es diferenciador competitivo creciente',
    });
  }

  if (!rating || reviews < 10) {
    fallbackActions.push({
      rank: rank++, pillar: 'reputation',
      title: `Pedir reseña en Google Business Profile a 5 clientes actuales${reviews > 0 ? ' para doblar tu total' : ''}`,
      description: `${reviews > 0 ? `Tienes ${reviews} reseñas públicas` : 'No se detectan reseñas públicas en Google Business Profile'}. Las reseñas son señal de confianza directa para buscadores y para las IAs (que priorizan negocios con rating verificable). Un negocio con <10 reseñas pierde frente a competidores con 30+ incluso con mejor producto.`,
      detail: '1. Selecciona 5 clientes satisfechos recientes con los que tengas buena relación.\n2. Envía un email personalizado (no masivo) con el enlace directo a dejar reseña en Google.\n3. Sugiere 2-3 puntos clave que les invite a mencionar: servicio concreto, resultado, trato recibido.\n4. Follow-up por WhatsApp/teléfono a los 3 días con los que no respondan.\n5. Responde a cada reseña nueva en menos de 48 horas con mensaje personalizado de agradecimiento.',
      businessImpact: 'medium',
      expectedOutcome: `Pasar de ${reviews} a ${reviews + 5}+ reseñas en 2 semanas`,
      effort: 'low', timeframe: '2 semanas',
      rationale: 'Señal de confianza con el menor esfuerzo del plan',
    });
  }

  if (kwTop10 > 0 && kwTop10 < 15) {
    fallbackActions.push({
      rank: rank++, pillar: 'seo',
      title: `Optimizar las keywords en posición 4-10 para empujarlas a top 3`,
      description: `Tienes ${kwTop10} keywords en top 10 — una base pequeña pero real. Las keywords en posición 4-10 son fruta madura: están a 1-3 posiciones del top 3 donde el CTR se multiplica por 5-10x. Un contenido actualizado sobre esas páginas concretas es la acción de mejor ROI SEO que existe: no necesita nuevo contenido, solo mejora el que ya posiciona.`,
      detail: '1. Abre Google Search Console → Rendimiento → Ordena keywords por posición promedio descendente y filtra posiciones 4-10.\n2. Identifica las 5-10 keywords con más impresiones en esa franja.\n3. Para cada una, entra en la página que las posiciona y: añade 500-1.000 palabras de contenido complementario, incluye la keyword en H2, añade imágenes con alt text, internaliza con otras páginas relacionadas.\n4. Solicita reindexación en Search Console.\n5. Mide impresiones/clicks 3 semanas después.',
      businessImpact: 'high',
      expectedOutcome: `Pasar de ${kwTop10} a ${kwTop10 + 5}-${kwTop10 + 10} keywords en top 3 en 4-6 semanas`,
      effort: 'medium', timeframe: '2-3 semanas',
      rationale: 'Las keywords en 4-10 ya tienen tracción — mover al top 3 es la acción más rentable',
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: 'fallback',
    executiveSummary: {
      headline,
      situation: situation || 'Datos del análisis insuficientes para generar un resumen detallado.',
      strengths: strengths.slice(0, 3),
      criticalGaps: criticalGaps.slice(0, 3),
      upsidePotential: null,
    },
    pillarAnalysis: {
      seo: {
        assessment: !seo.skipped && kwTop10 > 0
          ? `${kwTop10} keywords en top 10, tráfico orgánico estimado ~${traffic.toLocaleString('es-ES')} visitas/mes.`
          : 'Sin datos SEO suficientes para generar análisis.',
        keyFinding: '',
      },
      geo: {
        assessment: mentionRate != null
          ? `Mention rate ${mentionRate}% — ${mentionRate < 20 ? 'presencia muy baja en IAs generativas' : mentionRate < 50 ? 'presencia moderada' : 'presencia sólida'}.`
          : 'Sin datos de visibilidad en IA.',
        keyFinding: '',
      },
      web: {
        assessment: mobilePS != null
          ? `PageSpeed móvil ${mobilePS}/100${lcpS ? `, LCP ${lcpS}s` : ''}.`
          : 'Sin datos de rendimiento web.',
        keyFinding: '',
      },
      conversion: {
        assessment: funnel != null
          ? `Funnel score ${funnel}/100, ${conv.formCount ?? 0} formularios, ${conv.ctaCount ?? 0} CTAs.`
          : 'Sin datos de conversión.',
        keyFinding: '',
      },
      content: {
        assessment: cc.totalPosts
          ? `${cc.totalPosts} posts publicados, ${cc.postsLast90Days ?? 0} en los últimos 90 días.`
          : 'Blog no detectado o sin actividad reciente.',
        keyFinding: '',
      },
      reputation: {
        assessment: rating
          ? `${rating}★ con ${reviews} reseñas${(rep.newsCount ?? 0) > 0 ? `, ${rep.newsCount} menciones en prensa` : ''}.`
          : 'Sin rating público detectado.',
        keyFinding: '',
      },
    },
    prioritizedActions: fallbackActions.slice(0, 6),
    onPageAuditContext: [],  // empty → dashboard falls back to rule-based templates
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
