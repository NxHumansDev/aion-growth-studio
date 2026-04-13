import type { GeoResult, GeoQuery, GeoCompetitorMention, GeoCategory, CrawlResult } from '../types';

const OPENAI_KEY     = import.meta.env?.OPENAI_API_KEY     || process.env.OPENAI_API_KEY;
const PERPLEXITY_KEY = import.meta.env?.PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY;
const ANTHROPIC_KEY  = import.meta.env?.ANTHROPIC_API_KEY  || process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY     = import.meta.env?.GEMINI_API_KEY     || process.env.GEMINI_API_KEY;
const DEEPSEEK_KEY   = import.meta.env?.DEEPSEEK_API_KEY   || process.env.DEEPSEEK_API_KEY;

type Stage = 'tofu' | 'mofu' | 'bofu';

const CATEGORY_TO_STAGE: Record<GeoCategory, Stage> = {
  sector: 'tofu', problema: 'mofu', comparativa: 'mofu',
  decision: 'bofu', recomendacion: 'bofu', marca: 'bofu',
};

const CATEGORY_WEIGHTS: Record<GeoCategory, number> = {
  sector: 1.0,        // "mejores empresas de X"
  problema: 1.2,      // "cómo resolver Y"
  comparativa: 1.5,   // "alternativas a Z"
  decision: 2.0,      // "contratar X esta semana"
  recomendacion: 1.8, // "recomiéndame un proveedor de X"
  marca: 0.5,         // direct brand query (biased)
};
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
  category: GeoCategory;
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

async function askEngine(query: string, engine: Engine, timeout = 120_000): Promise<string> {
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
 * Static fallback queries — ~3 per category × 6 categories + 2 marca = 20.
 * 6 intent categories: sector, problema, comparativa, decision, recomendacion, marca.
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
  const locS = locationHint ? ` ${locationHint}` : '';
  const vp  = valueProposition.slice(0, 60) || sector;
  const kw  = keywords.slice(0, 50) || sector;
  return [
    // SECTOR (3)
    { stage: 'tofu', category: 'sector', query: `Mejores empresas de ${sector}${loc} — dame nombres concretos` },
    { stage: 'tofu', category: 'sector', query: `¿Quién lidera el mercado de ${sector}${locS}? Lista opciones recomendadas` },
    { stage: 'tofu', category: 'sector', query: `Principales actores de ${sector}${loc}. ¿Cuáles son los más conocidos?` },
    // PROBLEMA (3)
    { stage: 'mofu', category: 'problema', query: `Necesito "${vp}"${loc}. ¿Qué empresa me puede ayudar?` },
    { stage: 'mofu', category: 'problema', query: `Problemas con mi proveedor actual de ${kw}. ¿Qué alternativas existen?` },
    { stage: 'mofu', category: 'problema', query: `Mi empresa necesita mejorar en ${kw}. ¿Quién lo hace bien${locS}?` },
    // COMPARATIVA (3)
    { stage: 'mofu', category: 'comparativa', query: `Comparativa de proveedores de ${sector}${loc}: calidad, precio y servicio` },
    { stage: 'mofu', category: 'comparativa', query: `Diferencias entre las opciones de ${sector}${loc}. ¿Cuál tiene mejor relación calidad-precio?` },
    { stage: 'mofu', category: 'comparativa', query: `Alternativas en ${sector} para una empresa mediana. Pros y contras` },
    // DECISION (4)
    { stage: 'bofu', category: 'decision', query: `Quiero contratar ${kw}${loc} esta semana. ¿A quién llamo primero?` },
    { stage: 'bofu', category: 'decision', query: `Necesito presupuesto para ${kw}${loc}. ¿Qué empresas contacto?` },
    { stage: 'bofu', category: 'decision', query: `¿Cuál es la mejor opción de ${sector}${loc} para una empresa en crecimiento?` },
    { stage: 'bofu', category: 'decision', query: `Estoy decidiendo entre proveedores de ${kw}${loc}. ¿Cuál me recomiendas?` },
    // RECOMENDACION (3)
    { stage: 'bofu', category: 'recomendacion', query: `Recomiéndame un proveedor de confianza de ${sector}${loc}` },
    { stage: 'bofu', category: 'recomendacion', query: `¿Qué empresa de ${sector}${locS} recomendarías a un amigo?` },
    { stage: 'bofu', category: 'recomendacion', query: `Opiniones de empresas de ${sector}${loc}. ¿Cuál tiene mejor reputación?` },
    // MARCA (4) — direct brand queries
    { stage: 'bofu', category: 'marca', query: `¿Conoces "${brandName}" (${domain})? ¿Es recomendable en ${sector}?`, isBrandQuery: true },
    { stage: 'bofu', category: 'marca', query: `Opiniones sobre ${brandName}. ¿Merece la pena para ${kw}?`, isBrandQuery: true },
    { stage: 'bofu', category: 'marca', query: `${brandName} vs competidores de ${sector}${locS}. ¿Cómo se compara?`, isBrandQuery: true },
    { stage: 'bofu', category: 'marca', query: `¿Qué tal es ${brandName}? Busco opiniones reales de ${sector}`, isBrandQuery: true },
  ];
}

/**
 * Generate 30 buyer-intent queries via GPT across 6 intent categories.
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
    ? `\n- Ubicación: ${locationHint} (úsala cuando tenga sentido, NUNCA entre corchetes)`
    : '';

  const prompt =
    `Genera exactamente 20 consultas que potenciales clientes escribirían en ChatGPT o Perplexity cuando buscan lo que ofrece "${brandName}" (${domain}).\n\n` +
    `IMPORTANTE — ANALIZA PRIMERO:\n` +
    `- Empresa: ${brandName} (${domain})\n` +
    `- Sector declarado: ${sector}\n` +
    `- Propuesta de valor: ${valueProposition.slice(0, 150)}\n` +
    `- Servicios clave: ${keywords.slice(0, 80)}${loc}\n\n` +
    `Antes de generar queries, piensa: ¿qué buscaría REALMENTE un cliente de ${brandName}? ` +
    `No generes queries genéricas del sector — genera queries sobre lo que esta empresa CONCRETAMENTE vende o hace. ` +
    `Ejemplo: El Corte Inglés NO es "plataforma de e-commerce" — es grandes almacenes. Un mayorista de fruta NO compite con supermercados.\n\n` +
    `ESTRUCTURA EXACTA — 20 consultas en 6 categorías:\n` +
    `1. "sector" (3): descubrimiento. Ej: "mejores [lo que hace ${brandName}]"\n` +
    `2. "problema" (3): dolor o necesidad del cliente. Ej: "cómo resolver Y"\n` +
    `3. "comparativa" (3): comparar opciones. Ej: "diferencias entre X e Y"\n` +
    `4. "decision" (4): alta intención de compra. Ej: "dónde comprar X"\n` +
    `5. "recomendacion" (3): pedir consejo. Ej: "recomiéndame un X de confianza"\n` +
    `6. "marca" (4): preguntas sobre "${brandName}". Ej: "¿qué tal es ${brandName}?"\n\n` +
    `REGLAS:\n` +
    `- Queries sobre lo que ${brandName} REALMENTE ofrece, no queries genéricas del sector\n` +
    `- Naturales y conversacionales, máximo 15 palabras\n` +
    `- Solo en categoría "marca" se usa "${brandName}"\n` +
    `- NUNCA placeholders como [ciudad]. Usa nombres reales\n` +
    `- Idioma: español\n\n` +
    `JSON array de 20 objetos, sin markdown:\n` +
    `[{"category":"sector","query":"..."},{"category":"problema","query":"..."},...,{"category":"marca","query":"...","isBrandQuery":true}]`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        messages: [
          { role: 'system', content: 'Responde SOLO con JSON válido. Sin markdown.' },
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
    if (!Array.isArray(arr) || arr.length < 15) return fallback;
    const validCategories = new Set(['sector','problema','comparativa','decision','recomendacion','marca']);
    const specs: QuerySpec[] = arr
      .filter((q: any) => q.category && q.query && typeof q.query === 'string' && q.query.length > 8)
      .map((q: any) => {
        const cat = validCategories.has(q.category) ? q.category as GeoCategory : 'sector';
        return {
          stage: CATEGORY_TO_STAGE[cat],
          category: cat,
          query: q.query as string,
          isBrandQuery: cat === 'marca' || !!q.isBrandQuery,
        };
      })
      .slice(0, 20);
    return specs.length >= 15 ? specs : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

// ── Main export ───────────────────────────────────────────────────

/**
 * @param samples Number of times to query each engine per prompt.
 *   1 = single-shot (audit gratis, fast, cheap)
 *   3 = multi-sampling (Radar, stable, ~3× cost)
 *   The `mentioned` flag uses majority vote when samples > 1.
 */
export async function runGEO(
  url: string,
  sector: string,
  crawl: CrawlResult,
  competitors?: Array<{ name: string; url: string }>,
  samples: number = 1,
): Promise<GeoResult> {
  if (!OPENAI_KEY) {
    return { skipped: true, reason: 'OPENAI_API_KEY not configured' };
  }

  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  const rawBrandName   = crawl.companyName || domain;
  // Strip corporate prefixes (e.g. "GROUP Andbank" → "Andbank") for cleaner query generation
  const brandName      = rawBrandName.replace(/^(group|grupo)\s+/i, '').trim();
  const locationHint   = crawl.locationHint;

  // When crawler was blocked (WAF, 403, etc.), the title/description are from
  // the error page (e.g. "Azure WAF JS Challenge"), NOT the real site content.
  // Use only sector + brandName for query generation — never infrastructure text.
  const isCrawlerBlocked = !!(crawl as any).crawlerBlocked;
  const valueProposition = isCrawlerBlocked ? sector : (crawl.description?.slice(0, 120) || '');
  const keywords = isCrawlerBlocked ? sector : (crawl.h1s?.[0] || valueProposition.split(/[,.:]/)[0] || sector);
  if (isCrawlerBlocked) {
    console.log(`[geo] Crawler blocked — using sector "${sector}" instead of crawl data for query generation`);
  }

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

  // Generate queries
  const t0 = Date.now();
  const rawQuerySpecs = (await generateQueries(
    sector, valueProposition, keywords, brandName, domain, locationHint, OPENAI_KEY,
  ))
  // Filter out queries about infrastructure/technology — these are never about
  // the client's business. Happens when crawler hits a WAF page and the query
  // generator picks up terms like "Azure WAF", "Cloudflare", "CDN", etc.
  .filter(spec => {
    const INFRA_RE = /\b(waf|cdn|ssl|tls|cloudflare|akamai|azure|aws|nginx|apache|captcha|firewall|dns|http|servidor|server|hosting|cpanel|plesk|varnish|load.balancer)\b/i;
    if (INFRA_RE.test(spec.query)) {
      console.log(`[geo] Filtered infra query: "${spec.query.slice(0, 60)}"`);
      return false;
    }
    return true;
  });
  const querySpecs = deduplicateQuerySpecs(rawQuerySpecs);
  const effectiveSamples = Math.max(1, Math.min(5, samples));
  console.log(`[geo] queries generated: ${querySpecs.length} (${Date.now() - t0}ms) | engines: ${engines.map(e => e.name).join(',')} | samples: ${effectiveSamples}`);

  try {
    // Run ALL queries × ALL engines × N samples in parallel.
    // For samples=1 (audit), this is identical to before.
    // For samples=3 (Radar), each query×engine runs 3 times and we
    // use majority vote — mentioned if ≥50% of samples detected the brand.
    const t1 = Date.now();
    const runResults = await Promise.all(
      querySpecs.map(async (spec) => {
        const settled = await Promise.allSettled(
          engines.map(async (engine) => {
            // Run N samples for this query×engine
            let mentionedCount = 0;
            let lastAnswer = '';
            for (let s = 0; s < effectiveSamples; s++) {
              const answer = await askEngine(spec.query, engine);
              if (!answer) continue;
              lastAnswer = answer;
              const isMentioned = detectMention(answer, domain, brandName);
              const confirmed = isMentioned
                ? (spec.isBrandQuery ? !hasDenialNearBrand(answer, domain, brandName) : true)
                : false;
              if (confirmed) mentionedCount++;
            }
            // Majority vote: mentioned if ≥50% of samples detected the brand
            const mentioned = mentionedCount >= Math.ceil(effectiveSamples / 2);
            const stabilityRate = effectiveSamples > 0
              ? Math.round((mentionedCount / effectiveSamples) * 100)
              : 0;
            return { engineName: engine.name, answer: lastAnswer, mentioned, stabilityRate };
          }),
        );
        const engineOutputs = settled.map((s, i) =>
          s.status === 'fulfilled'
            ? s.value
            : { engineName: engines[i].name, answer: '', mentioned: false, stabilityRate: 0 },
        );
        // Union: mentioned if ANY engine's majority vote says yes
        const mentioned = engineOutputs.some((e) => e.mentioned);
        // Overall stability for this query: average across engines
        const avgStability = engineOutputs.length > 0
          ? Math.round(engineOutputs.reduce((s, e) => s + e.stabilityRate, 0) / engineOutputs.length)
          : 0;
        return { spec, engineOutputs, mentioned, stabilityRate: avgStability };
      }),
    );

    console.log(`[geo] all queries executed: ${runResults.length} results × ${effectiveSamples} samples (${Date.now() - t1}ms)`);

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

    // Build GeoQuery objects
    const queries: GeoQuery[] = runResults.map((r) => ({
      query: r.spec.query.slice(0, 80),
      mentioned: r.mentioned,
      stage: r.spec.stage,
      category: r.spec.category,
      isBrandQuery: r.spec.isBrandQuery,
      engines: r.engineOutputs.map((e) => ({ name: e.engineName, mentioned: e.mentioned })),
      stabilityRate: r.stabilityRate,
      samplesRun: effectiveSamples,
    }));

    const total        = queries.length;
    const mentionCount = queries.filter((q) => q.mentioned).length;
    const mentionRate  = total > 0 ? Math.round((mentionCount / total) * 100) : 0;

    // Confidence range (Wilson score interval approximation)
    const p = total > 0 ? mentionCount / total : 0;
    const z = 1.96; // 95% CI
    const margin = total > 0 ? z * Math.sqrt((p * (1 - p)) / total) : 0;
    const mentionRangeLow  = Math.max(0, Math.round((p - margin) * 100));
    const mentionRangeHigh = Math.min(100, Math.round((p + margin) * 100));

    // Funnel breakdown
    const tofuQ = queries.filter((q) => q.stage === 'tofu');
    const mofuQ = queries.filter((q) => q.stage === 'mofu');
    const bofuQ = queries.filter((q) => q.stage === 'bofu');
    const funnelBreakdown = {
      tofu: { mentioned: tofuQ.filter((q) => q.mentioned).length, total: tofuQ.length },
      mofu: { mentioned: mofuQ.filter((q) => q.mentioned).length, total: mofuQ.length },
      bofu: { mentioned: bofuQ.filter((q) => q.mentioned).length, total: bofuQ.length },
    };

    // Category breakdown (6 categories)
    const categories: GeoCategory[] = ['sector', 'problema', 'comparativa', 'decision', 'recomendacion', 'marca'];
    const categoryBreakdown: Record<string, { mentioned: number; total: number }> = {};
    for (const cat of categories) {
      const catQ = queries.filter((q) => q.category === cat);
      categoryBreakdown[cat] = {
        mentioned: catQ.filter((q) => q.mentioned).length,
        total: catQ.length,
      };
    }

    // Cross-model breakdown
    const crossModel = engines.map((engine) => ({
      name: engine.name,
      mentioned: runResults.filter(
        (r) => r.engineOutputs.find((e) => e.engineName === engine.name)?.mentioned,
      ).length,
      total,
    }));

    // Weighted score by category importance
    let weightedMentioned = 0;
    let weightedTotal = 0;
    for (const r of runResults) {
      const w = CATEGORY_WEIGHTS[r.spec.category] ?? 1.0;
      weightedTotal += w;
      if (r.mentioned) weightedMentioned += w;
    }
    const overallScore = weightedTotal > 0 ? Math.round((weightedMentioned / weightedTotal) * 100) : 0;

    // Sub-scores (backward compat)
    const sectorScore = tofuQ.length > 0
      ? Math.round((tofuQ.filter((q) => q.mentioned).length / tofuQ.length) * 100) : 0;
    const brandScore  = bofuQ.length > 0
      ? Math.round((bofuQ.filter((q) => q.mentioned).length / bofuQ.length) * 100) : 0;

    // Competitor per-category breakdown
    const enrichedCompetitorMentions: GeoCompetitorMention[] = competitorMentions.map((cm) => {
      const byCategory: Record<string, { mentioned: number; total: number }> = {};
      for (const cat of categories) {
        const catResults = runResults.filter((r) => r.spec.category === cat);
        let compMentioned = 0;
        let compDomain = cm.domain;
        for (const r of catResults) {
          if (r.engineOutputs.some((e) => detectMention(e.answer, compDomain, cm.name))) {
            compMentioned++;
          }
        }
        byCategory[cat] = { mentioned: compMentioned, total: catResults.length };
      }
      return { ...cm, byCategory: byCategory as any };
    });

    // Generate executive narrative with LLM
    let executiveNarrative = '';
    if (ANTHROPIC_KEY) {
      try {
        const compSummary = enrichedCompetitorMentions.length > 0
          ? enrichedCompetitorMentions.map(c => `${c.name}: ${c.mentionRate}% global`).join(', ')
          : 'Sin datos de competidores en IA';
        const catSummary = categories.map(cat => {
          const d = categoryBreakdown[cat];
          return d ? `${cat}: ${d.mentioned}/${d.total}` : '';
        }).filter(Boolean).join(', ');

        const narrativePrompt = `Eres un consultor senior de growth marketing. Analiza estos datos de visibilidad en IA y redacta 2-3 frases ejecutivas para un CEO/CMO. No uses jerga técnica.

DATOS:
- Marca analizada: ${brandName} (${domain})
- Sector: ${sector}
- Tasa de mención global: ${mentionRate}% (rango confianza 95%: ${mentionRangeLow}-${mentionRangeHigh}%)
- Consultas analizadas: ${total} en ${engines.length} motores de IA (${engines.map(e => e.name).join(', ')})
- Desglose por categoría: ${catSummary}
- Competidores en IA: ${compSummary}
- Score ponderado: ${overallScore}/100 (las consultas de decisión de compra pesan más)

REGLAS:
- Máximo 3 frases. Directo al grano.
- Primera frase: situación actual (dato clave + qué significa para el negocio)
- Segunda frase: comparativa con competidores (quién gana y por qué importa)
- Tercera frase: oportunidad o riesgo principal
- Si mentionRate es 0%: no digas "invisible" sin más, explica qué implica
- Si mentionRate > 50%: destaca la ventaja pero señala dónde mejorar
- NUNCA uses "TOFU", "MOFU", "BOFU". Di "consultas de descubrimiento", "consultas de comparación", "consultas de compra"
- Cita datos concretos (porcentajes, nombres de competidores)

Responde SOLO con el texto narrativo, sin JSON, sin comillas.`;

        const narrativeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            messages: [{ role: 'user', content: narrativePrompt }],
          }),
        });
        if (narrativeRes.ok) {
          const narrativeData = await narrativeRes.json() as any;
          executiveNarrative = (narrativeData?.content?.[0]?.text || '').trim();
        }
      } catch { /* non-fatal — fall back to empty narrative */ }
    }

    const engineLog = crossModel.map((e) => `${e.name}:${e.mentioned}/${e.total}`).join(' ');
    return {
      queries,
      overallScore,
      brandScore,
      sectorScore,
      mentionRate,
      mentionRangeLow,
      mentionRangeHigh,
      funnelBreakdown,
      categoryBreakdown: categoryBreakdown as any,
      crossModel,
      competitorMentions: enrichedCompetitorMentions.length > 0 ? enrichedCompetitorMentions : undefined,
      executiveNarrative: executiveNarrative || undefined,
      _log: `ok | q:${total} | mentions:${mentionCount}/${total} (${mentionRangeLow}-${mentionRangeHigh}%) | ${engineLog}`,
    };
  } catch (err: any) {
    console.error(`[geo] FATAL: ${err?.message?.slice(0, 200)}`);
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
