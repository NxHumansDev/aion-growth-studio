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

  // Minimal fact sheet for QA — only the numbers it needs to cross-check
  const facts = JSON.stringify({
    score: pipelineOutput.score || null,
    seo: {
      keywordsTop10: seo.keywordsTop10,
      organicTrafficEstimate: seo.organicTrafficEstimate,
      domainRank: seo.domainRank,
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
    competitorTraffic: ct.slice(0, 3).map((c: any) => ({ domain: c.domain, keywordsTop10: c.keywordsTop10, organicTrafficEstimate: c.organicTrafficEstimate, domainRank: c.domainRank })),
  }, null, 2);

  const draftJson = JSON.stringify(analysis, null, 2);

  const prompt = `Eres el Director de Calidad de AION Growth Studio. 15 años de experiencia en growth marketing. Tu trabajo es garantizar que cada análisis que sale de AION sea IMPECABLE antes de llegar al cliente.

Este análisis va a verse en el dashboard del cliente, en el informe público del audit, y alimentará el chat del advisor. Si algo no es coherente, correcto o está bien soportado por los datos, TÚ lo corriges. No señalas — devuelves correcciones quirúrgicas.

═══════════════════════════════════════════════
DATOS REALES DEL AUDIT (la única fuente de verdad)
═══════════════════════════════════════════════

${facts}

═══════════════════════════════════════════════
ANÁLISIS GENERADO (revisa esto)
═══════════════════════════════════════════════

${draftJson}

═══════════════════════════════════════════════
TU MISIÓN
═══════════════════════════════════════════════

Revisa el análisis contra los datos reales y busca:

**FASE 1 — Fidelidad numérica**
- ¿Cada número citado en el análisis coincide EXACTAMENTE con el dato real? (p.ej. si el análisis dice "4.800 visitas" y los datos dicen organicTrafficEstimate: 4800, ok; si dice "cerca de 5K" o "5.000", corrige a 4.800)
- ¿Hay números inventados que no están en los datos? (p.ej. citar un % que no existe)
- ¿Los scores de pilares coinciden con score.breakdown?

**FASE 2 — Coherencia entre secciones**
- ¿Los criticalGaps del executiveSummary se corresponden con keyFindings de algún pilar?
- ¿Cada criticalGap tiene al menos una prioritizedAction con linkedGap apuntando a él?
- ¿El rank 1 de las acciones aborda el problema más grave descrito en la situación?
- ¿pillarAnalysis.X.assessment contradice executiveSummary? (p.ej. resumen dice "SEO crítico" y pilar SEO dice "todo va bien")
- ¿auditSummaries.benchmark menciona competidores que no existen en los datos?

**FASE 3 — Soporte en datos**
- ¿Cada strength está realmente soportado por los datos?
- ¿Cada criticalGap es una conclusión honesta del audit, no una alucinación?
- ¿Las acciones están justificadas por un dato concreto, no son genéricas?
- Si no hay datos de competidores → benchmark debe decirlo, no inventar
- Si mention rate es 0 → no decir "buena visibilidad en IAs"

**FASE 4 — Tono y voz**
- ¿Mantiene primera persona, tuteo, español de España?
- ¿Hay disclaimers defensivos ("esto es solo una estimación") que deberían eliminarse?
- ¿El léxico es consistente entre secciones?

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

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
        max_tokens: 2048,
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
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[growth-agent-qa] No JSON in Opus response');
      return { approved: true, corrections: [], summary: 'QA skipped — no JSON parseable' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const corrections: Correction[] = Array.isArray(parsed.corrections)
      ? parsed.corrections
          .filter((c: any) => c && typeof c.path === 'string' && c.newValue !== undefined)
          .slice(0, 10)
      : [];

    if (data.usage) {
      console.log(`[growth-agent-qa] Opus tokens: input=${data.usage.input_tokens} out=${data.usage.output_tokens}`);
    }

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
