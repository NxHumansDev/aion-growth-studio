/**
 * Editorial AI — brief resolver.
 *
 * Takes the minimal input from the user (topic + profile + optional brief/keyword)
 * and enriches it with everything the writer needs:
 *   - primary_keyword (from user brief OR matched against priority_keywords)
 *   - secondary_keywords (client's priority_keywords that fit the topic)
 *   - search_intent + funnel_stage inferred
 *   - entities_to_cite from sector + competitors
 *   - competitor_articles (top 3 URLs ranking for primary_keyword via DataForSEO)
 *   - warnings (e.g. topic not in keyword strategy)
 *
 * Does NOT call the LLM. Pure deterministic enrichment.
 */

import { getSupabase } from '../db';
import type {
  ArticleBrief, BriefResolutionResult, EditorialLanguage, PublicationProfile,
} from './types';

const DFS_LOGIN = import.meta.env?.DATAFORSEO_LOGIN || process.env.DATAFORSEO_LOGIN;
const DFS_PASSWORD = import.meta.env?.DATAFORSEO_PASSWORD || process.env.DATAFORSEO_PASSWORD;

interface ClientContextForBrief {
  sector?: string | null;
  priority_keywords: string[];
  keyword_strategy?: string | null;
  competitors: Array<{ name: string; domain: string }>;
}

async function fetchClientContext(clientId: string): Promise<ClientContextForBrief> {
  const sb = getSupabase();
  const { data: onboarding } = await sb
    .from('client_onboarding')
    .select('sector, priority_keywords, keyword_strategy')
    .eq('client_id', clientId)
    .single();

  // Competitors live in the latest snapshot.pipeline_output.competitors
  const { data: snap } = await sb
    .from('snapshots')
    .select('pipeline_output')
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  const competitors: Array<{ name: string; domain: string }> = [];
  const cs = (snap as any)?.pipeline_output?.competitors?.competitors;
  if (Array.isArray(cs)) {
    for (const c of cs.slice(0, 5)) {
      competitors.push({
        name: c.name || c.url || '',
        domain: (() => { try { return new URL(c.url).hostname; } catch { return c.url || ''; } })(),
      });
    }
  }

  return {
    sector: (onboarding as any)?.sector ?? null,
    priority_keywords: ((onboarding as any)?.priority_keywords as string[]) ?? [],
    keyword_strategy: (onboarding as any)?.keyword_strategy ?? null,
    competitors,
  };
}

/**
 * Find the best matching keyword from priority_keywords for the given topic.
 * Simple substring + word-overlap scoring. For more accuracy we could embed,
 * but at typical volumes (<20 priority_keywords per client) substring is fine.
 */
function matchPrimaryKeyword(topic: string, priorityKeywords: string[]): string | null {
  if (priorityKeywords.length === 0) return null;
  const topicLower = topic.toLowerCase();
  const topicWords = new Set(topicLower.split(/\s+/).filter(w => w.length >= 4));

  let best = { kw: '', score: 0 };
  for (const kw of priorityKeywords) {
    const kwLower = kw.toLowerCase();
    let score = 0;
    if (topicLower.includes(kwLower)) score += 10;
    const kwWords = kwLower.split(/\s+/);
    for (const w of kwWords) if (topicWords.has(w)) score += 2;
    if (score > best.score) best = { kw, score };
  }
  return best.score >= 2 ? best.kw : null;
}

/**
 * Build a list of secondary keywords: the remaining priority_keywords that
 * share at least one significant word with the topic or the primary_keyword.
 */
function pickSecondaryKeywords(
  topic: string,
  primary: string,
  priorityKeywords: string[],
): string[] {
  const hayWords = new Set(
    (topic + ' ' + primary).toLowerCase().split(/\s+/).filter(w => w.length >= 4),
  );
  const secondary: Array<{ kw: string; score: number }> = [];
  for (const kw of priorityKeywords) {
    if (kw.toLowerCase() === primary.toLowerCase()) continue;
    const kwWords = kw.toLowerCase().split(/\s+/);
    const overlap = kwWords.filter(w => hayWords.has(w)).length;
    if (overlap >= 1) secondary.push({ kw, score: overlap });
  }
  return secondary.sort((a, b) => b.score - a.score).slice(0, 4).map(s => s.kw);
}

function inferSearchIntent(topic: string, keyword: string): BriefResolutionResult['search_intent'] {
  const combined = (topic + ' ' + keyword).toLowerCase();
  if (/\b(comparativa|vs|mejor|mejores|best|compare|comparison|alternativas)\b/i.test(combined)) return 'comparative';
  if (/\b(comprar|precio|precios|buy|pricing|trial|demo)\b/i.test(combined)) return 'transactional';
  if (/\b(login|dashboard|panel|access)\b/i.test(combined)) return 'navigational';
  return 'informational';
}

function inferFunnelStage(topic: string, intent: BriefResolutionResult['search_intent']): BriefResolutionResult['funnel_stage'] {
  if (intent === 'transactional' || intent === 'comparative') return 'BOFU';
  if (/\b(cómo|guía|qué es|what is|how to|tutorial|introducción)\b/i.test(topic.toLowerCase())) return 'TOFU';
  return 'MOFU';
}

function resolveTargetLength(profile: PublicationProfile, intent: BriefResolutionResult['search_intent']): number {
  const fmt = profile.format_rules || {};
  if (fmt.target_length_min && fmt.target_length_max) {
    return Math.round((fmt.target_length_min + fmt.target_length_max) / 2);
  }
  // Defaults by platform
  switch (profile.platform) {
    case 'linkedin_post':   return 1000;
    case 'linkedin_article': return 1500;
    case 'blog':            return intent === 'informational' ? 2000 : 1500;
    case 'newsletter':      return 500;
    case 'column':          return 1800;
    case 'twitter':         return 280;
    default:                return 1500;
  }
}

/**
 * SERP features detected on the target keyword. Populated by fetchCompetitorArticles
 * as a side-product of the DataForSEO SERP query (we already paid for it, just
 * we weren't reading all fields).
 */
export interface SerpFeaturesFound {
  has_featured_snippet: boolean;          // el snippet de Google arriba de todo
  featured_snippet_domain?: string;       // quién lo tiene ahora (para saber a quién superar)
  has_people_also_ask: boolean;
  people_also_ask_questions: string[];    // hasta 4 preguntas exactas que extrae Google
  has_knowledge_panel: boolean;
  has_video_results: boolean;
  has_image_pack: boolean;
}

/**
 * Fetch top competitor articles ranking for the primary keyword via DataForSEO,
 * AND extract SERP features (Featured Snippet, People Also Ask, Knowledge Panel,
 * Video/Image packs) from the same response. These are opportunities for the
 * writer to target specifically — owning a Featured Snippet captures 20-35% of
 * top-1 clicks.
 */
async function fetchCompetitorArticlesAndSerpFeatures(
  primaryKeyword: string,
  language: EditorialLanguage,
): Promise<{ articles: string[]; serpFeatures: SerpFeaturesFound }> {
  const emptyFeatures: SerpFeaturesFound = {
    has_featured_snippet: false,
    has_people_also_ask: false,
    people_also_ask_questions: [],
    has_knowledge_panel: false,
    has_video_results: false,
    has_image_pack: false,
  };
  if (!DFS_LOGIN || !DFS_PASSWORD) return { articles: [], serpFeatures: emptyFeatures };
  try {
    const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
    const locationCode = language === 'es' ? 2724 : 2840;   // Spain / United States
    const languageCode = language === 'es' ? 'es' : 'en';
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20_000);

    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify([{
        keyword: primaryKeyword,
        location_code: locationCode,
        language_code: languageCode,
        depth: 10,
      }]),
    });

    if (!res.ok) return { articles: [], serpFeatures: emptyFeatures };
    const data = await res.json();
    const items: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];

    // Extract top competitor articles (organic type, top 3)
    const articles: string[] = items
      .filter((it: any) => it.type === 'organic' && it.url)
      .slice(0, 3)
      .map((it: any) => it.url);

    // Extract SERP features — DFS advanced endpoint returns them as separate items
    const serpFeatures: SerpFeaturesFound = {
      has_featured_snippet: false,
      has_people_also_ask: false,
      people_also_ask_questions: [],
      has_knowledge_panel: false,
      has_video_results: false,
      has_image_pack: false,
    };

    for (const it of items) {
      if (it.type === 'featured_snippet') {
        serpFeatures.has_featured_snippet = true;
        if (it.domain) serpFeatures.featured_snippet_domain = it.domain;
      } else if (it.type === 'people_also_ask') {
        serpFeatures.has_people_also_ask = true;
        const questions: string[] = (it.items ?? [])
          .map((q: any) => q.title || q.question)
          .filter((t: any) => typeof t === 'string')
          .slice(0, 4);
        serpFeatures.people_also_ask_questions.push(...questions);
      } else if (it.type === 'knowledge_graph') {
        serpFeatures.has_knowledge_panel = true;
      } else if (it.type === 'video') {
        serpFeatures.has_video_results = true;
      } else if (it.type === 'images') {
        serpFeatures.has_image_pack = true;
      }
    }

    return { articles, serpFeatures };
  } catch {
    return { articles: [], serpFeatures: emptyFeatures };
  }
}

function isTopicInStrategy(
  topic: string,
  primaryKeyword: string | null,
  priorityKeywords: string[],
): boolean {
  if (priorityKeywords.length === 0) return true;  // no strategy → anything goes
  if (primaryKeyword) return true;                 // matched a priority kw
  // Check word overlap with any priority keyword
  const topicWords = new Set(topic.toLowerCase().split(/\s+/).filter(w => w.length >= 4));
  for (const kw of priorityKeywords) {
    const kwWords = kw.toLowerCase().split(/\s+/);
    if (kwWords.some(w => topicWords.has(w))) return true;
  }
  return false;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Resolve a minimal ArticleBrief into a full BriefResolutionResult.
 * Non-blocking: if enrichment sources fail, returns what it could with warnings.
 */
export async function resolveBrief(
  clientId: string,
  input: ArticleBrief,
  profile: PublicationProfile,
): Promise<BriefResolutionResult> {
  const context = await fetchClientContext(clientId);

  // Primary keyword
  const matched = matchPrimaryKeyword(input.topic, context.priority_keywords);
  const resolvedPrimary = input.primary_keyword?.trim() || matched || input.topic.slice(0, 80);

  // Secondary keywords
  const resolvedSecondary = input.secondary_keywords?.length
    ? input.secondary_keywords
    : pickSecondaryKeywords(input.topic, resolvedPrimary, context.priority_keywords);

  // Intent + funnel
  const search_intent = inferSearchIntent(input.topic, resolvedPrimary);
  const funnel_stage = input.funnel_stage ?? inferFunnelStage(input.topic, search_intent);

  // Target length
  const target_length = resolveTargetLength(profile, search_intent);

  // Entities from sector + competitors
  const entities_to_cite: string[] = [];
  if (context.sector) entities_to_cite.push(context.sector);
  for (const c of context.competitors.slice(0, 3)) {
    if (c.name) entities_to_cite.push(c.name);
  }

  // Competitor articles + SERP features for the keyword (single DFS call)
  const { articles: competitor_articles, serpFeatures: serp_features } =
    await fetchCompetitorArticlesAndSerpFeatures(resolvedPrimary, input.language);

  // Warnings
  const warnings: string[] = [];
  if (!matched && context.priority_keywords.length > 0) {
    if (!isTopicInStrategy(input.topic, matched, context.priority_keywords)) {
      warnings.push(
        `Este topic no parece encajar con las priority_keywords del cliente (${context.priority_keywords.slice(0, 5).join(', ')}). Si continuas, el contenido no reforzará la estrategia SEO actual.`,
      );
    }
  }
  if (!input.primary_keyword && !matched) {
    warnings.push(`Sin primary_keyword clara. Usando el topic como keyword — revisa si es óptimo.`);
  }

  return {
    ...input,
    resolved_primary_keyword: resolvedPrimary,
    resolved_secondary_keywords: resolvedSecondary,
    search_intent,
    funnel_stage,
    target_length,
    entities_to_cite,
    competitor_articles,
    serp_features,
    warnings,
  };
}
