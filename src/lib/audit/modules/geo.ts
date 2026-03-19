import type { GeoResult, GeoQuery, CrawlResult } from '../types';

const API_KEY = import.meta.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

/**
 * GEO Funnel — 4 levels from broadest to most specific.
 *
 * The value of a brand mention is inversely proportional to how
 * directly the query asks about that brand. Appearing organically
 * in a broad sector query signals true AI authority.
 *
 * Level 1 — Sector (40 pts)  : "Best companies in [sector]?" — no brand context
 * Level 2 — Value prop (28 pts): "Who solves [specific problem]?" — no brand context
 * Level 3 — Keywords (18 pts) : "Who excels at [keywords]?" — no brand context
 * Level 4 — Direct (10 pts)   : "What do you know about [brand]?" — direct ask
 *
 * Bonus: +4 pts if brand appears in ≥3 levels (consistently present).
 * Max total: 40 + 28 + 18 + 10 + 4 = 100
 */

const FUNNEL_LEVELS = [
  { level: 1, maxPts: 40, labelEs: 'Sector general',         labelEn: 'General sector' },
  { level: 2, maxPts: 28, labelEs: 'Propuesta de valor',     labelEn: 'Value proposition' },
  { level: 3, maxPts: 18, labelEs: 'Keywords específicas',   labelEn: 'Specific keywords' },
  { level: 4, maxPts: 10, labelEs: 'Consulta directa',       labelEn: 'Direct brand query' },
] as const;

const MULTI_LEVEL_BONUS = 4;

// Denial phrases that signal the AI doesn't know this SPECIFIC brand.
// Checked NEAR the brand mention only, not in the whole answer,
// to avoid false negatives like "I know [brand]... I don't have updated financials".
const DENIAL_PHRASES = [
  'no tengo información sobre',
  'no conozco esta empresa',
  'no tengo datos sobre',
  'no tengo conocimiento de esta',
  'no he encontrado información',
  'no dispongo de información sobre',
  'no estoy familiarizado con',
  'lamentablemente no conozco',
  'desafortunadamente no tengo',
  'no me es posible confirmar',
];

// Hedging phrases — partial knowledge, reduce level-4 pts to 50%
const HEDGING_PHRASES = [
  'podría ser', 'creo que', 'me parece', 'si no me equivoco',
  'no estoy completamente seguro', 'es posible que', 'quizás',
  'podría tratarse', 'no tengo información actualizada sobre',
];

function detectMention(answer: string, domain: string, brandName: string): boolean {
  const lower = answer.toLowerCase();
  // 1. Full domain (e.g. "globalexchange.es")
  if (lower.includes(domain.toLowerCase())) return true;
  // 2. Brand name (e.g. "Global Exchange")
  if (brandName.length > 5 && lower.includes(brandName.toLowerCase())) return true;
  // 3. Domain without TLD (e.g. "globalexchange" from "globalexchange.es")
  const domainBase = domain.replace(/\.[a-z]{2,6}$/i, '');
  if (domainBase.length > 5 && lower.includes(domainBase.toLowerCase())) return true;
  return false;
}

function hasHedging(answer: string): boolean {
  const lower = answer.toLowerCase();
  return HEDGING_PHRASES.some((p) => lower.includes(p));
}

/**
 * Only counts as denial if the phrase is within 80 chars BEFORE the brand mention.
 * e.g. "no conozco Global Exchange" → denial
 * e.g. "Global Exchange opera en 30 países... no tengo datos financieros" → NOT denial
 */
function hasDenialNearBrand(answer: string, domain: string, brandName: string): boolean {
  const lower = answer.toLowerCase();

  let brandIdx = lower.indexOf(domain.toLowerCase());
  if (brandIdx === -1 && brandName.length > 5) {
    brandIdx = lower.indexOf(brandName.toLowerCase());
  }
  if (brandIdx === -1) return false;

  // Check only the window just before the brand name (the "no conozco [brand]" pattern)
  const context = lower.slice(Math.max(0, brandIdx - 80), brandIdx + 40);
  return DENIAL_PHRASES.some((p) => context.includes(p));
}

/**
 * Generate 3 buyer-intent queries via GPT — no brand names, real purchase intent.
 * Returns [] on failure so callers can fall back to legacy templates.
 */
async function generateBuyerQueries(
  sector: string,
  valueProposition: string,
  keywords: string,
  brandName: string,
  domain: string,
  askFn: (q: string, sys?: string) => Promise<string>,
): Promise<string[]> {
  const prompt =
    `Genera exactamente 3 consultas que un potencial cliente real escribiría en ChatGPT o Google buscando ${sector}.\n\n` +
    `Contexto:\n- Sector: ${sector}\n- Propuesta de valor: ${valueProposition.slice(0, 150)}\n- Servicios clave: ${keywords.slice(0, 100)}\n\n` +
    `Reglas ESTRICTAS:\n` +
    `1. NO menciones ninguna empresa, marca ni dominio (ni "${brandName}" ni "${domain}").\n` +
    `2. Perspectiva del COMPRADOR con intención real de contratar/comprar.\n` +
    `3. Primera consulta: necesidad general del sector (incluye ciudad/región si se desprende del contexto).\n` +
    `4. Segunda consulta: problema específico o servicio con intención de compra.\n` +
    `5. Tercera consulta: comparación o decisión ("¿cuál es mejor…?", "necesito elegir entre…").\n` +
    `6. Idioma: el mismo que los textos del negocio.\n` +
    `7. Devuelve SOLO un JSON array de 3 strings, sin texto adicional.\n\n` +
    `Ejemplo: ["consulta 1", "consulta 2", "consulta 3"]`;

  const raw = await askFn(prompt, 'Responde SOLO con JSON válido. Sin markdown. Sin texto adicional.');
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return (arr as unknown[])
      .filter((q): q is string => typeof q === 'string' && q.length > 10)
      .slice(0, 3);
  } catch { return []; }
}

export async function runGEO(url: string, sector: string, crawl: CrawlResult): Promise<GeoResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'OPENAI_API_KEY not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  const brandName = crawl.title?.split(/[-|]/)[0]?.trim() || domain;
  const valueProposition = crawl.description?.slice(0, 120) || '';
  const keywords = crawl.h1s?.[0] || valueProposition.split(/[,.:]/)[0] || sector;

  const askGPT = async (query: string, systemOverride?: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 28000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 400,
          messages: [
            {
              role: 'system',
              content: systemOverride ??
                'Eres un asistente experto. Responde en español de forma concisa. Cuando pregunten por empresas, menciona nombres reales y específicos incluyendo marcas internacionales relevantes.',
            },
            { role: 'user', content: query },
          ],
        }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      return (data?.choices?.[0]?.message?.content || '') as string;
    } catch {
      return ''; // timeout or network error → treat level as not mentioned
    } finally {
      clearTimeout(timer);
    }
  };

  // Generate buyer-intent Levels 1-3 dynamically; Level 4 stays as direct brand query
  const generatedQueries = await generateBuyerQueries(
    sector, valueProposition, keywords, brandName, domain, askGPT,
  );

  const queryTexts = [
    // Level 1 — Sector (buyer-intent, no brand)
    generatedQueries[0] ??
      `¿Cuáles son las empresas líderes y referentes en ${sector}? Dame 5 ejemplos concretos con sus nombres, incluyendo operadores internacionales si los hay.`,

    // Level 2 — Value proposition (buyer-intent, no brand)
    generatedQueries[1] ?? (valueProposition
      ? `Necesito: "${valueProposition.slice(0, 100)}". ¿Qué empresas o proveedores especializados existen para esto? Dame nombres reales de líderes del sector.`
      : `Necesito contratar servicios especializados de ${sector}. ¿Qué empresas o proveedores líderes recomiendas? Dame nombres concretos.`),

    // Level 3 — Keywords (buyer-intent, no brand)
    generatedQueries[2] ??
      `¿Qué empresas o marcas son referentes en "${keywords.slice(0, 80)}"? Dame nombres reales y conocidos.`,

    // Level 4 — Direct brand: unchanged (explicitly asks about the brand)
    `¿Qué sabes sobre la empresa "${brandName}" (${domain})? ¿Es un referente conocido en su sector? Descríbela brevemente.`,
  ];

  try {
    // Run each query independently — one failure doesn't kill the others
    const answers = await Promise.all(queryTexts.map((q) => askGPT(q)));

    // If every answer came back empty, the API is down/rate-limited
    if (answers.every((a) => a.length === 0)) {
      return {
        queries: [],
        overallScore: 0,
        brandScore: 0,
        sectorScore: 0,
        error: 'OpenAI API no respondió (timeout o rate limit) — reintenta en unos minutos',
      };
    }

    // Score each funnel level
    const levelResults = FUNNEL_LEVELS.map(({ level, maxPts, labelEs }, idx) => {
      const answer = answers[idx];
      const mentioned = detectMention(answer, domain, brandName);

      let pts = 0;
      if (mentioned) {
        if (level === 4) {
          // Direct query: apply proximity-based denial check
          if (hasDenialNearBrand(answer, domain, brandName)) {
            pts = 0;
          } else if (hasHedging(answer)) {
            pts = Math.round(maxPts * 0.5); // 5 pts — partial knowledge
          } else {
            pts = maxPts; // 10 pts — AI clearly knows the brand
          }
        } else {
          // Unprompted mention in broad queries → full value
          pts = maxPts;
        }
      }

      return { level, labelEs, query: queryTexts[idx], answer, mentioned, pts, maxPts };
    });

    // Bonus for consistent presence across funnel
    const mentionedCount = levelResults.filter((r) => r.mentioned).length;
    const bonus = mentionedCount >= 3 ? MULTI_LEVEL_BONUS : 0;

    const rawScore = levelResults.reduce((sum, r) => sum + r.pts, 0) + bonus;
    const overallScore = Math.min(100, rawScore);

    // sectorScore (0-40): visibility in unprompted queries (levels 1+2, max=68 → normalize)
    const sectorPts = levelResults[0].pts + levelResults[1].pts;
    const sectorScore = Math.round((sectorPts / 68) * 40);

    // brandScore (0-60): direct recognition (levels 3+4, max=28 → normalize)
    const brandPts = levelResults[2].pts + levelResults[3].pts;
    const brandScore = Math.round((brandPts / 28) * 60);

    const queries: GeoQuery[] = levelResults.map((r) => ({
      query: r.query,
      mentioned: r.mentioned,
      isBrandQuery: r.level === 4,
      context: r.mentioned ? r.answer.slice(0, 180) : undefined,
      answer: !r.mentioned && r.answer ? r.answer.slice(0, 150) : undefined,
      level: r.level,
      levelLabel: r.labelEs,
      pts: r.pts,
    }));

    return { queries, overallScore, brandScore, sectorScore };
  } catch (err: any) {
    return {
      queries: [],
      overallScore: 0,
      brandScore: 0,
      sectorScore: 0,
      error: err.message?.slice(0, 100),
    };
  }
}
