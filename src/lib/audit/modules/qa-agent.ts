import type { QAResult } from '../types';

const ANTHROPIC_API_KEY =
  import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

function buildQAPrompt(results: Record<string, any>): string {
  // Extract key facts for the review
  const seo = results.seo || {};
  const geo = results.geo || {};
  const rep = results.reputation || {};
  const ts = results.techstack || {};
  const sector = results.sector?.sector || 'unknown';
  const crawl = results.crawl || {};
  const ctItems: any[] = results.competitor_traffic?.items || [];
  const ctItemsWithData = ctItems.filter(
    (c: any) => c.organicTrafficEstimate != null || c.keywordsTop10 != null,
  );
  const allCompetitorsEmpty = ctItems.length > 0 && ctItemsWithData.length === 0;
  const noCompetitorData = ctItems.length === 0 || allCompetitorsEmpty;
  const health = results.score || {};

  const kg = results.keyword_gap || {};
  const kgItemsCount = (kg.items || []).length;

  const summary = {
    sector,
    business_type: crawl.businessType || 'unknown',
    url: crawl.title || '',
    seo_etv: seo.organicTrafficEstimate,
    seo_keywords_top10: seo.keywordsTop10,
    seo_keywords_pos4to10: seo.keywordsPos4to10,
    seo_trend_lost: seo.trendLost,
    seo_trend_up: seo.trendUp,
    geo_score: geo.overallScore,
    geo_mention_rate: geo.mentionRate,
    geo_queries_count: geo.queries?.length ?? 0,
    geo_mentioned_count: geo.queries?.filter((q: any) => q.mentioned).length ?? 0,
    rep_level: rep.reputationLevel,
    rep_combined_rating: rep.combinedRating,
    rep_total_reviews: rep.totalReviews,
    techstack_maturity: ts.maturityScore,
    techstack_cms: ts.cms,
    competitors_all_empty: allCompetitorsEmpty,
    no_competitor_data: noCompetitorData,
    competitors_with_data_count: ctItemsWithData.length,
    competitors_total_count: ctItems.length,
    health_competitividad: health.competitividad ?? null,
    paid_investing: seo.isInvestingPaid,
    keyword_gap_count: kgItemsCount,
  };

  return `Eres un consultor senior de growth y marketing digital con 10 años de experiencia auditando empresas medianas.
Tu trabajo es revisar el informe de diagnóstico digital que AION ha generado automáticamente y detectar
cualquier conclusión incorrecta, inconsistente o no respaldada por los datos.

RESUMEN DE DATOS DEL AUDIT:
${JSON.stringify(summary, null, 2)}

DATOS COMPLETOS (subset relevante):
${JSON.stringify({
    seo: { ...seo, paidTopKeywords: undefined, topKeywords: seo.topKeywords?.slice(0, 3) },
    geo: { overallScore: geo.overallScore, brandScore: geo.brandScore, sectorScore: geo.sectorScore, queries: geo.queries?.slice(0, 4) },
    reputation: rep,
    techstack: { maturityScore: ts.maturityScore, cms: ts.cms, analytics: ts.analytics },
    sector: results.sector,
    competitors_count: ctItems.length,
    all_competitors_empty: allCompetitorsEmpty,
  }, null, 2)}

Revisa las posibles inconsistencias y responde ÚNICAMENTE con JSON válido con esta estructura exacta:
{
  "approved": true,
  "issues": [],
  "suppressed_sections": [],
  "overall_assessment": "valoración breve de 1-2 frases",
  "corrected_insights": null
}

Si corriges bullets o iniciativas, incluye el objeto insights completo corregido en "corrected_insights":
{
  "bullets": ["bullet corregido 1", ...],
  "initiatives": [{"title": "...", "description": "..."}, ...]
}
Si no hay correcciones en insights, "corrected_insights" debe ser null.

Criterios que debes aplicar ESTRICTAMENTE:

1. COHERENCIA: Si etv orgánico < 100 y el informe sugiere "buena visibilidad orgánica", es contradicción.
2. PROYECCIONES: Si la proyección de tráfico supera el 200% del tráfico actual, ajústala.
3. COMPETIDORES SIN DATOS (CRÍTICO): Si no_competitor_data es true o all_competitors_empty es true:
   - SIEMPRE suprime "competitor_benchmark"
   - SIEMPRE suprime cualquier afirmación comparativa como "SEO mejorable con relación al mercado",
     "por debajo de la media del sector", "sus competidores tienen más visibilidad", etc.
   - El informe NUNCA puede hacer comparativas de mercado si no hay datos reales de competidores.
   - Si el informe tiene texto comparativo con mercado/sector pero competitors_with_data_count = 0, marca issue CRÍTICO.
4. URGENCIA INJUSTIFICADA: Si el informe usa alerta roja pero los datos no son críticos (etv > 1000, rating > 4.0), suaviza.
5. TECH STACK: Si el CMS es enterprise (Drupal, SAP, Salesforce) y no hay analytics detectado, añade nota de caveat en lugar de conclusión categórica.
6. GEO: Si el score GEO > 50 y hay texto de "invisibilidad crítica", es inconsistente.
7. SALUD COMPETITIVIDAD: Si health_competitividad es null, suprime "competitor_benchmark" sin excepción.
8. INVENTED MARKET REFERENCES: Si el informe menciona "promedio del mercado", "benchmark del sector", o hace afirmaciones
   sobre cómo se posiciona vs el mercado pero no hay datos de competidores reales, es SIEMPRE un error. Suprime y marca issue.
9. SECCIONES SIN DATOS GEO: Si geo_score es 0 y geo_queries_count es 0, suprime "geo_analysis".

Para suppressed_sections usa estos identificadores exactos: "competitor_benchmark", "geo_analysis", "seo_visibility", "reputation", "techstack".

REGLA DE ORO: Nunca inventar comparativas. Sin datos de competidores = sin benchmarks.
Solo marca approved: false si hay issues que cambian materialmente las conclusiones.
Issues menores de tono → approved: true con correcciones opcionales.

REGLAS ADICIONALES DE CALIDAD DE INSIGHTS:

10. DATOS NUMÉRICOS OBLIGATORIOS EN BULLETS: Cada bullet DEBE contener al menos un dato numérico concreto (número de keywords, score, segundos, estrellas, porcentaje, etc.).
    - CORRECTO: "Invisible en IA: apareces en 1 de 12 respuestas de ChatGPT (GEO score 8/100)"
    - INCORRECTO: "Tu presencia digital tiene bases técnicas aceptables"
    Si un bullet no tiene dato numérico, corríGElo incorporando el dato más relevante disponible en el análisis.

11. INICIATIVAS = ACCIONES, no diagnósticos:
    - CORRECTO: "Añadir formulario de contacto a páginas de servicio"
    - INCORRECTO: "Tu presencia digital global obtiene un 44/100" (esto es un diagnóstico)
    Si el title de una iniciativa es un diagnóstico y no una acción ejecutable, reescríbelo como acción.

12. VEREDICTO COHERENTE CON DATOS: Si los bullets mencionan datos positivos (ej: buena reputación, keywords en top 10), el overall_assessment no puede ser completamente negativo, y viceversa.

13. NO CONTRADECIR LOS DATOS: Si seo.keywordsTop10 >= 50 y un bullet dice "sin presencia en Google", es una contradicción grave. Corrige el bullet.

14. KEYWORD GAPS: Si keyword_gap_count === 0, rechaza cualquier recomendación que mencione "gap de keywords", "keywords donde no posicionas", "gap competitivo de palabras clave" o similar. Sin datos de gaps no puede haber recomendación de gaps.

15. SECTOR FINANCIERO: Si business_type o sector contiene alguno de [banca, banco, bank, finanzas, wealth, seguros, privada, insurance, finance]: rechaza "formulario de contacto" como acción recomendada y sustitúyelo por "canal de contacto privado" o "sección de contacto cualificado". La banca no capta leads con formularios genéricos.

16. COHERENCIA NUMÉRICA: Si el informe cita un número concreto (ej: "1 keyword") pero seo_keywords_pos4to10 > 5, es un error factual. Corrige el número en el bullet o iniciativa afectada usando seo_keywords_pos4to10.

17. SCORE vs DESCRIPCIÓN: Si geo_mention_rate > 60 y el informe describe la presencia en IA como "invisible" o "crítica", es una contradicción. Suaviza a "mejorable" o "parcial". Si el score total > 60 y un bullet usa "deficiente" o "crítico" para describir la situación global, corrígelo a "en desarrollo" o "mejorable".

18. VALIDACIÓN DEL VEREDICTO: Revisa el primer bullet (veredicto ejecutivo). Si cumple ALGUNA de estas condiciones → approved: false y corrige en corrected_insights:
    a) Menos de 3 datos numéricos concretos en el veredicto (puntos, keywords, segundos, porcentajes, posiciones, etc.)
    b) No menciona el nombre del dominio o empresa analizada en ningún momento
    c) No compara ningún dato con un competidor o benchmark concreto
    - CORRECTO: "andbank.com logra 69 keywords en top 10 pero aparece en solo 2 de 12 respuestas IA (17%); Julius Baer supera los 300 keywords — hay una brecha de posicionamiento que atacar."
    - INCORRECTO: "Tienes fundamentos pero pierdes terreno en visibilidad digital."

Si aplicas correcciones a bullets o iniciativas, SIEMPRE incluye el objeto "corrected_insights" completo con los bullets e iniciativas corregidos.`;
}

export async function runQAAgent(results: Record<string, any>): Promise<QAResult> {
  if (!ANTHROPIC_API_KEY) {
    return {
      approved: true,
      issues: [],
      suppressedSections: [],
      overallAssessment: 'QA not configured (no ANTHROPIC_API_KEY)',
      qaBypassed: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

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
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        temperature: 0,
        messages: [{ role: 'user', content: buildQAPrompt(results) }],
      }),
    });

    if (!res.ok) {
      return { approved: true, issues: [], suppressedSections: [], qaBypassed: true, overallAssessment: `API error ${res.status}` };
    }

    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { approved: true, issues: [], suppressedSections: [], qaBypassed: true, overallAssessment: 'Invalid QA response' };
    }

    const qa = JSON.parse(match[0]);
    return {
      approved: qa.approved ?? true,
      issues: qa.issues || [],
      suppressedSections: (qa.suppressed_sections || []).map((s: any) => s.section ?? s),
      overallAssessment: qa.overall_assessment || '',
      qaTimestamp: new Date().toISOString(),
      correctedInsights: qa.corrected_insights ?? undefined,
    };
  } catch (err: any) {
    const reason = err.name === 'AbortError' ? 'QA agent timed out (15s)' : err.message?.slice(0, 100);
    return { approved: true, issues: [], suppressedSections: [], qaBypassed: true, overallAssessment: reason };
  } finally {
    clearTimeout(timer);
  }
}
