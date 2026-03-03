import type { GeoResult, GeoQuery, CrawlResult } from '../types';

const API_KEY = import.meta.env.OPENAI_API_KEY;

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

const MULTI_LEVEL_BONUS = 4; // +4 if mentioned in ≥3 levels

// AI denial phrases — prevent false positives on level-4 direct queries
const DENIAL_PHRASES = [
  'no tengo información',
  'no conozco',
  'no estoy seguro',
  'no puedo confirmar',
  'no tengo datos',
  'no tengo conocimiento',
  'lamentablemente, no',
  'desafortunadamente, no',
  'no dispongo de información',
  'no encuentro información',
];

// Hedging phrases — reduce pts on level-4 (uncertain knowledge)
const HEDGING_PHRASES = [
  'podría ser', 'creo que', 'me parece', 'si no me equivoco',
  'no estoy completamente', 'es posible que', 'quizás', 'podría tratarse',
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

function hasDenial(answer: string): boolean {
  const lower = answer.toLowerCase();
  return DENIAL_PHRASES.some((p) => lower.includes(p));
}

export async function runGEO(url: string, sector: string, crawl: CrawlResult): Promise<GeoResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'OPENAI_API_KEY not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  const brandName = crawl.title?.split(/[-|]/)[0]?.trim() || domain;
  const valueProposition = crawl.description?.slice(0, 120) || '';
  // Use H1 or first clause of description as the most specific keyword signal
  const keywords = crawl.h1s?.[0] || valueProposition.split(/[,.:]/)[0] || sector;

  const queryTexts = [
    // Level 1 — Sector: broadest signal, no brand context
    `¿Cuáles son las mejores empresas y referentes en ${sector} en España o Latinoamérica? Dame 5 ejemplos concretos con sus nombres.`,

    // Level 2 — Value proposition: does the AI recommend them for the specific problem?
    valueProposition
      ? `"${valueProposition.slice(0, 100)}". ¿Qué empresas o proveedores especializados recomiendas para este tipo de servicio? Dame nombres reales.`
      : `Necesito contratar servicios especializados de ${sector}. ¿Qué empresas o proveedores recomiendas? Dame nombres concretos.`,

    // Level 3 — Keywords: does the AI know them for specific capabilities?
    `¿Qué agencias o empresas destacan específicamente en "${keywords.slice(0, 80)}" dentro del sector ${sector}? Necesito recomendaciones concretas.`,

    // Level 4 — Direct brand: does the AI know the brand when explicitly asked?
    `¿Qué sabes sobre la empresa "${brandName}" (${domain})? ¿Qué servicios ofrecen y son un referente conocido en su sector?`,
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
            max_tokens: 350,
            messages: [
              {
                role: 'system',
                content:
                  'Eres un asistente experto. Responde en español de forma concisa. Cuando pregunten por empresas, menciona nombres reales y específicos.',
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
          // Direct query: apply anti-hallucination guards
          if (hasDenial(answer)) {
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

      return {
        level,
        labelEs,
        query: queryTexts[idx],
        answer,
        mentioned,
        pts,
        maxPts,
      };
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
