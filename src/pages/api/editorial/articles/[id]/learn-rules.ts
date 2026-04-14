export const prerender = false;

import type { APIRoute } from 'astro';
import {
  getArticle, listStyleRules, createStyleRule,
} from '../../../../../lib/editorial/db';
import { extractRulesFromDiff } from '../../../../../lib/editorial/agents/diff-extractor';
import { embed, cosineSimilarity } from '../../../../../lib/editorial/embeddings';
import type { ProposedRule } from '../../../../../lib/editorial/agents/diff-extractor';

/**
 * POST /api/editorial/articles/:id/learn-rules
 *
 * Two modes:
 *
 * Mode 1: extract — body { mode: 'extract' }
 *   Runs the diff extractor between revised_content and final_user_content.
 *   Returns the proposed_rules + per-rule conflict flag (whether the rule
 *   contradicts an existing one). Does NOT persist anything.
 *
 * Mode 2: confirm — body { mode: 'confirm', accepted_rules: ProposedRule[] }
 *   Persists the user-confirmed subset into editorial_style_rules with
 *   source='learned_from_article' and learned_from_article_id=articleId.
 *   Rules flagged as conflicting are stored with conflict_status='pending'
 *   for an admin to resolve from /editorial/settings/conflicts.
 *
 * Admin-only.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  const articleId = params.id as string;

  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if ((user.clientRole ?? user.role) !== 'admin' && user.role !== 'superuser') {
    return json({ error: 'Admin role required' }, 403);
  }
  if (!articleId) return json({ error: 'Missing article id' }, 400);

  const article = await getArticle(articleId);
  if (!article) return json({ error: 'Article not found' }, 404);
  if (article.client_id !== client.id) return json({ error: 'Forbidden' }, 403);

  let body: { mode: 'extract' | 'confirm'; accepted_rules?: ProposedRule[] };
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  if (body.mode === 'extract') {
    if (!article.revised_content || !article.final_user_content) {
      return json({
        ok: true,
        proposed_rules: [],
        changes_count: 0,
        significant: false,
        reason: 'No revised_content or final_user_content to diff',
      });
    }

    const diff = await extractRulesFromDiff({
      client_id: client.id,
      article_id: articleId,
      revised_content: article.revised_content,
      final_user_content: article.final_user_content,
    });

    if (!diff.success) {
      return json({ error: 'Diff extraction failed', detail: diff.error }, 502);
    }

    // Compute conflict flags against existing rules of the same client+language+rule_type
    const existing = await listStyleRules(client.id, { language: article.language });
    const flagged = await Promise.all(diff.proposed_rules.map(async (r): Promise<ProposedRule & { conflicts_with?: { id: string; content: string; similarity: number } }> => {
      const sameType = existing.filter(e => e.rule_type === r.rule_type);
      if (sameType.length === 0) return { ...r };

      const newEmb = await embed(r.content);
      if (!newEmb.success || !newEmb.embedding) return { ...r };

      // Compare against each existing rule of the same type
      let bestConflict: { id: string; content: string; similarity: number } | undefined;
      for (const ex of sameType) {
        const exEmb = await embed(ex.content);
        if (!exEmb.success || !exEmb.embedding) continue;
        const sim = cosineSimilarity(newEmb.embedding, exEmb.embedding);
        // Two rules of the same type with high semantic similarity but different
        // content are likely contradictory ("avoid X" vs "always use X" both score high).
        // We flag for admin review when sim is high but content differs significantly.
        if (sim >= 0.55 && sim < 0.92 && ex.content.trim() !== r.content.trim()) {
          if (!bestConflict || sim > bestConflict.similarity) {
            bestConflict = { id: ex.id, content: ex.content, similarity: +sim.toFixed(2) };
          }
        }
      }
      return { ...r, conflicts_with: bestConflict };
    }));

    return json({
      ok: true,
      proposed_rules: flagged,
      changes_count: diff.changes_count,
      significant: diff.significant,
      cost_usd: diff.cost_usd,
    });
  }

  if (body.mode === 'confirm') {
    if (!Array.isArray(body.accepted_rules)) {
      return json({ error: 'accepted_rules array required' }, 400);
    }

    const created: string[] = [];
    const conflicting: string[] = [];

    for (const rule of body.accepted_rules) {
      if (!rule.content?.trim()) continue;

      // Naive check again (the UI already showed the conflict flag, but we
      // re-check on the server to mark conflict_status correctly even if
      // the user accepted a rule the system flagged as conflicting).
      const existing = await listStyleRules(client.id, { language: article.language });
      const sameType = existing.filter(e => e.rule_type === rule.rule_type);
      let isConflict = false;
      if (sameType.length > 0) {
        const newEmb = await embed(rule.content);
        if (newEmb.success && newEmb.embedding) {
          for (const ex of sameType) {
            const exEmb = await embed(ex.content);
            if (!exEmb.success || !exEmb.embedding) continue;
            const sim = cosineSimilarity(newEmb.embedding, exEmb.embedding);
            if (sim >= 0.55 && sim < 0.92 && ex.content.trim() !== rule.content.trim()) {
              isConflict = true;
              break;
            }
          }
        }
      }

      const newRule = await createStyleRule({
        client_id: client.id,
        rule_type: rule.rule_type,
        content: rule.content.trim(),
        priority: rule.priority,
        language: article.language,
        source: 'learned_from_article',
        learned_from_article_id: articleId,
        superseded_by: null,
        archived_at: null,
        conflict_status: isConflict ? 'pending' : null,
      });

      created.push(newRule.id);
      if (isConflict) conflicting.push(newRule.id);
    }

    return json({
      ok: true,
      created: created.length,
      conflicts: conflicting.length,
      conflict_rule_ids: conflicting,
    });
  }

  return json({ error: 'Invalid mode (must be extract|confirm)' }, 400);
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
