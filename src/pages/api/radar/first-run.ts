import type { APIRoute } from 'astro';
import {
  findRecentAuditByDomain, createSnapshotFromAudit, IS_DEMO,
  getAllSnapshots, logRecommendation, getSupabase,
} from '../../../lib/db';
import { createAuditPage, getAuditPage } from '../../../lib/audit/supabase-storage';

export const prerender = false;

/**
 * POST /api/radar/first-run
 * Triggered after onboarding to ensure the client has data + recommendations.
 *
 * Logic:
 * 1. Check if a recent audit (< 12h) exists for this domain → reuse it
 * 2. If not, start a new audit pipeline
 * 3. If linked, copy growth_analysis from audit to snapshot and seed recommendations
 *
 * The audit pipeline already ran the Growth Agent at its final step
 * (src/lib/audit/runner.ts → case 'growth_agent'), so the analysis is
 * already verified by Opus QA and stored in audit.results.growth_agent.
 * first-run.ts just copies it verbatim — zero regeneration, zero drift
 * between audit report and dashboard.
 *
 * Body: { domain: string, clientId: string, email?: string, clientName?: string }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { domain, clientId, email, clientName } = body;

    if (!domain) {
      return new Response(JSON.stringify({ error: 'domain required' }), { status: 400 });
    }

    if (IS_DEMO) {
      return new Response(JSON.stringify({ status: 'linked', auditId: 'demo-audit', message: 'Demo mode' }));
    }

    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    const recentAudit = await findRecentAuditByDomain(cleanDomain, 12);

    if (recentAudit) {
      // Reuse existing audit — link as first snapshot
      try {
        await createSnapshotFromAudit(recentAudit.id, clientId);
      } catch (e) {
        console.log(`[first-run] Snapshot link note: ${(e as Error).message}`);
      }

      try {
        await seedFromAudit(clientId, recentAudit.id, cleanDomain);
      } catch (e) {
        console.error(`[first-run] Seeding failed:`, (e as Error).message);
      }

      return new Response(JSON.stringify({
        status: 'linked',
        auditId: recentAudit.id,
        message: `Reused recent audit (score: ${recentAudit.score})`,
      }));
    }

    // No recent audit — start a new one
    const url = `https://${cleanDomain}`;
    const auditId = await createAuditPage(url, email || 'radar@aiongrowth.com');

    return new Response(JSON.stringify({
      status: 'started',
      auditId,
      message: 'New audit started — poll /api/audit/{id}/status for progress',
    }));

  } catch (err) {
    console.error('[first-run] Error:', (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
};

/**
 * Copy the Growth Agent analysis from the completed audit into the
 * client's snapshot, then seed the recommendations log from the
 * prioritizedActions. No LLM calls — the audit pipeline already did
 * all the generation and QA.
 */
async function seedFromAudit(clientId: string, auditId: string, domain: string) {
  const audit = await getAuditPage(auditId);
  const auditResults = audit.results || {};
  const growthAnalysis = auditResults.growth_agent as any;

  if (!growthAnalysis || !Array.isArray(growthAnalysis.prioritizedActions)) {
    console.warn(`[first-run] No growth_analysis in audit ${auditId} — client dashboard will show metric-only view`);
    return;
  }

  // Copy growth_analysis into the snapshot's pipeline_output so dashboard
  // pages read the exact same analysis that the audit report shows.
  const snapshots = await getAllSnapshots(clientId);
  if (snapshots.length === 0) return;
  const latest = snapshots[snapshots.length - 1];

  try {
    const sb = getSupabase();
    const updated: Record<string, any> = {
      ...(latest.pipeline_output || {}),
      growth_analysis: growthAnalysis,
    };
    await sb.from('snapshots').update({ pipeline_output: updated }).eq('id', latest.id);
  } catch (e) {
    console.error(`[first-run] Snapshot save failed:`, (e as Error).message);
  }

  // Seed recommendations from prioritizedActions — rank + pillar + full detail
  for (const action of growthAnalysis.prioritizedActions) {
    await logRecommendation({
      client_id: clientId,
      source: 'growth_agent',
      pillar: action.pillar,
      title: action.title,
      description: action.description,
      impact: action.businessImpact || 'high',
      status: 'pending',
      data: {
        rank: action.rank,
        detail: action.detail,
        expectedOutcome: action.expectedOutcome,
        effort: action.effort,
        timeframe: action.timeframe,
        rationale: action.rationale,
        linkedGap: action.linkedGap,
      },
    });
  }
  console.log(`[first-run] Seeded ${growthAnalysis.prioritizedActions.length} actions for ${domain}`);
}
