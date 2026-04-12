export const prerender = false;

import type { APIRoute } from 'astro';
import { getClientById, IS_DEMO } from '../../../lib/db';
import { runRadarForClient } from '../../../lib/radar/run-radar';

const CRON_SECRET = import.meta.env?.CRON_SECRET || process.env.CRON_SECRET;

/**
 * POST /api/radar/run-client
 *
 * Runs Radar for a single client in 3 self-chaining phases:
 *
 *   Phase A (~60-100s): crawl → ssl phase → sector phase → instagram phase
 *   Phase B (~60-120s): competitor_traffic phase (incl GEO) → score
 *   Phase C (~120-210s): growth_agent → snapshot → analytics → kpis → diff → recs
 *
 * Each phase runs in its own Vercel Function invocation (300s budget).
 * At the end of Phase A, it fires a non-blocking POST to itself with
 * phase='B', and Phase B chains to Phase C the same way.
 *
 * Body: { clientId: string, phase?: 'A'|'B'|'C', auditId?: string }
 * Auth: CRON_SECRET
 *
 * Backward compatible: if phase is omitted, defaults to 'A' (starts chain).
 * For small/fast clients, the full pipeline may still fit in one invocation.
 */
export const POST: APIRoute = async ({ request }) => {
  if (IS_DEMO) {
    return new Response(JSON.stringify({ error: 'Demo mode' }), { status: 400 });
  }

  const authHeader = request.headers.get('authorization');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!authHeader?.includes(CRON_SECRET || '') && !isVercelCron && CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { clientId } = body;
    let { auditId: existingAuditId } = body;
    let phase: string = body.phase || 'A';

    if (!clientId) {
      return new Response(JSON.stringify({ error: 'clientId required' }), { status: 400 });
    }

    const client = await getClientById(clientId);

    // ── Resume detection: if there's a stuck audit for this client,
    // resume from where it left off instead of starting over.
    // This handles the case where a self-chain from Phase A→B or B→C
    // failed (Vercel killed the function before the fetch fired).
    if (phase === 'A' && !existingAuditId) {
      try {
        const { getSupabase } = await import('../../../lib/db');
        const sb = getSupabase();
        const { data: stuckAudits } = await sb
          .from('audits')
          .select('id, current_step, updated_at')
          .ilike('url', `%${client.domain}%`)
          .eq('status', 'processing')
          .order('updated_at', { ascending: false })
          .limit(1);

        if (stuckAudits?.length) {
          const stuck = stuckAudits[0];
          const ageMinutes = (Date.now() - new Date(stuck.updated_at).getTime()) / 60000;
          if (ageMinutes > 3) {
            // Audit is stuck — resume from its current step
            existingAuditId = stuck.id;
            const step = stuck.current_step;
            // Determine which phase to resume
            if (step === 'growth_agent' || step === 'done') phase = 'C';
            else if (step === 'competitor_traffic' || step === 'score') phase = 'B';
            // else: phase stays 'A' (restart from wherever it was)
            console.log(`[radar:single] Detected stuck audit ${stuck.id} at step=${step} (${Math.round(ageMinutes)}min old) — resuming as Phase ${phase}`);
          }
        }
      } catch { /* non-fatal — proceed with fresh audit */ }
    }

    console.log(`[radar:single] Phase ${phase} for ${client.name} (${client.domain})...`);

    // Phase boundaries (pipeline step names from types.ts)
    // Phase A: crawl → ... → instagram phase → STOP before competitor_traffic
    // Phase B: competitor_traffic phase → score → STOP before growth_agent
    // Phase C: growth_agent → done → post-pipeline work
    const PHASE_CONFIG: Record<string, { stopBefore?: string; nextPhase?: string }> = {
      A: { stopBefore: 'competitor_traffic', nextPhase: 'B' },
      B: { stopBefore: 'growth_agent', nextPhase: 'C' },
      C: { /* run to 'done' + post-pipeline */ },
    };

    const config = PHASE_CONFIG[phase] || PHASE_CONFIG.A;

    const result = await runRadarForClient(
      { id: client.id, name: client.name, domain: client.domain },
      {
        existingAuditId: existingAuditId || undefined,
        stopBefore: config.stopBefore as any,
      },
    );

    console.log(`[radar:single] Phase ${phase} ${client.domain}: ${result.success ? 'OK' : 'FAIL'} in ${result.durationMs}ms`);

    // Self-chain to next phase (fire-and-forget)
    if (result.success && config.nextPhase && result.auditId) {
      const selfUrl = new URL('/api/radar/run-client', request.url).href;
      const authValue = authHeader || `Bearer ${CRON_SECRET}`;
      fetch(selfUrl, {
        method: 'POST',
        headers: {
          'Authorization': authValue,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId,
          auditId: result.auditId,
          phase: config.nextPhase,
        }),
      }).catch(err => {
        console.warn(`[radar:single] Fire-and-forget to phase ${config.nextPhase} failed: ${(err as Error).message}. Will retry on next cron.`);
      });
    }

    return new Response(JSON.stringify({ ...result, phase }), {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
};
