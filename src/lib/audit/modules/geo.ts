import type { GeoResult, GeoQuery, GeoCompetitorMention, CrawlResult } from '../types';

const OPENAI_KEY = import.meta.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const PERPLEXITY_KEY = import.meta.env.PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY;
const ANTHROPIC_KEY = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = import.meta.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const DEEPSEEK_KEY = import.meta.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;

type Stage = 'tofu' | 'mofu' | 'bofu';
type EngineType = 'openai_compat' | 'anthropic' | 'gemini';

interface Engine {
  name: string;
  apiKey: string;
  type: EngineType;
  baseUrl?: string;  // for openai_compat engines
  model: string;
}

interface QuerySpec {
  stage: Stage;
  query: string;
  isBrandQuery?: boolean;
}

// ── Mention detection ─────────────────────────────────────────────

const DENIAL_PHRASES = [
  'no tengo información sobre', 'no conozco esta empresa', 'no tengo datos sobre',
  'no tengo conocimiento de esta', 'no he encontrado información',
  'no dispongo de información sobre', 'no estoy familiarizado con',
  'lamentablemente no conozco', 'desafortunadamente no tengo', 'no me es posible confirmar',
  "i don't have information about", "i'm not familiar with", "i don't know this company",
  "no information available about", "i have no information about",
];

function detectMention(answer: string, domain: string, brandName: string): boolean {
  const lower = answer.toLowerCase();
  if (lower.includes(domain.toLowerCase())) return true;
  if (brandName.length > 5 && lower.includes(brandName.toLowerCase())) return true;
  const domainBase = domain.replace(/\.[a-z]{2,6}$/i, '');
  if (domainBase.length > 5 && lower.includes(domainBase.toLowerCase())) return true;
  return false;
}

function hasDenialNearBrand(answer: string, domain: string, brandName: string): boolean {
  const lower = answer.toLowerCase();
  let brandIdx = lower.indexOf(domain.toLowerCase());
  if (brandIdx === -1 && brandName.length > 5) brandIdx = lower.indexOf(brandName.toLowerCase());
  if (brandIdx === -1) return false;
  const context = lower.slice(Math.max(0, brandIdx - 80), brandIdx + 40);
  return DENIAL_PHRASES.some((p) => context.includes(p));
}

// ── Engine query ──────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a helpful AI assistant. When asked about companies, products, or services, provide specific real brand names and concrete recommendations. Be concise and direct.';

async function askOpenAICompat(query: string, engine: Engine, signal: AbortSignal): Promise<string> {
  const res = await fetch((engine.baseUrl || 'https://api.openai.com/v1') + '/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${engine.apiKey}` },
    body: JSON.stringify({
      model: engine.model,
      max_tokens: 250,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
    }),
  });
  if (!res.ok) return '';
  const data = (await res.json()) as any;
  return (data?.choices?.[0]?.message?.content || '') as string;
}

async function askAnthropic(query: string, engine: Engine, signal: AbortSignal): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': engine.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: engine.model,
      max_tokens: 250,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: query }],
    }),
  });
  if (!res.ok) return '';
  const data = (await res.json()) as any;
  return (data?.content?.[0]?.text || '') as string;
}

async function askGemini(query: string, engine: Engine, signal: AbortSignal): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${engine.model}:generateContent?key=${engine.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${query}` }] }],
      generationConfig: { maxOutputTokens: 250 },
    }),
  });
  if (!res.ok) return '';
  const data = (await res.json()) as any;
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '') as string;
}

async function askEngine(query: string, engine: Engine, timeout = 12000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    switch (engine.type) {
      case 'anthropic':
        return await askAnthropic(query, engine, controller.signal);
      case 'gemini':
        return await askGemini(query, engine, controller.signal);
      default:
        return await askOpenAICompat(query, engine, controller.signal);
    }
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// ── Query generation ──────────────────────────────────────────────

/**
 * Static fallback queries used when GPT generation fails.
 * Structure: 4 TOFU + 5 MOFU + 2 BOFU (unbranded) + 1 BOFU (branded) = 12 total
 */
function buildFallbackQueries(
  sector: string,
  valueProposition: string,
  keywords: string,
  brandName: string,
  domain: string,
  locationHint: string | undefined,
): QuerySpec[] {
  const loc = locationHint ? ` en ${locationHint}` : '';
  const vp = valueProposition.slice(0, 80) || sector;
  const kw = keywords.slice(0, 60) || sector;
  return [
    // TOFU — 4 awareness queries, NO brand
    { stage: 'tofu', query: `¿Cuáles son las mejores empresas de ${sector}${loc}? Dame nombres concretos.` },
    { stage: 'tofu', query: `¿Qué tendencias están marcando el futuro de ${sector} este año?` },
    { stage: 'tofu', query: `¿Cómo elegir un buen proveedor de ${sector}? ¿Qué criterios importan más?` },
    { stage: 'tofu', query: `Referentes y líderes del mercado en ${sector}${loc}. ¿Quiénes destacan?` },
    // MOFU — 4 comparison / problem queries, NO brand
    { stage: 'mofu', query: `Necesito "${vp}". ¿Qué empresa contrataría y por qué?` },
    { stage: 'mofu', query: `¿Cuál es la diferencia entre las principales empresas de ${sector}? Comparativa.` },
    { stage: 'mofu', query: `¿Qué alternativas existen en ${sector} para una empresa mediana en crecimiento?` },
    { stage: 'mofu', query: `Problema: necesito ${kw}. ¿Qué proveedor lo resuelve mejor y a qué precio?` },
    // BOFU — 3 high-intent unbranded + 1 direct brand
    { stage: 'bofu', query: `Quiero contratar ${sector}${loc}. ¿Qué empresa ofrece mejor relación calidad-precio?` },
    { stage: 'bofu', query: `Busco proveedor de ${sector} de confianza para proyecto urgente. ¿Opciones top?` },
    { stage: 'bofu', query: `Compara las mejores opciones de ${sector}${loc} para contratar este mes. ¿Cuál elegiría un experto?` },
    { stage: 'bofu', query: `¿Qué sabes sobre "${brandName}" (${domain})? ¿Es un referente conocido en ${sector}?`, isBrandQuery: true },
  ];
}

/**
 * Generate 12 buyer-intent queries via GPT with TOFU/MOFU/BOFU structure.
 * Falls back to static templates on any failure.
 */
async function generateQueries(
  sector: string,
  valueProposition: string,
  keywords: string,
  brandName: string,
  domain: string,
  locationHint: string | undefined,
  apiKey: string,
): Promise<QuerySpec[]> {
  const fallback = buildFallbackQueries(
    sector, valueProposition, keywords, brandName, domain, locationHint,
  );
  const loc = locationHint
    ? `\n- Ubicación: ${locationHint} (úsala en consultas geográficas, NUNCA uses "[ciudad]")`
    : '';

  const prompt =
    `Genera exactamente 12 consultas que un potencial cliente real escribiría en ChatGPT o Perplexity buscando ${sector}.\n\n` +
    `Contexto:\n- Sector: ${sector}\n- Propuesta de valor: ${valueProposition.slice(0, 120)}\n` +
    `- Servicios/keywords: ${keywords.slice(0, 80)}${loc}\n\n` +
    `Estructura ESTRICTA (exactamente en este orden, 4 de cada etapa):\n` +
    `- 4 consultas TOFU (posiciones 1-4): consciencia del sector, descubrimiento, tendencias. SIN mencionar "${brandName}" ni "${domain}".\n` +
    `- 4 consultas MOFU (posiciones 5-8): comparativas, alternativas, problemas concretos. SIN mencionar "${brandName}" ni "${domain}".\n` +
    `- 3 consultas BOFU (posiciones 9-11): alta intención de compra/contratación. SIN nombre de marca.\n` +
    `- 1 consulta BOFU_brand (posición 12): pregunta directa sobre "${brandName}" (${domain}). DEBE mencionarlo explícitamente.\n\n` +
    `Reglas:\n` +
    `1. Consultas TOFU y MOFU NUNCA incluyen "${brandName}" ni "${domain}".\n` +
    `2. La última consulta (posición 12, BOFU_brand) DEBE incluir "${brandName}" o "${domain}".\n` +
    `3. Idioma: el mismo que los textos del negocio.\n` +
    `4. NUNCA uses placeholders entre corchetes. Usa siempre términos reales.\n` +
    `5. EXACTAMENTE 4 TOFU + 4 MOFU + 3 BOFU + 1 BOFU_brand = 12 total.\n\n` +
    `Devuelve SOLO un JSON array de 12 objetos:\n` +
    `[{"stage":"tofu","query":"..."},...,{"stage":"bofu","query":"...","isBrandQuery":true}]\n` +
    `Sin texto adicional, sin markdown.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: 'Responde SOLO con JSON válido. Sin markdown. Sin texto adicional.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as any;
    const raw = (data?.choices?.[0]?.message?.content || '') as string;
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return fallback;
    const arr = JSON.parse(match[0]) as any[];
    if (!Array.isArray(arr) || arr.length < 10) return fallback;
    const specs: QuerySpec[] = arr
      .filter((q: any) => q.stage && q.query && typeof q.query === 'string' && q.query.length > 10)
      .map((q: any) => ({
        stage: (q.stage as Stage) in { tofu: 1, mofu: 1, bofu: 1 } ? (q.stage as Stage) : 'mofu',
        query: q.query as string,
        isBrandQuery: !!q.isBrandQuery,
      }))
      .slice(0, 12);
    return specs.length >= 10 ? specs : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

// ── Main export ───────────────────────────────────────────────────

export async function runGEO(
  url: string,
  sector: string,
  crawl: CrawlResult,
  competitors?: Array<{ name: string; url: string }>,
): Promise<GeoResult> {
  if (!OPENAI_KEY) {
    return { skipped: true, reason: 'OPENAI_API_KEY not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  const brandName = crawl.companyName || domain;
  const locationHint = crawl.locationHint;
  const valueProposition = crawl.description?.slice(0, 120) || '';
  const keywords = crawl.h1s?.[0] || valueProposition.split(/[,.:]/)[0] || sector;

  // Configure engines — add each available engine
  const engines: Engine[] = [
    {
      name: 'ChatGPT',
      apiKey: OPENAI_KEY,
      type: 'openai_compat',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    },
    ...(PERPLEXITY_KEY
      ? [{
          name: 'Perplexity',
          apiKey: PERPLEXITY_KEY,
          type: 'openai_compat' as EngineType,
          baseUrl: 'https://api.perplexity.ai',
          model: 'llama-3.1-sonar-small-128k-online',
        }]
      : []),
    ...(ANTHROPIC_KEY
      ? [{
          name: 'Claude',
          apiKey: ANTHROPIC_KEY,
          type: 'anthropic' as EngineType,
          model: 'claude-haiku-4-5-20251001',
        }]
      : []),
    ...(GEMINI_KEY
      ? [{
          name: 'Gemini',
          apiKey: GEMINI_KEY,
          type: 'gemini' as EngineType,
          model: 'gemini-2.0-flash',
        }]
      : []),
    ...(DEEPSEEK_KEY
      ? [{
          name: 'DeepSeek',
          apiKey: DEEPSEEK_KEY,
          type: 'openai_compat' as EngineType,
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
        }]
      : []),
  ];

  // Generate structured 12-query set
  const querySpecs = await generateQueries(
    sector, valueProposition, keywords, brandName, domain, locationHint, OPENAI_KEY,
  );

  try {
    // Run ALL queries × ALL engines in parallel
    // Promise.allSettled: if one engine times out or errors, others still contribute
    const runResults = await Promise.all(
      querySpecs.map(async (spec) => {
        const settled = await Promise.allSettled(
          engines.map(async (engine) => {
            const answer = await askEngine(spec.query, engine);
            const isMentioned = detectMention(answer, domain, brandName);
            const mentioned = isMentioned
              ? (spec.isBrandQuery ? !hasDenialNearBrand(answer, domain, brandName) : true)
              : false;
            return { engineName: engine.name, answer, mentioned };
          }),
        );
        // Map settled results — failed engines contribute empty/false
        const engineOutputs = settled.map((s, i) =>
          s.status === 'fulfilled'
            ? s.value
            : { engineName: engines[i].name, answer: '', mentioned: false },
        );
        // Union logic: mentioned if ANY engine mentions it
        const mentioned = engineOutputs.some((e) => e.mentioned);
        return { spec, engineOutputs, mentioned };
      }),
    );

    // If ALL answers are empty → API down
    if (runResults.every((r) => r.engineOutputs.every((e) => e.answer.length === 0))) {
      return {
        queries: [],
        overallScore: 0,
        brandScore: 0,
        sectorScore: 0,
        mentionRate: 0,
        error: 'APIs no respondieron (timeout o rate limit) — reintenta en unos minutos',
      };
    }

    // Compute competitor mentions from already-fetched AI answers (zero extra API calls)
    const competitorMentions: GeoCompetitorMention[] = (competitors || []).map((comp) => {
      const compDomain = new URL(comp.url.startsWith('http') ? comp.url : `https://${comp.url}`)
        .hostname.replace(/^www\./, '');
      let mentionCount = 0;
      for (const r of runResults) {
        const isMentioned = r.engineOutputs.some((e) =>
          detectMention(e.answer, compDomain, comp.name),
        );
        if (isMentioned) mentionCount++;
      }
      return {
        name: comp.name,
        domain: compDomain,
        mentions: mentionCount,
        total: runResults.length,
        mentionRate:
          runResults.length > 0 ? Math.round((mentionCount / runResults.length) * 100) : 0,
      };
    });

    // Build GeoQuery objects
    const queries: GeoQuery[] = runResults.map((r) => ({
      query: r.spec.query,
      mentioned: r.mentioned,
      stage: r.spec.stage,
      isBrandQuery: r.spec.isBrandQuery,
      context: r.mentioned
        ? (r.engineOutputs.find((e) => e.mentioned)?.answer || '').slice(0, 200)
        : undefined,
      engines: r.engineOutputs.map((e) => ({
        name: e.engineName,
        mentioned: e.mentioned,
        context: e.mentioned ? e.answer.slice(0, 150) : undefined,
      })),
    }));

    const total = queries.length;
    const mentionCount = queries.filter((q) => q.mentioned).length;
    const mentionRate = total > 0 ? Math.round((mentionCount / total) * 100) : 0;

    // Funnel breakdown
    const tofuQ = queries.filter((q) => q.stage === 'tofu');
    const mofuQ = queries.filter((q) => q.stage === 'mofu');
    const bofuQ = queries.filter((q) => q.stage === 'bofu');
    const funnelBreakdown = {
      tofu: { mentioned: tofuQ.filter((q) => q.mentioned).length, total: tofuQ.length },
      mofu: { mentioned: mofuQ.filter((q) => q.mentioned).length, total: mofuQ.length },
      bofu: { mentioned: bofuQ.filter((q) => q.mentioned).length, total: bofuQ.length },
    };

    // Cross-model breakdown
    const crossModel = engines.map((engine) => ({
      name: engine.name,
      mentioned: runResults.filter(
        (r) => r.engineOutputs.find((e) => e.engineName === engine.name)?.mentioned,
      ).length,
      total,
    }));

    // Weighted score: TOFU mentions are most valuable (organic, unprompted)
    const STAGE_WEIGHTS: Record<Stage, number> = { tofu: 1.5, mofu: 1.0, bofu: 0.8 };
    const BRAND_QUERY_WEIGHT = 0.3; // Direct brand query is the easiest to get
    let weightedMentioned = 0;
    let weightedTotal = 0;
    for (const r of runResults) {
      const w = r.spec.isBrandQuery ? BRAND_QUERY_WEIGHT : STAGE_WEIGHTS[r.spec.stage];
      weightedTotal += w;
      if (r.mentioned) weightedMentioned += w;
    }
    const overallScore = weightedTotal > 0 ? Math.round((weightedMentioned / weightedTotal) * 100) : 0;

    // Legacy sub-scores (backward compat with report pages)
    const sectorScore =
      tofuQ.length > 0 ? Math.round((tofuQ.filter((q) => q.mentioned).length / tofuQ.length) * 100) : 0;
    const brandScore =
      bofuQ.length > 0 ? Math.round((bofuQ.filter((q) => q.mentioned).length / bofuQ.length) * 100) : 0;

    return {
      queries,
      overallScore,
      brandScore,
      sectorScore,
      mentionRate,
      funnelBreakdown,
      crossModel,
      competitorMentions: competitorMentions.length > 0 ? competitorMentions : undefined,
    };
  } catch (err: any) {
    return {
      queries: [],
      overallScore: 0,
      brandScore: 0,
      sectorScore: 0,
      mentionRate: 0,
      error: err?.message?.slice(0, 100),
    };
  }
}
