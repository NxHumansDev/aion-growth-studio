export const prerender = false;

import type { APIRoute } from 'astro';
import { saveClientOnboarding, getClientOnboarding, getLatestSnapshot, IS_DEMO, logRecommendation } from '../../../lib/db';
import { generateBriefing } from '../../../lib/briefing';

/**
 * POST /api/dashboard/save-onboarding
 * Saves the onboarding business context and auto-generates a personalized briefing.
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

    const onboardingData = {
      client_id: client.id,
      business_description: body.business_description || null,
      primary_goal: body.primary_goal || null,
      goal_detail: body.goal_detail || null,
      geo_scope: body.geo_scope || null,
      geo_detail: body.geo_detail || null,
      url_architecture: body.url_architecture || null,
      url_detail: body.url_detail || null,
      monthly_budget: body.monthly_budget || null,
      team_size: body.team_size || null,
      competitors: body.competitors || [],
      sector: body.sector || null,
      instagram_handle: body.instagram_handle || null,
      linkedin_url: body.linkedin_url || null,
      primary_kpis: Array.isArray(body.primary_kpis) ? body.primary_kpis : [],
    };

    await saveClientOnboarding(onboardingData);

    // Auto-generate briefing if we have audit data
    let briefingGenerated = false;
    const snapshot = await getLatestSnapshot(client.id);
    if (snapshot.id !== 'empty') {
      try {
        const onboarding = await getClientOnboarding(client.id);
        if (onboarding) {
          const briefing = await generateBriefing({
            onboarding,
            auditResults: snapshot.pipeline_output,
            clientName: client.name,
            domain: client.domain,
          });

          // Save briefing into snapshot
          if (!IS_DEMO) {
            const { createClient } = await import('@supabase/supabase-js');
            const url = import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL;
            const key = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
            if (url && key) {
              const sb = createClient(url, key);
              await sb.from('snapshots')
                .update({ pipeline_output: { ...snapshot.pipeline_output, briefing } })
                .eq('id', snapshot.id);
            }
          }
          // Seed briefing priorities as trackable recommendations
          for (const priority of briefing.priorities || []) {
            logRecommendation({
              client_id: client.id,
              source: 'briefing',
              title: priority.title,
              description: priority.description,
              impact: priority.impact || 'high',
              status: 'pending',
            }).catch(() => {});
          }

          briefingGenerated = true;
          console.log('[save-onboarding] Briefing auto-generated for', client.domain);
        }
      } catch (err) {
        console.error('[save-onboarding] Briefing generation failed (non-blocking):', (err as Error).message);
      }
    }

    return new Response(JSON.stringify({ ok: true, briefingGenerated }), {
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
