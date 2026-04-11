export const prerender = false;

import type { APIRoute } from 'astro';
import {
  saveClientOnboarding, getClientOnboarding, getLatestSnapshot, IS_DEMO,
  logRecommendation, getClientById, getActionPlan, getCompletedActions, getRejectedRecommendations,
} from '../../../lib/db';
import { runGrowthAgent, type IntegrationSummary } from '../../../lib/ai/growth-agent';
import { getIntegration } from '../../../lib/integrations';

/**
 * POST /api/dashboard/save-onboarding
 * Saves the onboarding business context and regenerates the Growth Agent
 * analysis with the new client context (so the dashboard narrative reflects
 * the updated business description, goal, keywords, etc).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;

  if (!client?.id) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();

    // Partial update support: merge with existing data so settings can
    // update just KPIs without wiping other fields
    const existing = await getClientOnboarding(client.id);
    const onboardingData = {
      client_id: client.id,
      business_description: body.business_description ?? existing?.business_description ?? null,
      primary_goal: body.primary_goal ?? existing?.primary_goal ?? null,
      goal_detail: body.goal_detail ?? existing?.goal_detail ?? null,
      geo_scope: body.geo_scope ?? existing?.geo_scope ?? null,
      geo_detail: body.geo_detail ?? existing?.geo_detail ?? null,
      url_architecture: body.url_architecture ?? existing?.url_architecture ?? null,
      url_detail: body.url_detail ?? existing?.url_detail ?? null,
      monthly_budget: body.monthly_budget ?? existing?.monthly_budget ?? null,
      team_size: body.team_size ?? existing?.team_size ?? null,
      competitors: body.competitors ?? existing?.competitors ?? [],
      sector: body.sector ?? existing?.sector ?? null,
      instagram_handle: body.instagram_handle ?? existing?.instagram_handle ?? null,
      linkedin_url: body.linkedin_url ?? existing?.linkedin_url ?? null,
      primary_kpis: Array.isArray(body.primary_kpis) ? body.primary_kpis : (existing?.primary_kpis ?? []),
    };

    await saveClientOnboarding(onboardingData);

    // Regenerate Growth Agent analysis with updated client context.
    // Fails soft — the dashboard still renders with the previous snapshot data.
    let regenerated = false;
    const snapshot = await getLatestSnapshot(client.id);
    if (snapshot.id !== 'empty') {
      try {
        const [onboarding, clientFull, inProgress, completed, rejected, googleIntegration] = await Promise.all([
          getClientOnboarding(client.id),
          getClientById(client.id).catch(() => null),
          getActionPlan(client.id).catch(() => []),
          getCompletedActions(client.id).catch(() => []),
          getRejectedRecommendations(client.id).catch(() => []),
          getIntegration(client.id, 'google_analytics').catch(() => null),
        ]);

        const integrations: IntegrationSummary = {
          googleSearchConsole: !!googleIntegration && googleIntegration.status === 'connected',
          googleAnalytics: !!googleIntegration && googleIntegration.status === 'connected' && !!googleIntegration.property_id,
          ga4PropertyName: googleIntegration?.property_name,
          accountEmail: googleIntegration?.account_email,
        };

        if (onboarding) {
          const growthAnalysis = await runGrowthAgent({
            clientName: client.name,
            domain: client.domain,
            sector: clientFull?.sector,
            tier: clientFull?.tier,
            onboarding,
            pipelineOutput: snapshot.pipeline_output || {},
            priorityKeywords: onboarding.priority_keywords,
            keywordStrategy: onboarding.keyword_strategy,
            integrations,
            actionHistory: {
              completed: completed.map((a: any) => ({ title: a.title, impact: a.impact, completedAt: a.completed_at })),
              inProgress: inProgress.filter((a: any) => a.status === 'in_progress').map((a: any) => ({ title: a.title, impact: a.impact })),
              rejected: rejected.map((r: any) => ({ title: r.title, reason: r.rejected_reason })),
            },
          });

          // Save growth_analysis into snapshot
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

          // Seed prioritizedActions as trackable recommendations
          for (const action of growthAnalysis.prioritizedActions || []) {
            logRecommendation({
              client_id: client.id,
              source: 'growth_agent',
              pillar: action.pillar,
              title: action.title,
              description: action.description,
              impact: action.businessImpact || 'high',
              data: {
                rank: action.rank,
                detail: action.detail,
                expectedOutcome: action.expectedOutcome,
                effort: action.effort,
                timeframe: action.timeframe,
                rationale: action.rationale,
                linkedGap: action.linkedGap,
              },
            }).catch(() => {});
          }

          regenerated = true;
          console.log('[save-onboarding] Growth Agent regenerated for', client.domain);
        }
      } catch (err) {
        console.error('[save-onboarding] Growth Agent regeneration failed (non-blocking):', (err as Error).message);
      }
    }

    return new Response(JSON.stringify({ ok: true, regenerated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[save-onboarding] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
