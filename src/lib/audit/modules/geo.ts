import type { GeoResult, GeoQuery, CrawlResult } from '../types';

const API_KEY = import.meta.env.OPENAI_API_KEY;

// Phrases the AI uses when it doesn't actually know a brand
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
  'fuera de mi conocimiento',
  'no encuentro información',
];

/**
 * Brand mention scoring (0-30 per query):
 * - Not mentioned or AI is clearly uncertain: 0
 * - Mentioned but hedged ("podría ser", "creo que"): 15
 * - Clearly mentioned with factual context: 30
 */
function scoreBrandMention(
  answer: string,
  domain: string,
  brandName: string,
): { mentioned: boolean; pts: number } {
  const lower = answer.toLowerCase();

  // If the AI explicitly denies knowing the brand → 0 pts even if the name appears
  const isDenied = DENIAL_PHRASES.some((p) => lower.includes(p));

  // Match domain (safe, very specific) or brand name if long enough to avoid false positives
  const lowerDomain = domain.toLowerCase();
  const lowerBrand = brandName.toLowerCase();
  const isMentioned =
    lower.includes(lowerDomain) ||
    (lowerBrand.length > 5 && lower.includes(lowerBrand));

  if (!isMentioned || isDenied) return { mentioned: false, pts: 0 };

  // Check for hedging language that signals low confidence
  const isHedged =
    lower.includes('podría') ||
    lower.includes('creo que') ||
    lower.includes('me parece') ||
    lower.includes('si no me equivoco') ||
    lower.includes('no estoy completamente') ||
    lower.includes('es posible que');

  return { mentioned: true, pts: isHedged ? 15 : 30 };
}

/**
 * Sector quality scoring (0-13 per query):
 * Requires substantive evidence, not just generic words.
 *
 * Criteria (each worth ~4 pts):
 * 1. Substantive response: length > 200 chars
 * 2. Names specific entities: ≥2 capitalized tokens in mid-sentence
 *    (proper nouns / brand names that GPT is naming)
 * 3. Actionable recommendation language
 */
function scoreSectorQuery(answer: string): { hasSectorData: boolean; pts: number } {
  const lower = answer.toLowerCase();
  let pts = 0;

  // 1. Substantive length (up to 4 pts)
  if (answer.length > 200) pts += 4;

  // 2. Contains ≥2 proper nouns in mid-sentence — evidence the AI is naming specific entities
  // Match capitalized words that are NOT at the start of a sentence
  const midSentenceCapitals =
    answer.match(/(?<=[a-záéíóúüña-z,;] )[A-ZÁÉÍÓÚÜ][a-záéíóúü]{2,}/g) || [];
  if (midSentenceCapitals.length >= 2) pts += 5;

  // 3. Actionable recommendation language (up to 4 pts)
  const recommendationWords = [
    'recomiendo', 'te recomiendo', 'recomendamos',
    'destacan', 'destacan por', 'se destacan',
    'líder', 'líderes', 'referente', 'referentes',
    'top ', 'mejor opción', 'mejores opciones',
    'opta por', 'considera', 'te sugiero',
    'plataforma de referencia', 'solución recomendada',
  ];
  if (recommendationWords.some((w) => lower.includes(w))) pts += 4;

  return { hasSectorData: pts >= 4, pts };
}

export async function runGEO(url: string, sector: string, crawl: CrawlResult): Promise<GeoResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'OPENAI_API_KEY not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  const brandName = crawl.title?.split(/[-|]/)[0]?.trim() || domain;
  const valueProposition = crawl.description?.slice(0, 100) || '';

  // 2 brand-focused queries
  const brandQueryList = [
    `¿Conoces la empresa "${brandName}"? ¿Qué sabes sobre ellos y sus servicios?`,
    `Busco información sobre ${domain} en el ámbito de ${sector}. ¿Puedes ayudarme?`,
  ];

  // 3 sector-focused queries — explicitly ask for specific names to get scorable answers
  const sectorQueryList = [
    `¿Cuáles son las mejores empresas de ${sector} en España o Latinoamérica? Dame nombres concretos.`,
    `Necesito contratar servicios de ${sector}${valueProposition ? ` para ${valueProposition.slice(0, 60)}` : ''}. ¿Qué empresas o proveedores recomiendas?`,
    `¿Qué marcas o plataformas son referentes en ${sector}? Dame ejemplos reales.`,
  ];

  const allQueries = [...brandQueryList, ...sectorQueryList];

  try {
    const results = await Promise.all(
      allQueries.map(async (query, idx) => {
        const isBrandQuery = idx < 2;

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
                  'Eres un asistente experto. Responde en español de forma concisa y directa. Cuando pregunten por empresas, menciona nombres reales y específicos.',
              },
              { role: 'user', content: query },
            ],
          }),
        });

        const data = await res.json();
        const answer: string = data?.choices?.[0]?.message?.content || '';

        if (isBrandQuery) {
          const { mentioned, pts } = scoreBrandMention(answer, domain, brandName);
          return {
            query,
            mentioned,
            isBrandQuery: true,
            hasSectorData: false,
            brandPts: pts,
            sectorPts: 0,
            context: mentioned ? answer.slice(0, 150) : undefined,
          };
        } else {
          const { hasSectorData, pts } = scoreSectorQuery(answer);
          return {
            query,
            mentioned: false,
            isBrandQuery: false,
            hasSectorData,
            brandPts: 0,
            sectorPts: pts,
            context: undefined,
          };
        }
      }),
    );

    const brandResults = results.slice(0, 2);
    const sectorResults = results.slice(2);

    // Brand score: 0-60 (0, 15, or 30 per query)
    const brandScore = brandResults.reduce((sum, r) => sum + r.brandPts, 0); // 0–60

    // Sector score: 0-40 (0-13 per query, normalized)
    const rawSectorPts = sectorResults.reduce((sum, r) => sum + r.sectorPts, 0); // 0-39
    const sectorScore = Math.min(40, Math.round((rawSectorPts / 39) * 40));

    const overallScore = Math.min(100, brandScore + sectorScore);

    return {
      queries: results.map(({ query, mentioned, isBrandQuery, context }) => ({
        query,
        mentioned,
        isBrandQuery,
        context,
      })),
      overallScore,
      brandScore,
      sectorScore,
    };
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
