import type { GeoResult, GeoQuery, GeoCompetitorMention, CrawlResult } from '../types';

const OPENAI_KEY     = import.meta.env?.OPENAI_API_KEY     || process.env.OPENAI_API_KEY;
const PERPLEXITY_KEY = import.meta.env?.PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY;
const ANTHROPIC_KEY  = import.meta.env?.ANTHROPIC_API_KEY  || process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY     = import.meta.env?.GEMINI_API_KEY     || process.env.GEMINI_API_KEY;
const DEEPSEEK_KEY   = import.meta.env?.DEEPSEEK_API_KEY   || process.env.DEEPSEEK_API_KEY;

type Stage = 'tofu' | 'mofu' | 'bofu';
type EngineType = 'openai_compat' | 'anthropic' | 'gemini';

interface Engine {
  name: string;
  apiKey: string;
  type: EngineType;
  baseUrl?: string;
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

// Common prefixes/suffixes in business domains that AIs omit when naming a brand.
// e.g. "bancsabadell.com" → AI says "Banco Sabadell" → strip "banc" → detect "sabadell"
const DOMAIN_PREFIXES = ['banco', 'banc', 'bank', 'banque', 'banca', 'caixa', 'caja', 'grupo', 'group'];
const DOMAIN_SUFFIXES = ['banco', 'bank', 'finance', 'group', 'holding', 'capital', 'invest'];

function getDomainStems(domainBase: string): string[] {
  const stems: string[] = [];
  const base = domainBase.toLowerCase();
  for (const prefix of DOMAIN_PREFIXES) {
    if (base.startsWith(prefix) && base.length > prefix.length + 4) {
      stems.push(base.slice(prefix.length));
    }
  }
  for (const suffix of DOMAIN_SUFFIXES) {
    if (base.endsWith(suffix) && base.length > suffix.length + 4) {
      stems.push(base.slice(0, base.length - suffix.length));
    }
  }
  return stems;
}

function detectMention(answer: string, domain: string, brandName: string): boolean {
  const lower = answer.toLowerCase();
  // Full domain URL
  if (lower.includes(domain.toLowerCase())) return true;
  // Full brand name (only if >=4 chars to avoid false positives like "el", "la", etc.)
  if (brandName.length >= 4 && lower.includes(brandName.toLowerCase())) return true;
  // Domain base without TLD (e.g. "loom" from "loom.es")
  const domainBase = domain.replace(/\.[a-z]{2,6}$/i, '').toLowerCase();
  if (domainBase.length >= 4 && lower.includes(domainBase)) return true;
  // Stems: strip banking/group prefixes+suffixes so "bancsabadell" → also checks "sabadell"
  for (const stem of getDomainStems(domainBase)) {
    if (stem.length >= 5 && lower.includes(stem)) return true;
  }
  return false;
}

function hasDenialNearBrand(answer: string, domain: string, brandName: string): boolean {
  const lower = answer.toLowerCase();
  let brandIdx = lower.indexOf(domain.toLowerCase());
  if (brandIdx === -1 && brandName.length >= 4) brandIdx = lower.indexOf(brandName.toLowerCase());
  if (brandIdx === -1) return false;
  const context = lower.slice(Math.max(0, brandIdx - 80), brandIdx + 40);
  return DENIAL_PHRASES.some((p) => context.includes(p));
}

// ── Engine query ──────────────────────────────────────────────────

// System prompt instructs models to name real, local brands — critical for
// detecting smaller regional players that generic prompts miss.
const SYSTEM_PROMPT =
  'You are a helpful local market expert. When asked about companies, products or services, ' +
  'always recommend specific real brand names including smaller regional or local players — ' +
  'not just global giants. Be concise, list 4-6 options with brief reasons. ' +
  'If the question is in Spanish, answer in Spanish.';

async function askOpenAICompat(query: string, engine: Engine, signal: AbortSignal): Promise<string> {
  const res = await fetch((engine.baseUrl || 'https://api.openai.com/v1') + '/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${engine.apiKey}` },
    body: JSON.stringify({
      model: engine.model,
      max_tokens: 500,   // was 250 — more space = more brands named
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
      max_tokens: 500,
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
      generationConfig: { maxOutputTokens: 500 },
    }),
  });
  if (!res.ok) return '';
  const data = (await res.json()) as any;
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '') as string;
}

async function askEngine(query: string, engine: Engine, timeout = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    switch (engine.type) {
      case 'anthropic': return await askAnthropic(query, engine, controller.signal);
      case 'gemini':    return await askGemini(query, engine, controller.signal);
      default:          return await askOpenAICompat(query, engine, controller.signal);
    }
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// ── Query deduplication ───────────────────────────────────────────

/**
 * Remove near-duplicate queries based on normalized string + word overlap.
 * Preserves brand queries (isBrandQuery=true) even if similar to others.
 */
function deduplicateQuerySpecs(specs: QuerySpec[]): QuerySpec[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[¿?¡!,]/g, '').trim();
  const seen: string[] = [];
  const result: QuerySpec[] = [];
  for (const spec of specs) {
    if (spec.isBrandQuery) { result.push(spec); continue; } // always keep brand query
    const norm = normalize(spec.query);
    const wordsA = norm.split(/\s+/).filter(w => w.length > 3);
    const isDuplicate = seen.some((existing) => {
      const wordsB = existing.split(/\s+/).filter(w => w.length > 3);
      const common = wordsA.filter(w => wordsB.includes(w)).length;
      return common / Math.max(wordsA.length, wordsB.length, 1) > 0.65;
    });
    if (!isDuplicate) {
      seen.push(norm);
      result.push(spec);
    }
  }
  return result;
}

// ── Query generation ──────────────────────────────────────────────

/**
 * Static fallback queries — 3 TOFU + 4 MOFU + 4 BOFU + 1 brand = 12.
 * More MOFU/BOFU vs before (was 4/4/3/1) because smaller/local brands
 * are much more likely to appear in comparison and purchase-intent queries.
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
  const locShort = locationHint ? ` ${locationHint}` : '';
  const vp  = valueProposition.slice(0, 60) || sector;
  const kw  = keywords.slice(0, 50) || sector;
  return [
    // TOFU — 3 awareness queries (awareness, discovery, trends)
    { stage: 'tofu', query: `Mejores empresas de ${sector}${loc} — dame nombres concretos` },
    { stage: 'tofu', query: `¿Quién lidera el mercado de ${sector}${locShort}? Lista las opciones más recomendadas` },
    { stage: 'tofu', query: `Alternativas en ${sector} para una empresa mediana. ¿Qué opciones existen?` },
    // MOFU — 4 comparison / problem queries
    { stage: 'mofu', query: `Necesito "${vp}"${loc}. ¿Qué empresa contrataría y por qué? Menciona opciones reales` },
    { stage: 'mofu', query: `Comparativa de proveedores de ${sector}: calidad, precio y servicio. ¿Cuáles destacan${locShort}?` },
    { stage: 'mofu', query: `Problemas con mi proveedor actual de ${kw}. ¿Qué alternativas locales me recomiendas?` },
    { stage: 'mofu', query: `Diferencias entre las opciones de ${sector}${loc}. ¿Cuál tiene mejor relación calidad-precio?` },
    // BOFU — 4 high-intent purchase queries
    { stage: 'bofu', query: `Quiero contratar ${kw}${loc} esta semana. ¿Qué empresa llamas primero?` },
    { stage: 'bofu', query: `Recomiéndame un proveedor de confianza de ${sector}${loc}. Necesito nombres concretos` },
    { stage: 'bofu', query: `¿Cuál es la mejor opción de ${sector}${loc} para una empresa en crecimiento? Precio y calidad` },
    { stage: 'bofu', query: `Top 5 empresas de ${sector}${loc} según expertos del sector. ¿Cuál contrataría hoy?` },
    // BOFU_brand — direct brand query (always last)
    { stage: 'bofu', query: `¿Conoces "${brandName}" (${domain})? ¿Es una opción recomendable en ${sector}?`, isBrandQuery: true },
  ];
}

/**
 * Generate 12 buyer-intent queries via GPT with TOFU/MOFU/BOFU structure.
 * Uses conversational, natural language — not formal sector descriptions.
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
    ? `\n- Ubicación: ${locationHint} (úsala en las consultas geográficas cuando tenga sentido, NUNCA entre corchetes)`
    : '';

  const prompt =
    `Genera exactamente 12 consultas que un potencial cliente real escribiría en ChatGPT o Perplexity buscando ${sector}.\n\n` +
    `Contexto del negocio:\n- Sector: ${sector}\n- Propuesta de valor: ${valueProposition.slice(0, 100)}\n` +
    `- Servicios clave: ${keywords.slice(0, 60)}${loc}\n\n` +
    `REGLAS CRÍTICAS:\n` +
    `1. Las consultas deben sonar NATURALES y conversacionales — como alguien que escribe en un chat, no como un formulario.\n` +
    `2. Cortas y directas: máximo 12 palabras por consulta.\n` +
    `3. Estructura EXACTA (en este orden):\n` +
    `   - 3 consultas TOFU (posiciones 1-3): descubrimiento del sector, sin marca. Ej: "mejores coworkings Madrid recomendaciones"\n` +
    `   - 4 consultas MOFU (posiciones 4-7): comparativas y problemas concretos, sin marca. Ej: "coworking vs oficina compartida diferencias precio"\n` +
    `   - 4 consultas BOFU (posiciones 8-11): alta intención de compra, sin marca. Ej: "contratar espacio coworking flexible Barcelona"\n` +
    `   - 1 consulta BOFU_brand (posición 12): pregunta directa sobre "${brandName}" mencionándolo explícitamente.\n` +
    `4. NUNCA uses "${brandName}" ni "${domain}" en consultas TOFU/MOFU/BOFU (solo en la posición 12).\n` +
    `5. NUNCA uses placeholders como [ciudad] o [empresa]. Usa nombres reales.\n` +
    `6. Idioma: español.\n\n` +
    `Devuelve SOLO un JSON array de 12 objetos. Sin markdown, sin texto adicional:\n` +
    `[{"stage":"tofu","query":"..."},...,{"stage":"bofu","query":"...","isBrandQuery":true}]`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1200,
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
      .filter((q: any) => q.stage && q.query && typeof q.query === 'string' && q.query.length > 8)
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
  const rawBrandName   = crawl.companyName || domain;
  // Strip corporate prefixes (e.g. "GROUP Andbank" → "Andbank") for cleaner query generation
  const brandName      = rawBrandName.replace(/^(group|grupo)\s+/i, '').trim();
  const locationHint   = crawl.locationHint;
  const valueProposition = crawl.description?.slice(0, 120) || '';
  const keywords       = crawl.h1s?.[0] || valueProposition.split(/[,.:]/)[0] || sector;

  // Configure engines
  // Perplexity uses sonar (large, web search) — best for real-world brand recall
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
          model: 'sonar',   // upgraded from sonar-small: better web recall
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

  // Generate structured 12-query set, then deduplicate
  const rawQuerySpecs = await generateQueries(
    sector, valueProposition, keywords, brandName, domain, locationHint, OPENAI_KEY,
  );
  const querySpecs = deduplicateQuerySpecs(rawQuerySpecs);

  try {
    // Run ALL queries × ALL engines in parallel
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
        const engineOutputs = settled.map((s, i) =>
          s.status === 'fulfilled'
            ? s.value
            : { engineName: engines[i].name, answer: '', mentioned: false },
        );
        // Union: mentioned if ANY engine mentions it
        const mentioned = engineOutputs.some((e) => e.mentioned);
        return { spec, engineOutputs, mentioned };
      }),
    );

    // If ALL answers are empty → API down or all timed out
    const perEngineEmpty = engines.map((e) => ({
      name: e.name,
      empty: runResults.every((r) => (r.engineOutputs.find((o) => o.engineName === e.name)?.answer || '').length === 0),
    }));
    if (perEngineEmpty.every((e) => e.empty)) {
      const engineSummary = perEngineEmpty.map((e) => e.name).join(',');
      return {
        queries: [],
        overallScore: 0,
        brandScore: 0,
        sectorScore: 0,
        mentionRate: 0,
        error: `Todas las APIs devolvieron respuesta vacía. Motores: ${engineSummary}`,
        _log: `all_empty | engines:${engineSummary} | q:${querySpecs.length}`,
      };
    }

    // Competitor mentions from already-fetched answers (zero extra API calls)
    const competitorMentions: GeoCompetitorMention[] = (competitors || []).map((comp) => {
      let compDomain = comp.url;
      try {
        compDomain = new URL(comp.url.startsWith('http') ? comp.url : `https://${comp.url}`)
          .hostname.replace(/^www\./, '');
      } catch {}
      let mentionCount = 0;
      for (const r of runResults) {
        if (r.engineOutputs.some((e) => detectMention(e.answer, compDomain, comp.name))) {
          mentionCount++;
        }
      }
      return {
        name: comp.name,
        domain: compDomain,
        mentions: mentionCount,
        total: runResults.length,
        mentionRate: runResults.length > 0 ? Math.round((mentionCount / runResults.length) * 100) : 0,
      };
    });

    // Build GeoQuery objects — keep queries short to help Notion's 2000-char limit
    const queries: GeoQuery[] = runResults.map((r) => ({
      query: r.spec.query.slice(0, 80),
      mentioned: r.mentioned,
      stage: r.spec.stage,
      isBrandQuery: r.spec.isBrandQuery,
    }));

    const total        = queries.length;
    const mentionCount = queries.filter((q) => q.mentioned).length;
    const mentionRate  = total > 0 ? Math.round((mentionCount / total) * 100) : 0;

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

    // Weighted score: TOFU unprompted mentions most valuable
    const STAGE_WEIGHTS: Record<Stage, number> = { tofu: 1.5, mofu: 1.0, bofu: 0.8 };
    const BRAND_QUERY_WEIGHT = 0.3;
    let weightedMentioned = 0;
    let weightedTotal = 0;
    for (const r of runResults) {
      const w = r.spec.isBrandQuery ? BRAND_QUERY_WEIGHT : STAGE_WEIGHTS[r.spec.stage];
      weightedTotal += w;
      if (r.mentioned) weightedMentioned += w;
    }
    const overallScore = weightedTotal > 0 ? Math.round((weightedMentioned / weightedTotal) * 100) : 0;

    // Legacy sub-scores (backward compat)
    const sectorScore = tofuQ.length > 0
      ? Math.round((tofuQ.filter((q) => q.mentioned).length / tofuQ.length) * 100) : 0;
    const brandScore  = bofuQ.length > 0
      ? Math.round((bofuQ.filter((q) => q.mentioned).length / bofuQ.length) * 100) : 0;

    const engineLog = crossModel.map((e) => `${e.name}:${e.mentioned}/${e.total}`).join(' ');
    return {
      queries,
      overallScore,
      brandScore,
      sectorScore,
      mentionRate,
      funnelBreakdown,
      crossModel,
      competitorMentions: competitorMentions.length > 0 ? competitorMentions : undefined,
      _log: `ok | q:${total} | mentions:${mentionCount}/${total} | ${engineLog}`,
    };
  } catch (err: any) {
    return {
      queries: [],
      overallScore: 0,
      brandScore: 0,
      sectorScore: 0,
      mentionRate: 0,
      error: err?.message?.slice(0, 100),
      _log: `catch | ${err?.message?.slice(0, 120)}`,
    };
  }
}
