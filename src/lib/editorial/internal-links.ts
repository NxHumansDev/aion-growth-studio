/**
 * Editorial AI — internal link suggestions.
 *
 * For every article being generated, find existing published articles of the
 * same client that are topically related (embedding cosine > 0.35) and
 * propose 2-4 as internal links. Internal linking is a top-3 SEO factor and
 * one of the highest-ROI things editorial can do automatically.
 *
 * The suggestions come back to the writer context block (so the writer
 * naturally weaves them in) and also get surfaced at publish time as
 * "otros artículos tuyos que deberían enlazar a este nuevo" so the user
 * adds back-references.
 */

import { getSupabase } from '../db';
import { embed, cosineSimilarity } from './embeddings';
import type { Article } from './types';

export interface InternalLinkSuggestion {
  article_id: string;
  topic: string;
  published_url: string;
  suggested_anchor: string;   // derived from topic + primary_keyword overlap
  similarity: number;
  direction: 'new_to_existing' | 'existing_to_new';  // hint for user
}

/**
 * Find existing published articles of the same client whose topic is
 * semantically similar to the new article's topic + primary_keyword.
 * Only considers articles with a published_url so links can actually be built.
 * Returns up to 4 suggestions ordered by similarity.
 */
export async function suggestInternalLinks(
  clientId: string,
  newTopic: string,
  newPrimaryKeyword: string | undefined,
  excludeArticleId?: string,
  limit: number = 4,
): Promise<InternalLinkSuggestion[]> {
  const queryText = `${newTopic}${newPrimaryKeyword ? ' ' + newPrimaryKeyword : ''}`;
  const newEmbResult = await embed(queryText);
  if (!newEmbResult.success || !newEmbResult.embedding) return [];

  const sb = getSupabase();
  const { data: rows } = await sb
    .from('articles')
    .select('id, topic, primary_keyword, published_url, language')
    .eq('client_id', clientId)
    .in('status', ['published', 'approved_salvaged'])
    .not('published_url', 'is', null);
  if (!rows || rows.length === 0) return [];

  const candidates = (rows as any[]).filter(r => r.id !== excludeArticleId && r.published_url);
  if (candidates.length === 0) return [];

  // Embed each candidate's topic and score. Done sequentially to keep costs
  // predictable — typical client has <50 published articles.
  const scored: InternalLinkSuggestion[] = [];
  for (const c of candidates) {
    const candidateText = `${c.topic}${c.primary_keyword ? ' ' + c.primary_keyword : ''}`;
    const emb = await embed(candidateText);
    if (!emb.success || !emb.embedding) continue;

    const similarity = cosineSimilarity(newEmbResult.embedding, emb.embedding);
    if (similarity < 0.35) continue;   // minimum threshold to avoid irrelevant links

    // Anchor text: prefer the candidate's primary_keyword if present,
    // otherwise first 5-8 words of its topic.
    const anchor = c.primary_keyword?.trim()
      ? c.primary_keyword.trim()
      : c.topic.split(/\s+/).slice(0, 6).join(' ');

    scored.push({
      article_id: c.id,
      topic: c.topic,
      published_url: c.published_url,
      suggested_anchor: anchor,
      similarity: +similarity.toFixed(3),
      direction: 'new_to_existing',
    });
  }

  return scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
