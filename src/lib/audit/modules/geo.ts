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
  return (
    lower.includes(domain.toLowerCase()) ||
    (brandName.length > 5 && lower.includes(brandName.toLowerCase()))
  );
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

export async function runGEO(url: string, sector: string, crawl: CrawlResult): Promise<GeoResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'OPENAI_API_KEY not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  const brandName = crawl.title?.split(/[-|]/)[0]?.trim() || domain;
  const valueProposition = crawl.description?.slice(0, 120) || '';
  const keywords = crawl.h1s?.[0] || valueProposition.split(/[,.:]/)[0] || sector;

  const queryTexts = [
    // Level 1 — Sector: broadest, no geographic restriction so global brands surface too
    `¿Cuáles son las empresas líderes y referentes en ${sector}? Dame 5 ejemplos concretos con sus nombres, incluyendo operadores internacionales si los hay.`,

    // Level 2 — Value proposition: does the AI recommend them for the specific problem?
    valueProposition
      ? `Necesito: "${valueProposition.slice(0, 100)}". ¿Qué empresas o proveedores especializados existen para esto? Dame nombres reales de líderes del sector.`
      : `Necesito contratar servicios especializados de ${sector}. ¿Qué empresas o proveedores líderes recomiendas? Dame nombres concretos.`,

    // Level 3 — Keywords: does the AI know them for specific capabilities?
    `¿Qué empresas o marcas son referentes en "${keywords.slice(0, 80)}"? Dame nombres reales y conocidos.`,

    // Level 4 — Direct brand: does the AI know the brand when explicitly asked?
    `¿Qué sabes sobre la empresa "${brandName}" (${domain})? ¿Es un referente conocido en su sector? Descríbela brevemente.`,
  ];

  try {
    const answers = await Promise.all(
      queryTexts.map(async (query) => {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
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
                content:
                  'Eres un asistente experto. Responde en español de forma concisa. Cuando pregunten por empresas, menciona nombres reales y específicos incluyendo marcas internacionales relevantes.',
              },
              { role: 'user', content: query },
            ],
          }),
        });
        const data = await res.json();
        return (data?.choices?.[0]?.message?.content || '') as string;
      }),
    );

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
