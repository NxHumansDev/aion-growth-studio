export const prerender = false;

import type { APIRoute } from 'astro';
import {
  getClientOnboarding, getLatestSnapshot, IS_DEMO, getClientById,
  getActionPlan, getCompletedActions, getRejectedRecommendations,
} from '../../../lib/db';
import { runGrowthAgent } from '../../../lib/ai/growth-agent';

/**
 * POST /api/dashboard/generate-briefing
 *
 * Regenerates the Growth Agent analysis with enriched client context
 * (onboarding, priority keywords, strategy, action history) and stores
 * it in the latest snapshot's pipeline_output.growth_analysis.
 *
 * Use when the client has edited their onboarding / priority keywords
 * and wants their dashboard narrative to reflect the new context —
 * otherwise the initial analysis from the audit pipeline is used.
 *
 * Name kept as "generate-briefing" for backward compatibility; this
 * is internally the Growth Agent regenerate endpoint.
 */
export const POST: APIRoute = async ({ locals }) => {
  const client = (locals as any).client;

  if (!client?.id) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const snapshot = await getLatestSnapshot(client.id);
    if (snapshot.id === 'empty') {
      return new Response(JSON.stringify({ error: 'No audit data available' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const [onboarding, clientFull, inProgress, completed, rejected] = await Promise.all([
      getClientOnboarding(client.id),
      getClientById(client.id).catch(() => null),
      getActionPlan(client.id).catch(() => []),
      getCompletedActions(client.id).catch(() => []),
      getRejectedRecommendations(client.id).catch(() => []),
    ]);

    // Full Growth Agent pass: Sonnet draft → structural → Opus QA → corrections
    const growthAnalysis = await runGrowthAgent({
      clientName: client.name,
      domain: client.domain,
      sector: clientFull?.sector,
      tier: clientFull?.tier,
      onboarding,
      pipelineOutput: snapshot.pipeline_output || {},
      priorityKeywords: onboarding?.priority_keywords,
      keywordStrategy: onboarding?.keyword_strategy,
      actionHistory: {
        completed: completed.map((a: any) => ({ title: a.title, impact: a.impact, completedAt: a.completed_at })),
        inProgress: inProgress.filter((a: any) => a.status === 'in_progress').map((a: any) => ({ title: a.title, impact: a.impact })),
        rejected: rejected.map((r: any) => ({ title: r.title, reason: r.rejected_reason })),
      },
    });

    // Store in snapshot
    if (!IS_DEMO) {
      const { createClient } = await import('@supabase/supabase-js');
      const url = import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL;
      const key = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
      if (url && key) {
        const sb = createClient(url, key);
        await sb.from('snapshots')
          .update({ pipeline_output: { ...snapshot.pipeline_output, growth_analysis: growthAnalysis } })
          .eq('id', snapshot.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, growth_analysis: growthAnalysis }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[generate-briefing] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
