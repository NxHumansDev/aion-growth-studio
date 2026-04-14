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
 * Fetch top competitor articles ranking for the primary keyword via DataForSEO.
 * Returns up to 3 URLs. Fails gracefully to empty array if DFS is down.
 */
async function fetchCompetitorArticles(
  primaryKeyword: string,
  language: EditorialLanguage,
): Promise<string[]> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return [];
  try {
    const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
    const locationCode = language === 'es' ? 2724 : 2840;   // Spain / United States
    const languageCode = language === 'es' ? 'es' : 'en';
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20_000);

    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
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

    if (!res.ok) return [];
    const data = await res.json();
    const items: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];
    return items
      .filter((it: any) => it.type === 'organic' && it.url)
      .slice(0, 3)
      .map((it: any) => it.url);
  } catch {
    return [];
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

  // Competitor articles for the keyword (parallel fetch)
  const competitor_articles = await fetchCompetitorArticles(resolvedPrimary, input.language);

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
    warnings,
  };
}
