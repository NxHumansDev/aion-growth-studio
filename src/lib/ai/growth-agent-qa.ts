// ═══════════════════════════════════════════════════════════════════════════
// Growth Agent QA — Opus review pass over the Sonnet-generated analysis.
//
// Called internally by runGrowthAgent(). Not exposed as a pipeline step.
// The contract is: given the draft analysis and the raw audit data, return
// either { approved: true } or { approved: false, corrections: [...] }.
// Corrections are surgical patches applied to specific JSON paths of the
// analysis so we don't regenerate everything — we fix only what was wrong.
//
// Why Opus here: detection of subtle contradictions, factual fidelity to
// numbers, catching claims not supported by the data. A smaller/cheaper
// model reviewing a cheaper draft is the classic generator-verifier pattern;
// for customer-facing content it's worth the extra ~$0.25 per call.
// ═══════════════════════════════════════════════════════════════════════════

import type { GrowthAnalysis, PrioritizedAction } from './growth-agent';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const QA_MODEL = 'claude-opus-4-6';

interface Correction {
  path: string;                // JSON path into the GrowthAnalysis object, e.g. "executiveSummary.headline" or "prioritizedActions[1].title"
  newValue: any;               // the corrected value
  reason: string;              // why the correction (for audit trail)
}

export interface QAResult {
  approved: boolean;
  corrections: Correction[];
  summary: string;             // 1-sentence verdict for logging
}

// ─── Structural (deterministic) validation ─────────────────────────────
// Runs before QA — cheap, catches schema violations that don't need a LLM.

export interface StructuralCheck {
  valid: boolean;
  errors: string[];
}

export function validateStructural(analysis: GrowthAnalysis): StructuralCheck {
  const errors: string[] = [];

  const exec = analysis.executiveSummary;
  const actions = analysis.prioritizedActions || [];
  const gaps = exec?.criticalGaps || [];

  // 1. criticalGaps must have matching actions via linkedGap
  for (const gap of gaps) {
    const gapStart = gap.toLowerCase().slice(0, 25);
    const hasMatch = actions.some(a => {
      if (!a.linkedGap) return false;
      return a.linkedGap.toLowerCase().slice(0, 25) === gapStart
        || gap.toLowerCase().includes(a.linkedGap.toLowerCase().slice(0, 20))
        || a.linkedGap.toLowerCase().includes(gapStart);
    });
    if (!hasMatch) errors.push(`Gap huérfano sin acción correspondiente: "${gap.slice(0, 60)}..."`);
  }

  // 2. Ranks should be contiguous 1..N
  const ranks = [...actions].map(a => a.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      errors.push(`Ranks no contiguos (esperado 1..${ranks.length}, recibido ${ranks.join(',')})`);
      break;
    }
  }

  // 3. High impact actions must have an expectedOutcome
  for (const a of actions) {
    if (a.businessImpact === 'high' && !a.expectedOutcome?.trim()) {
      errors.push(`Acción rank ${a.rank} ("${a.title.slice(0, 40)}") de alto impacto sin expectedOutcome`);
    }
  }

  // 4. Every action must have a title and belong to a valid pillar
  const validPillars = new Set(['seo', 'geo', 'web', 'conversion', 'content', 'reputation']);
  for (const a of actions) {
    if (!a.title?.trim()) errors.push(`Acción rank ${a.rank} sin título`);
    if (!validPillars.has(a.pillar)) errors.push(`Acción rank ${a.rank} con pillar inválido: ${a.pillar}`);
  }

  // 5. No duplicate action titles
  const titles = actions.map(a => a.title.toLowerCase().trim());
  const dups = titles.filter((t, i) => titles.indexOf(t) !== i);
  if (dups.length > 0) errors.push(`Títulos duplicados: ${[...new Set(dups)].join(', ')}`);

  // 6. Minimum 5, maximum 8 actions
  if (actions.length < 3) errors.push(`Solo ${actions.length} acciones — mínimo 5`);
  if (actions.length > 8) errors.push(`${actions.length} acciones — máximo 8`);

  return { valid: errors.length === 0, errors };
}

// ─── Opus QA review ────────────────────────────────────────────────────

export async function runQAReview(
  analysis: GrowthAnalysis,
  pipelineOutput: Record<string, any>,
  resolvedProfile?: { profile: string; geoScope: string; source: string; confidence: number } | null,
): Promise<QAResult> {
  if (!ANTHROPIC_API_KEY) {
    return { approved: true, corrections: [], summary: 'QA skipped — no API key' };
  }

  const seo = pipelineOutput.seo || {};
  const geo = pipelineOutput.geo || {};
  const ps = pipelineOutput.pagespeed || {};
  const conv = pipelineOutput.conversion || {};
  const rep = pipelineOutput.reputation || {};
  const gbp = pipelineOutput.gbp || {};
  const crawl = pipelineOutput.crawl || {};
  const cc = pipelineOutput.content_cadence || {};
  const comps = pipelineOutput.competitors?.competitors || [];
  const ct = pipelineOutput.competitor_traffic?.items || [];

  // Resolve benchmark profile so QA can validate that the draft's valoraciones
  // are calibrated to the right business type (not global absolutes).
  const { resolveProfile } = await import('../benchmarks/resolve-profile');
  const { getProfile } = await import('../benchmarks/profiles');
  const resolved = resolvedProfile || resolveProfile({
    sectorResult: {
      businessProfile: (pipelineOutput.sector as any)?.businessProfile,
      geoScope: (pipelineOutput.sector as any)?.geoScope,
      confidence: (pipelineOutput.sector as any)?.confidence,
    },
  });
  const profile = getProfile(resolved.profile);

  // Minimal fact sheet for QA — only the numbers it needs to cross-check
  const facts = JSON.stringify({
    score: pipelineOutput.score || null,
    seo: {
      keywordsTop10: seo.keywordsTop10,
      organicTrafficEstimate: seo.organicTrafficEstimate,
      topKeywords: (seo.topKeywords || []).slice(0, 5),
    },
    geo: {
      mentionRate: geo.mentionRate,
      mentions: geo.mentions,
      totalQueries: geo.totalQueries,
      brandScore: geo.brandScore,
      competitorMentions: geo.competitorMentions,
    },
    pagespeed: {
      mobilePerformance: ps.mobile?.performance,
      mobileLCP: ps.mobile?.lcp,
      desktopPerformance: ps.desktop?.performance,
    },
    conversion: { funnelScore: conv.funnelScore, formCount: conv.formCount, ctaCount: conv.ctaCount, hasLeadMagnet: conv.hasLeadMagnet },
    reputation: { gbpRating: gbp.rating, reviewCount: gbp.reviewCount, totalReviews: rep.totalReviews, newsCount: rep.newsCount },
    content: { postsLast90Days: cc.postsLast90Days, cadenceLevel: cc.cadenceLevel, totalPosts: cc.totalPosts },
    crawl: { title: crawl.title, description: crawl.description, wordCount: crawl.wordCount, hasSchemaMarkup: crawl.hasSchemaMarkup, hasSitemap: crawl.hasSitemap },
    competitors: comps.map((c: any) => c.name || c.url).slice(0, 5),
    competitorTraffic: ct.slice(0, 3).map((c: any) => ({ domain: c.domain, keywordsTop10: c.keywordsTop10, organicTrafficEstimate: c.organicTrafficEstimate })),
  }, null, 2);

  const draftJson = JSON.stringify(analysis, null, 2);

  const prompt = `Eres el Director de Calidad de AION Growth Studio. 15 años de experiencia en growth marketing. Tu trabajo es GARANTIZAR que cada análisis que sale de AION sea IMPECABLE antes de llegar al cliente.

Este análisis va a verse en el dashboard del cliente, en el informe público del audit, y alimentará el chat del advisor. Lo leerán CEOs y CMOs que tomarán decisiones de inversión basándose en él. Si algo no es coherente, correcto o valioso, TÚ lo corriges. No señalas — devuelves correcciones quirúrgicas.

═══════════════════════════════════════════════
PERFIL DEL CLIENTE (marco de valoración obligatorio)
═══════════════════════════════════════════════

Perfil: ${resolved.profile} — ${profile.playbook.label}
Ámbito geográfico: ${resolved.geoScope}
Descripción: ${profile.playbook.description}
Ejemplos similares: ${profile.playbook.exampleClients.join(', ')}

**Señales que SÍ importan** para este perfil:
${profile.playbook.valueSignals.map(s => `- ${s}`).join('\n')}

**Señales que NO se deben evaluar/penalizar** para este perfil:
${profile.playbook.ignoreSignals.map(s => `- ${s}`).join('\n')}

Durante la revisión, si el análisis valora un KPI usando adjetivos absolutos ("débil", "escaso", "bajo") sin citar el perfil o sin comparar contra los umbrales razonables PARA ESTE TIPO DE NEGOCIO, eso es un error de calibración. Por ejemplo: decir "895 seguidores en Instagram es débil" es INCORRECTO para un freelance (el techo del perfil son 10K). Corrige a "para un consultor independiente, 895 seguidores están dentro del rango esperado".

Si el análisis evalúa métricas del "ignoreSignals" (ej: habla de "necesita carrito de compra" a un freelance consultor), corrige eliminando la valoración irrelevante.

═══════════════════════════════════════════════
DATOS REALES DEL AUDIT (la única fuente de verdad)
═══════════════════════════════════════════════

${facts}

═══════════════════════════════════════════════
ANÁLISIS GENERADO (revisa esto)
═══════════════════════════════════════════════

${draftJson}

═══════════════════════════════════════════════
TU MISIÓN — revisa las 5 FASES y corrige quirúrgicamente
═══════════════════════════════════════════════

**FASE 1 — COHERENCIA DE DATOS (9 reglas duras)**

Busca contradicciones entre lo que dice el análisis y lo que muestran los datos. Estos son los casos reales donde fallan los modelos y DEBES corregirlos:

1. **Fidelidad numérica absoluta**: si los datos dicen organicTrafficEstimate: 4800, el análisis debe decir "4.800" — no "cerca de 5K", no "5.000", no "~4800". Literal.

2. **Brand vs non-brand traffic (CRÍTICO — regla histórica)**: si los datos muestran brandTrafficPct: X% pero nonBrandTrafficEtv indica tráfico no-branded significativo (ej: Y% del total es no-branded), la narrativa DEBE reflejar el mix real. NUNCA digas "100% tráfico de marca" si los datos muestran que hay captación no-branded. Si topKeywords incluye keywords no-branded con tráfico alto (posición top y volumen >500) y el análisis dice "100% branded", ESO ES INCORRECTO — corrige.

3. **Keyword top no-brand como señal de captación**: si una keyword top está posicionada #1 con miles de visitas y NO es el nombre de la marca, esto demuestra captación nueva. El análisis DEBE mencionarlo como fortaleza, no ignorarlo.

4. **Regla del 0 en keyword gap**: si los datos muestran keyword_gap.items con length === 0, el análisis NO puede recomendar "atacar gaps de keywords". Si lo hace, corrige a "optimizar keywords en posición 4-10" o "crear contenido pilar".

5. **Regla del funnel score alto**: si funnelScore > 60 pero el análisis dice "sin conversión" o "problema crítico de conversión" — INCORRECTO. Corrige para reflejar el dato real.

6. **No inventar métricas de autoridad de dominio**: AION no mide Domain Rank ni referring domains (no usamos la API de backlinks). Si el análisis menciona "domain rank", "DR", "autoridad de dominio X/100", "backlinks" o "referring domains", bórralo — son datos que no tenemos. La autoridad se infiere de señales reales: volumen de keywords top 10, GBP, prensa, LinkedIn.

7. **Sin datos de competidores → sin comparativas**: si el análisis tiene 0 items en competitor_traffic o competitors.competitors está vacío, el análisis NO puede hacer comparativas numéricas con competidores. Elimina TODA frase del tipo "vs Competidor X" o "3x menos que..." cuando no hay datos reales.

8. **GEO mention rate baja ≠ invisibilidad total**: si mentionRate es 0% pero overallScore > 0 (suele deberse a brand score por reconocimiento de entidad), no digas "invisible en IA". Matiza: "sin presencia en consultas de descubrimiento, con reconocimiento básico de entidad".

9. **Scores de pilares coinciden con breakdown**: si el análisis cita "SEO 42/100", verifica contra score.breakdown.seo. Si no coinciden, corrige al valor real.

**FASE 2 — CALIDAD DEL VEREDICTO EJECUTIVO**

El executiveSummary.headline + executiveSummary.situation son lo primero que lee el CEO. Si no cumplen estos 4 criterios, REESCRÍBELOS completos:

1. Mínimo 4 datos numéricos concretos del negocio
2. Mencionan el dominio o nombre de la empresa
3. Comparan al menos 1 dato con competidor real (solo si hay datos de competidores)
4. Explican impacto de negocio, no solo la métrica

PROHIBIDO: "bases técnicas aceptables", "déficits significativos", "oportunidades de captación", "presencia digital mejorable", "soluciones de mejora". Son frases vacías. Si las ves, REESCRIBE.

**FASE 3 — CALIDAD DE LAS ACCIONES PRIORIZADAS**

Cada prioritizedAction debe ser:
- Una ACCIÓN (verbo imperativo), no un diagnóstico. MAL: "Visibilidad IA mejorable". BIEN: "Publicar guía de 2.000 palabras respondiendo X".
- Basada en un dato concreto del análisis
- Con expectedOutcome cuantificable (no "mejorar SEO" sino "pasar de 18 a 30 keywords top 10 en 8 semanas")
- Adaptada al sector del cliente

Si una acción es genérica o no está basada en datos, REESCRÍBELA.

**FASE 4 — FILTRO VALOR CEO**

Aplica estas 3 preguntas a cada sección del análisis:
1. ¿Un CEO pagaría por esta información? Si no → mejora o suprime.
2. ¿Le dice algo que no sabía ya? Si es obvio → añade insight real.
3. ¿Puede actuar con esto? Si es vago → concreta.

**FASE 5 — SUPRIMIR SECCIONES SIN DATOS**

Si los datos no soportan una sección, mejor suprimirla que mostrar basura. Suprime (sustituyendo el texto por una frase honesta "datos insuficientes") en estos casos:
- pillarAnalysis.geo → si mentionRate es null y overallScore es null
- auditSummaries.benchmark → si competitors.competitors.length === 0 y competitor_traffic vacío
- pillarAnalysis.reputation → si no hay GBP rating ni newsCount ni linkedin followers

**FASE 6 — TONO Y VOZ**

- Primera persona, tuteo, español de España
- Sin disclaimers defensivos ("esto es solo una estimación")
- Léxico consistente entre secciones (si en executiveSummary dices "cuello de botella de conversión", en prioritizedActions llámalo igual)
- Prohibidas palabras técnicas sin traducir: canonical tags, schema markup, LCP, CLS. Tradúcelas a impacto de negocio.

═══════════════════════════════════════════════
FORMATO DE RESPUESTA
═══════════════════════════════════════════════

Responde SOLO con JSON válido siguiendo este schema:

\`\`\`json
{
  "approved": true,
  "corrections": [],
  "summary": "Análisis coherente y bien soportado en datos, sin correcciones necesarias"
}
\`\`\`

O si hay correcciones:

\`\`\`json
{
  "approved": false,
  "corrections": [
    {
      "path": "executiveSummary.headline",
      "newValue": "Texto corregido aquí",
      "reason": "El original mencionaba '5K visitas' pero el dato real es 4800"
    },
    {
      "path": "prioritizedActions[2].expectedOutcome",
      "newValue": "Pasar de posición 15 a top 10 en 6 semanas",
      "reason": "El original decía 'mejorar ranking' — genérico, sin cuantificar"
    }
  ],
  "summary": "2 correcciones: fidelidad numérica + expectedOutcome cuantificado"
}
\`\`\`

**REGLAS SOBRE PATHS**:
- Usa notación dot+bracket: \`executiveSummary.headline\`, \`pillarAnalysis.seo.assessment\`, \`prioritizedActions[0].title\`, \`auditSummaries.benchmark\`
- Solo corrige campos string (narrativos). NO corrijas estructura, ranks, ni impact labels.
- Máximo 10 correcciones por pasada. Prioriza las más importantes.
- Si no hay problemas reales, devuelve \`approved: true\` con array vacío. No inventes correcciones para justificar tu existencia.`;

  try {
    // Opus typically takes 45-90s for QA on a full draft + pipeline context.
    // 40s was too aggressive and aborted every run. 120s leaves headroom but
    // still caps at half the 240s step budget (Sonnet draft uses the other half).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: QA_MODEL,
        // 2048 was truncating: with 10 corrections × ~200 tokens each + summary,
        // Opus hit the ceiling mid-JSON → parse failure → draft accepted as-is
        // and all QA corrections lost. 6144 leaves headroom for the full envelope.
        max_tokens: 6144,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[growth-agent-qa] Opus error ${res.status}: ${errText.slice(0, 200)}`);
      return { approved: true, corrections: [], summary: `QA skipped — API error ${res.status}` };
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text || '';

    if (data.usage) {
      console.log(`[growth-agent-qa] Opus tokens: input=${data.usage.input_tokens} out=${data.usage.output_tokens}`);
    }

    const parsed = parseQAJson(text);
    if (!parsed) {
      console.error('[growth-agent-qa] Could not parse QA JSON — accepting draft as-is');
      return { approved: true, corrections: [], summary: 'QA skipped — JSON no parseable' };
    }

    const corrections: Correction[] = Array.isArray(parsed.corrections)
      ? parsed.corrections
          .filter((c: any) => c && typeof c.path === 'string' && c.newValue !== undefined)
          .slice(0, 10)
      : [];

    return {
      approved: corrections.length === 0 || parsed.approved === true,
      corrections,
      summary: parsed.summary || (corrections.length === 0 ? 'Aprobado sin correcciones' : `${corrections.length} correcciones aplicadas`),
    };
  } catch (err) {
    console.error('[growth-agent-qa] Error:', (err as Error).message);
    return { approved: true, corrections: [], summary: `QA skipped — ${(err as Error).message}` };
  }
}

// ─── Robust JSON parsing for Opus QA output ────────────────────────────
// Opus occasionally returns JSON with trailing commas, unescaped newlines inside
// strings, or markdown fences. Try hard to recover something parseable before
// giving up — if we fail, the caller returns an un-corrected but valid analysis.
function parseQAJson(rawText: string): any | null {
  if (!rawText) return null;

  // 1. Strip markdown fences if present
  let text = rawText.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // 2. Extract outermost JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  const candidate = jsonMatch[0];

  // 3. Direct parse (happy path)
  try { return JSON.parse(candidate); } catch { /* fall through to repair */ }

  // 4. Repair attempts
  const attempts = [
    // 4a. strip trailing commas before } or ]
    () => candidate.replace(/,(\s*[}\]])/g, '$1'),
    // 4b. strip trailing commas + escape raw newlines/tabs inside string literals
    () => {
      let out = candidate.replace(/,(\s*[}\]])/g, '$1');
      let inStr = false;
      let esc = false;
      let rebuilt = '';
      for (let i = 0; i < out.length; i++) {
        const ch = out[i];
        if (esc) { rebuilt += ch; esc = false; continue; }
        if (ch === '\\') { rebuilt += ch; esc = true; continue; }
        if (ch === '"') { inStr = !inStr; rebuilt += ch; continue; }
        if (inStr) {
          if (ch === '\n') { rebuilt += '\\n'; continue; }
          if (ch === '\r') { rebuilt += '\\r'; continue; }
          if (ch === '\t') { rebuilt += '\\t'; continue; }
          // strip other control chars
          if (ch.charCodeAt(0) < 0x20) continue;
        }
        rebuilt += ch;
      }
      return rebuilt;
    },
    // 4c. truncate at first structural error by scanning brace balance up to last valid point
    () => {
      let depth = 0;
      let inStr = false;
      let esc = false;
      let lastGood = -1;
      const s = candidate;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) { lastGood = i; break; }
        }
      }
      return lastGood > 0 ? s.slice(0, lastGood + 1) : s;
    },
  ];

  for (const fix of attempts) {
    try {
      const repaired = fix();
      return JSON.parse(repaired);
    } catch { /* try next */ }
  }

  return null;
}

// ─── Apply surgical corrections to a GrowthAnalysis ────────────────────
// Simple dot+bracket path setter. Supports foo.bar, foo[0].bar, foo.bar[1].
export function applyCorrections(
  analysis: GrowthAnalysis,
  corrections: Correction[],
): GrowthAnalysis {
  // Deep clone so we don't mutate the original (callers might hold references)
  const cloned: GrowthAnalysis = JSON.parse(JSON.stringify(analysis));
  const notes: string[] = [];

  for (const c of corrections) {
    try {
      setPath(cloned, c.path, c.newValue);
      notes.push(`${c.path}: ${c.reason}`);
    } catch (err) {
      console.warn(`[growth-agent-qa] Failed to apply correction ${c.path}:`, (err as Error).message);
    }
  }

  cloned.qaPassed = true;
  cloned.qaNotes = notes;
  return cloned;
}

function setPath(obj: any, path: string, value: any): void {
  // Tokenize path: executiveSummary.headline → ['executiveSummary', 'headline']
  //                prioritizedActions[0].title → ['prioritizedActions', 0, 'title']
  const tokens: Array<string | number> = [];
  const parts = path.split('.');
  for (const part of parts) {
    const match = part.match(/^([^[]+)(?:\[(\d+)\])?$/);
    if (!match) throw new Error(`Invalid path segment: ${part}`);
    tokens.push(match[1]);
    if (match[2] !== undefined) tokens.push(parseInt(match[2], 10));
  }

  let cursor = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (cursor == null || cursor[token] == null) {
      throw new Error(`Path not reachable at token ${String(token)} (path: ${path})`);
    }
    cursor = cursor[token];
  }
  cursor[tokens[tokens.length - 1]] = value;
}
