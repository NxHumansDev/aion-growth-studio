import type { QAResult } from '../types';

const ANTHROPIC_API_KEY =
  import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

function buildQAPrompt(results: Record<string, any>): string {
  const seo = results.seo || {};
  const geo = results.geo || {};
  const rep = results.reputation || {};
  const ts = results.techstack || {};
  const cv = results.conversion || {};
  const sector = results.sector?.sector || 'unknown';
  const crawl = results.crawl || {};
  const insights = results.insights || {};
  const ctItems: any[] = (results.competitor_traffic?.items || []).filter(
    (c: any) => !c.apiError && (c.organicTrafficEstimate != null || c.keywordsTop10 != null),
  );
  const comps = results.competitors?.competitors || [];
  const kg = results.keyword_gap || {};
  const health = results.score || {};
  const ps = results.pagespeed || {};
  const traffic = results.traffic || {};
  const cc = results.content_cadence || {};
  const domain = crawl.title?.split(/[-|–—·:]/)[0]?.trim() || 'dominio analizado';

  const data = JSON.stringify({
    domain,
    sector,
    businessType: crawl.businessType || 'unknown',
    score: health.total ?? null,
    scoreBreakdown: health.breakdown || null,

    // SEO
    seoKeywordsTop10: seo.keywordsTop10 ?? null,
    seoKeywordsPos4to10: seo.keywordsPos4to10 ?? null,
    seoTraffic: seo.organicTrafficEstimate ?? null,
    seoDomainRank: seo.domainRank ?? null,
    seoTrend: seo.organicTrend ?? null,
    seoTrendPct: seo.organicTrendPct ?? null,
    seoBrandPct: seo.brandTrafficPct ?? null,
    seoTopKeywords: seo.topKeywords?.slice(0, 5) || [],
    seoSkipped: seo.skipped || false,

    // GEO
    geoMentionRate: geo.mentionRate ?? null,
    geoRangeLow: geo.mentionRangeLow ?? null,
    geoRangeHigh: geo.mentionRangeHigh ?? null,
    geoScore: geo.overallScore ?? null,
    geoQueriesTotal: geo.queries?.length ?? 0,
    geoQueriesMentioned: geo.queries?.filter((q: any) => q.mentioned).length ?? 0,
    geoCategoryBreakdown: geo.categoryBreakdown || null,
    geoCompetitorMentions: geo.competitorMentions?.slice(0, 3) || [],
    geoNarrative: geo.executiveNarrative || null,

    // Competitors
    competitorsCount: comps.length,
    competitorsWithData: ctItems.length,
    competitorNames: comps.map((c: any) => c.name).join(', '),
    competitorTrafficSample: ctItems.slice(0, 3).map((c: any) => ({
      name: c.name, kw: c.keywordsTop10, traffic: c.organicTrafficEstimate,
    })),
    keywordGapCount: (kg.items || []).length,

    // Web & Conversion
    pagespeedMobile: ps.mobile?.performance ?? null,
    pagespeedDesktop: ps.desktop?.performance ?? null,
    lcpMs: ps.mobile?.lcp ?? null,
    funnelScore: cv.funnelScore ?? null,
    hasContactForm: cv.hasContactForm ?? null,
    hasCTA: cv.hasCTA ?? null,

    // Reputation & Social
    reputationLevel: rep.reputationLevel ?? null,
    combinedRating: rep.combinedRating ?? null,
    newsCount: rep.newsCount ?? 0,
    techstackMaturity: ts.maturityScore ?? null,
    cms: ts.cms ?? null,

    // Traffic
    trafficTotal: traffic.visits ?? null,
    trafficChannels: traffic.channels ? Object.entries(traffic.channels).map(([k, v]: [string, any]) => ({
      channel: k, share: v.share, visits: v.visits,
    })) : null,

    // Blog
    blogActive: cc.cadenceLevel ?? null,
    blogPosts: cc.totalPosts ?? null,
    blogLastDays: cc.daysSinceLastPost ?? null,

    // Current insights (what the LLM generated)
    currentSummary: insights.summary || null,
    currentBullets: insights.bullets || [],
    currentInitiatives: insights.initiatives || [],
    currentVisibilitySummary: insights.visibilitySummary || null,
    currentBenchmarkSummary: insights.benchmarkSummary || null,
    currentExperienceSummary: insights.experienceSummary || null,
  }, null, 2);

  return `Eres el Director de Calidad de AION Growth Studio. Tienes 15 años de experiencia en growth marketing y marketing digital. Tu trabajo es GARANTIZAR que cada informe de diagnóstico que salga de AION sea impecable.

Este informe va a ser leído por CEOs y CMOs que tomarán decisiones de inversión basándose en él. Si algo no es coherente, correcto o valioso, TÚ lo corriges. No señalas — arreglas.

DATOS COMPLETOS DEL ANÁLISIS:
${data}

═══════════════════════════════════════════════
TU MISIÓN: Revisar, corregir y mejorar TODO lo necesario
═══════════════════════════════════════════════

FASE 1 — COHERENCIA DE DATOS
Revisa que no haya contradicciones entre secciones:
- Si SEO muestra X keywords pero un bullet dice otro número → corrige el bullet
- Si GEO mention rate es Y% pero la narrativa dice "invisible" → corrige
- Si no hay datos de competidores → elimina TODA referencia comparativa
- Si keyword_gap_count es 0 → elimina recomendaciones de "atacar gaps"
- Si funnelScore > 60 pero dice "sin conversión" → corrige
- Si domainRank es null pero hay >50 keywords → no decir "sin autoridad"

FASE 2 — CALIDAD DEL VEREDICTO EJECUTIVO (CRÍTICO)
El "summary" y los primeros 3 bullets son lo que lee un CEO. DEBEN:
1. Contener mínimo 4 datos numéricos específicos del negocio
2. Mencionar el nombre de la empresa o dominio
3. Comparar al menos 1 dato con un competidor real (si hay datos)
4. Explicar el IMPACTO DE NEGOCIO, no solo la métrica
5. NO usar frases genéricas como "bases técnicas aceptables", "déficits significativos", "oportunidades de captación"

Si el veredicto actual no cumple → REESCRÍBELO COMPLETO.

FASE 3 — CALIDAD DE LAS INICIATIVAS
Cada iniciativa debe ser:
- Una ACCIÓN concreta (verbo imperativo), no un diagnóstico
- Basada en un dato específico del análisis
- Con resultado esperado cuantificable
- Adaptada al sector (banca → no formularios genéricos, ecommerce → sí carrito)

Si una iniciativa es genérica o no está basada en datos → REESCRÍBELA.

FASE 4 — VALOR PARA EL CEO
Hazte estas preguntas sobre cada sección:
- "¿Un CEO pagaría por esta información?" Si no → mejórala o suprímela
- "¿Esto le dice algo que no sabía?" Si es obvio → añade insight
- "¿Puede actuar con esto?" Si es vago → concreta

FASE 5 — SECCIONES A SUPRIMIR
Si alguna sección no tiene datos suficientes para ser valiosa, suprímela:
- "competitor_benchmark" → si no hay datos reales de competidores
- "geo_analysis" → si 0 queries o todo vacío
- "seo_visibility" → si SEO skipped y no hay ningún dato
- "reputation" → si no hay ni rating ni news
- "techstack" → si todo vacío

FORMATO DE RESPUESTA — JSON VÁLIDO, SIN MARKDOWN:
{
  "approved": true/false,
  "issues": [
    {"severity": "critical/warning", "section": "...", "issue": "...", "fix_applied": "..."}
  ],
  "suppressed_sections": ["competitor_benchmark", ...],
  "overall_assessment": "1-2 frases de valoración del informe",
  "corrected_insights": {
    "summary": "veredicto ejecutivo corregido (2-3 frases con datos concretos)",
    "visibilitySummary": "una frase sobre SEO + GEO + Paid (máx 25 palabras)",
    "benchmarkSummary": "una frase sobre posición competitiva (máx 25 palabras)",
    "experienceSummary": "una frase sobre web + conversión + medición (máx 25 palabras)",
    "bullets": ["bullet 1 corregido con dato numérico", "bullet 2", "bullet 3", "bullet 4", "bullet 5", "bullet 6"],
    "initiatives": [
      {"title": "Acción concreta (verbo + resultado)", "description": "2-3 frases: problema con dato, qué hacer, resultado esperado"},
      {"title": "...", "description": "..."},
      {"title": "...", "description": "..."}
    ]
  }
}

REGLA DE ORO: Si "corrected_insights" está presente, TODOS los campos deben estar completos (summary, bullets, initiatives, los 3 summaries). El sistema reemplazará los insights originales con tu versión.

Si el informe original es excelente y no necesita cambios → "corrected_insights": null y "approved": true.
Si corriges CUALQUIER cosa → incluye el objeto corrected_insights COMPLETO con TODOS los campos.`;
}

/** Extract balanced JSON from LLM response */
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

export async function runQAAgent(results: Record<string, any>): Promise<QAResult> {
  if (!ANTHROPIC_API_KEY) {
    return {
      approved: true,
      issues: [],
      suppressedSections: [],
      overallAssessment: 'QA not configured',
      qaBypassed: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: 'user', content: buildQAPrompt(results) }],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[qa-agent] Opus API error ${res.status}: ${err.slice(0, 200)}`);
      return { approved: true, issues: [], suppressedSections: [], qaBypassed: true, overallAssessment: `API error ${res.status}` };
    }

    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';

    // Try to extract JSON — Opus sometimes wraps in markdown ```json blocks
    let cleanText = text;
    const mdJsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdJsonMatch) cleanText = mdJsonMatch[1].trim();

    const jsonStr = extractJSON(cleanText);
    if (!jsonStr) {
      console.error('[qa-agent] No JSON found in Opus response. First 500 chars:', text.slice(0, 500));
      return { approved: true, issues: [], suppressedSections: [], qaBypassed: true, overallAssessment: 'Invalid QA response' };
    }

    let qa: any;
    try {
      qa = JSON.parse(jsonStr);
    } catch {
      try {
        // Fix common JSON issues: trailing commas, unescaped quotes
        const fixed = jsonStr
          .replace(/,\s*([\]}])/g, '$1')
          .replace(/\n/g, '\\n')
          .replace(/\t/g, '\\t');
        qa = JSON.parse(fixed);
      } catch (e2) {
        console.error('[qa-agent] JSON parse failed after cleanup:', (e2 as Error).message, 'First 300:', jsonStr.slice(0, 300));
        return { approved: true, issues: [], suppressedSections: [], qaBypassed: true, overallAssessment: 'QA JSON parse error' };
      }
    }

    const result: QAResult = {
      approved: qa.approved ?? true,
      issues: qa.issues || [],
      suppressedSections: (qa.suppressed_sections || []).map((s: any) => s.section ?? s),
      overallAssessment: qa.overall_assessment || '',
      qaTimestamp: new Date().toISOString(),
    };

    // If Opus provided corrected insights, include them
    if (qa.corrected_insights && typeof qa.corrected_insights === 'object') {
      const ci = qa.corrected_insights;
      // Validate that the correction has actual content
      if ((ci.bullets?.length ?? 0) >= 3 || ci.summary) {
        result.correctedInsights = {
          summary: ci.summary || undefined,
          visibilitySummary: ci.visibilitySummary || undefined,
          benchmarkSummary: ci.benchmarkSummary || undefined,
          experienceSummary: ci.experienceSummary || undefined,
          bullets: ci.bullets || [],
          initiatives: ci.initiatives || [],
        };
        console.log(`[qa-agent] Opus corrected insights: ${ci.bullets?.length ?? 0} bullets, ${ci.initiatives?.length ?? 0} initiatives`);
      }
    }

    const issueCount = (qa.issues || []).length;
    const suppressCount = result.suppressedSections.length;
    console.log(`[qa-agent] Opus QA: approved=${result.approved} issues=${issueCount} suppressed=${suppressCount} corrected=${!!result.correctedInsights}`);

    return result;
  } catch (err: any) {
    const reason = err.name === 'AbortError' ? 'QA agent timed out (30s)' : err.message?.slice(0, 100);
    console.error(`[qa-agent] ${reason}`);
    return { approved: true, issues: [], suppressedSections: [], qaBypassed: true, overallAssessment: reason || 'QA failed' };
  } finally {
    clearTimeout(timer);
  }
}
