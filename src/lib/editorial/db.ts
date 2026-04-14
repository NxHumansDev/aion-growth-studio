/**
 * Editorial AI — Supabase helpers (CRUD + queries).
 * All functions use the service-role client. RLS is enforced in Supabase.
 */

import { getSupabase } from '../db';
import type {
  Article, ArticleStatus, BrandVoice, ClientFeatures,
  EditorialLanguage, EditorialQuota, EditorialSourcesWhitelist,
  GenerationAgent, GenerationLog, PublicationProfile,
  ReferenceMedia, RejectedTopic, StyleRule, ArticlePerformance,
} from './types';

// ─── Feature flag ───────────────────────────────────────────────────────

/** Check whether a client has Editorial AI enabled. */
export async function clientHasEditorial(clientId: string): Promise<boolean> {
  const sb = getSupabase();
  const { data } = await sb
    .from('clients')
    .select('features, tier')
    .eq('id', clientId)
    .single();
  if (!data) return false;
  const features = (data.features || {}) as ClientFeatures;
  // Explicit flag wins. Otherwise default by tier.
  if (typeof features.editorial === 'boolean') return features.editorial;
  return data.tier === 'señales' || data.tier === 'palancas';
}

/** Enable / disable Editorial AI for a client (admin operation). */
export async function setEditorialFlag(clientId: string, enabled: boolean): Promise<void> {
  const sb = getSupabase();
  const { data: current } = await sb
    .from('clients').select('features').eq('id', clientId).single();
  const features = ((current?.features ?? {}) as ClientFeatures);
  features.editorial = enabled;
  await sb.from('clients').update({ features }).eq('id', clientId);
}

// ─── Brand voice ───────────────────────────────────────────────────────

export async function getBrandVoice(clientId: string): Promise<BrandVoice | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from('brand_voice').select('*').eq('client_id', clientId).single();
  return (data as BrandVoice) ?? null;
}

export async function upsertBrandVoice(
  clientId: string,
  patch: Partial<Omit<BrandVoice, 'client_id' | 'created_at' | 'updated_at'>>,
): Promise<BrandVoice> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('brand_voice')
    .upsert({ client_id: clientId, ...patch, updated_at: new Date().toISOString() },
            { onConflict: 'client_id' })
    .select().single();
  if (error) throw error;
  return data as BrandVoice;
}

export async function isSetupCompleted(clientId: string): Promise<boolean> {
  const voice = await getBrandVoice(clientId);
  return !!voice?.setup_completed_at;
}

// ─── Style rules ───────────────────────────────────────────────────────

export async function listStyleRules(
  clientId: string,
  opts?: { includeArchived?: boolean; language?: EditorialLanguage | null },
): Promise<StyleRule[]> {
  const sb = getSupabase();
  let q = sb.from('editorial_style_rules').select('*').eq('client_id', clientId);
  if (!opts?.includeArchived) q = q.is('archived_at', null);
  if (opts?.language !== undefined) {
    q = opts.language === null ? q.is('language', null) : q.eq('language', opts.language);
  }
  const { data } = await q.order('priority', { ascending: false });
  return (data ?? []) as StyleRule[];
}

export async function createStyleRule(rule: Omit<StyleRule, 'id' | 'created_at' | 'updated_at'>): Promise<StyleRule> {
  const sb = getSupabase();
  const { data, error } = await sb.from('editorial_style_rules').insert(rule).select().single();
  if (error) throw error;
  return data as StyleRule;
}

export async function archiveStyleRule(id: string, supersededBy?: string): Promise<void> {
  const sb = getSupabase();
  await sb.from('editorial_style_rules').update({
    archived_at: new Date().toISOString(),
    superseded_by: supersededBy ?? null,
  }).eq('id', id);
}

export async function listPendingConflicts(clientId: string): Promise<StyleRule[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('editorial_style_rules')
    .select('*')
    .eq('client_id', clientId)
    .eq('conflict_status', 'pending')
    .order('created_at', { ascending: false });
  return (data ?? []) as StyleRule[];
}

// ─── Reference media ───────────────────────────────────────────────────

export async function listReferenceMedia(
  clientId: string,
  language?: EditorialLanguage | null,
): Promise<ReferenceMedia[]> {
  const sb = getSupabase();
  let q = sb.from('editorial_reference_media').select('*').eq('client_id', clientId);
  if (language !== undefined) {
    q = language === null ? q.is('language', null) : q.eq('language', language);
  }
  const { data } = await q.order('created_at');
  return (data ?? []) as ReferenceMedia[];
}

export async function createReferenceMedia(
  ref: Omit<ReferenceMedia, 'id' | 'created_at'>,
): Promise<ReferenceMedia> {
  const sb = getSupabase();
  const { data, error } = await sb.from('editorial_reference_media').insert(ref).select().single();
  if (error) throw error;
  return data as ReferenceMedia;
}

// ─── Publication profiles ──────────────────────────────────────────────

export async function listPublicationProfiles(clientId: string): Promise<PublicationProfile[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('publication_profiles').select('*')
    .eq('client_id', clientId).eq('active', true)
    .order('created_at');
  return (data ?? []) as PublicationProfile[];
}

export async function getPublicationProfile(id: string): Promise<PublicationProfile | null> {
  const sb = getSupabase();
  const { data } = await sb.from('publication_profiles').select('*').eq('id', id).single();
  return (data as PublicationProfile) ?? null;
}

export async function createPublicationProfile(
  profile: Omit<PublicationProfile, 'id' | 'created_at' | 'updated_at'>,
): Promise<PublicationProfile> {
  const sb = getSupabase();
  const { data, error } = await sb.from('publication_profiles').insert(profile).select().single();
  if (error) throw error;
  return data as PublicationProfile;
}

// ─── Articles ──────────────────────────────────────────────────────────

export async function getArticle(id: string): Promise<Article | null> {
  const sb = getSupabase();
  const { data } = await sb.from('articles').select('*').eq('id', id).single();
  return (data as Article) ?? null;
}

export async function listArticles(
  clientId: string,
  opts?: { status?: ArticleStatus | ArticleStatus[]; limit?: number },
): Promise<Article[]> {
  const sb = getSupabase();
  let q = sb.from('articles').select('*').eq('client_id', clientId);
  if (opts?.status) {
    q = Array.isArray(opts.status) ? q.in('status', opts.status) : q.eq('status', opts.status);
  }
  q = q.order('created_at', { ascending: false }).limit(opts?.limit ?? 100);
  const { data } = await q;
  return (data ?? []) as Article[];
}

export async function createArticle(
  article: Pick<Article, 'client_id' | 'profile_id' | 'topic' | 'language'> &
    Partial<Omit<Article, 'id' | 'created_at' | 'updated_at' | 'tracking_id'>>,
): Promise<Article> {
  const sb = getSupabase();
  const { data, error } = await sb.from('articles').insert({
    ...article,
    status: article.status ?? 'queued_writer',
  }).select().single();
  if (error) throw error;
  return data as Article;
}

/**
 * Atomically transition an article's status using optimistic locking.
 * Only updates if current status matches `from`. Returns the updated
 * article or null if the transition was blocked (another process got it).
 */
export async function transitionStatus(
  articleId: string,
  from: ArticleStatus | ArticleStatus[],
  to: ArticleStatus,
  extraPatch: Partial<Article> = {},
): Promise<Article | null> {
  const sb = getSupabase();
  const fromList = Array.isArray(from) ? from : [from];
  const { data } = await sb
    .from('articles')
    .update({ status: to, updated_at: new Date().toISOString(), ...extraPatch })
    .in('status', fromList)
    .eq('id', articleId)
    .select().single();
  return (data as Article) ?? null;
}

export async function updateArticle(
  articleId: string,
  patch: Partial<Article>,
): Promise<Article> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('articles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', articleId)
    .select().single();
  if (error) throw error;
  return data as Article;
}

/** Called by a scheduled job or on UI load to unstick abandoned jobs. */
export async function resetStuckArticles(): Promise<number> {
  const sb = getSupabase();
  const { data } = await sb.rpc('reset_stuck_editorial_articles');
  return (data as number) ?? 0;
}

// ─── Performance ───────────────────────────────────────────────────────

export async function upsertArticlePerformance(
  row: Omit<ArticlePerformance, 'id' | 'measured_at'>,
): Promise<void> {
  const sb = getSupabase();
  await sb.from('article_performance').upsert(
    { ...row, measured_at: new Date().toISOString() },
    { onConflict: 'article_id,week_of,source' },
  );
}

export async function getArticlePerformance(articleId: string): Promise<ArticlePerformance[]> {
  const sb = getSupabase();
  const { data } = await sb.from('article_performance')
    .select('*').eq('article_id', articleId).order('week_of', { ascending: false });
  return (data ?? []) as ArticlePerformance[];
}

// ─── Rejected topics (semantic filtering) ──────────────────────────────

export async function addRejectedTopic(params: {
  client_id: string;
  topic_text: string;
  topic_embedding: number[];
  reason?: string;
  article_id?: string;
}): Promise<void> {
  const sb = getSupabase();
  await sb.from('rejected_topics').insert(params);
}

/** Fetch the most recent N rejected topic texts for a client — used by the
 *  Growth Agent as a no-go list when proposing content recommendations. */
export async function listRecentRejectedTopicTexts(
  clientId: string,
  limit: number = 10,
): Promise<string[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('rejected_topics')
    .select('topic_text')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((r: any) => r.topic_text).filter(Boolean);
}

/**
 * Find rejected topics similar to a new candidate embedding.
 * Returns topics with similarity > threshold (default 0.85, i.e. distance < 0.15).
 */
export async function findSimilarRejectedTopics(
  clientId: string,
  candidateEmbedding: number[],
  threshold: number = 0.85,
): Promise<Array<RejectedTopic & { similarity: number }>> {
  const sb = getSupabase();
  const vectorParam = `[${candidateEmbedding.join(',')}]`;
  const maxDistance = 1 - threshold;
  // Raw query via RPC would be cleaner; use select with filter as a workaround.
  const { data, error } = await sb
    .rpc('find_similar_rejected_topics', {
      p_client_id: clientId,
      p_embedding: vectorParam,
      p_max_distance: maxDistance,
    });
  if (error) {
    // Fallback: fetch all and compute cosine in JS (only acceptable for small N)
    const { data: all } = await sb
      .from('rejected_topics').select('*').eq('client_id', clientId);
    if (!all) return [];
    return (all as RejectedTopic[])
      .map(r => ({ ...r, similarity: cosineSimilarity(r.topic_embedding ?? [], candidateEmbedding) }))
      .filter(r => r.similarity >= threshold);
  }
  return (data ?? []) as Array<RejectedTopic & { similarity: number }>;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; ma += a[i] ** 2; mb += b[i] ** 2; }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Whitelist ─────────────────────────────────────────────────────────

export async function getSourcesWhitelist(clientId: string): Promise<EditorialSourcesWhitelist | null> {
  const sb = getSupabase();
  const { data } = await sb.from('editorial_sources_whitelist')
    .select('*').eq('client_id', clientId).single();
  return (data as EditorialSourcesWhitelist) ?? null;
}

export async function upsertSourcesWhitelist(
  clientId: string,
  domains: string[],
  recencyMonths: number,
  sectorHash?: string,
): Promise<void> {
  const sb = getSupabase();
  await sb.from('editorial_sources_whitelist').upsert({
    client_id: clientId,
    domains,
    recency_months: recencyMonths,
    sector_hash: sectorHash,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' });
}

// ─── Generation log ────────────────────────────────────────────────────

export async function logGeneration(entry: {
  article_id?: string;
  client_id?: string;
  agent: GenerationAgent;
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  web_searches?: number;
  cost_usd?: number;
  latency_ms?: number;
  success: boolean;
  error_message?: string;
}): Promise<void> {
  const sb = getSupabase();
  await sb.from('editorial_generation_log').insert({
    ...entry,
    web_searches: entry.web_searches ?? 0,
  });
}
