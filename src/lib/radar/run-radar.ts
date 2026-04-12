import { createAuditPage, getAuditPage, saveModuleResult, savePhaseResults } from '../audit/supabase-storage';
import { executeStep, executePhase, PHASE_ENTRY_STEPS, PHASE_NEXT_STEP } from '../audit/runner';
import { NEXT_STEP } from '../audit/types';
import type { AuditStep, AuditStepOrDone } from '../audit/types';
import {
  createSnapshotFromAudit, getAllSnapshots, getAllRecommendations,
  getClientOnboarding, logRecommendation, logInteraction,
  getClientById, getActionPlan, getCompletedActions, getRejectedRecommendations,
  getSupabase,
} from '../db';
import { analyzeEvolution } from './diff-engine';
import { buildClientContext } from './client-context';
import { ingestAnalytics } from '../analytics/ingest';
import { runGrowthAgent, type IntegrationSummary } from '../ai/growth-agent';
import { getIntegration } from '../integrations';

interface RadarClient {
  id: string;
  name: string;
  domain: string;
  email?: string;
}

interface RadarRunResult {
  clientId: string;
  domain: string;
  success: boolean;
  auditId?: string;
  snapshotId?: string;
  newRecommendations: number;
  correlationsFound: number;
  error?: string;
  durationMs: number;
}

/**
 * Run the Radar workflow for a single client, optionally stopping at a
 * specific step for phased execution.
 *
 * Phased mode (stopBefore set): runs the pipeline until it reaches stopBefore,
 * then breaks. The audit's current_step is left at stopBefore so the next
 * phase can resume from there. Post-pipeline work (snapshot, analytics, etc.)
 * only runs when the pipeline reaches 'done'.
 *
 * Full mode (no stopBefore): runs the entire pipeline + post-pipeline work
 * in one invocation. This may timeout on Vercel (300s) for data-rich clients.
 *
 * @param options.existingAuditId - resume an existing audit instead of creating a new one
 * @param options.stopBefore - stop the pipeline BEFORE this step (e.g. 'competitor_traffic')
 */
export interface RadarRunOptions {
  existingAuditId?: string;
  stopBefore?: AuditStepOrDone;
}

export async function runRadarForClient(client: RadarClient, options?: RadarRunOptions): Promise<RadarRunResult> {
  const t0 = Date.now();
  const result: RadarRunResult = {
    clientId: client.id,
    domain: client.domain,
    success: false,
    newRecommendations: 0,
    correlationsFound: 0,
    durationMs: 0,
  };

  try {
    const isResume = !!options?.existingAuditId;
    console.log(`[radar] ${isResume ? 'Resuming' : 'Starting'} for ${client.domain}${options?.stopBefore ? ` (stop before ${options.stopBefore})` : ''}...`);

    // 0. Load onboarding data (competitors, social handles, sector)
    const clientOnboarding = await getClientOnboarding(client.id);
    const compUrls = (clientOnboarding?.competitors || []).map(c => c.url).filter(Boolean);

    // 1. Create audit (or reuse existing for phased execution)
    let auditId: string;
    if (options?.existingAuditId) {
      auditId = options.existingAuditId;
    } else {
      const url = `https://${client.domain}`;
      const email = client.email || 'radar@aiongrowth.com';
      auditId = await createAuditPage(url, email, {
        competitors: compUrls.length ? compUrls : undefined,
        instagram: clientOnboarding?.instagram_handle || undefined,
        linkedin: clientOnboarding?.linkedin_url || undefined,
      });
    }
    result.auditId = auditId;

    // 2. Run pipeline step by step (with optional stop point)
    // Read the audit to find the current step (handles resume from phase B/C)
    const auditState = await getAuditPage(auditId);
    let currentStep: AuditStepOrDone = isResume ? (auditState.currentStep || 'crawl') : 'crawl';

    while (currentStep !== 'done') {
      // Phased execution: stop before the designated step
      if (options?.stopBefore && currentStep === options.stopBefore) {
        console.log(`[radar] Phase stop: reached ${currentStep} (stopBefore=${options.stopBefore}) in ${Date.now() - t0}ms`);
        break;
      }

      const audit = await getAuditPage(auditId);

      if (PHASE_ENTRY_STEPS.has(currentStep as AuditStep)) {
        // Phase execution (parallel steps)
        const { moduleResults, nextStep, extraProps } = await executePhase(currentStep as AuditStep, audit);
        await savePhaseResults(auditId, moduleResults, nextStep, extraProps);
        currentStep = nextStep;
      } else {
        // Single step execution
        const { result: stepResult, moduleKey, nextStep } = await executeStep(currentStep as AuditStep, audit);
        const extraProps: { score?: number; sector?: string; url?: string } = {};
        if (moduleKey === 'score' && (stepResult as any).total !== undefined) {
          extraProps.score = (stepResult as any).total;
        }
        if (moduleKey === 'sector' && (stepResult as any).sector) {
          extraProps.sector = (stepResult as any).sector;
        }
        if (moduleKey === 'crawl' && (stepResult as any)?.finalUrl && (stepResult as any).finalUrl !== audit.url) {
          extraProps.url = (stepResult as any).finalUrl;
        }
        await saveModuleResult(auditId, moduleKey, stepResult, nextStep, extraProps);
        currentStep = nextStep;
      }
    }

    // If we stopped early (phased), return without post-pipeline work
    if (currentStep !== 'done') {
      result.success = true;
      result.durationMs = Date.now() - t0;
      console.log(`[radar] Phase complete for ${client.domain} in ${result.durationMs}ms (stopped at ${currentStep})`);
      return result;
    }

    console.log(`[radar] Pipeline complete for ${client.domain} in ${Date.now() - t0}ms`);

    // ═══════════════════════════════════════════════════════════════
    // POST-PIPELINE WORK — ordered by criticality (most important first)
    // so that even if Phase C times out, the dashboard has usable data.
    // ═══════════════════════════════════════════════════════════════

    // 3. Create snapshot (CRITICAL — dashboard needs this)
    const snapshotId = await createSnapshotFromAudit(auditId, client.id);
    result.snapshotId = snapshotId;

    // 4. Copy growth_agent → growth_analysis IMMEDIATELY (CRITICAL — hero text)
    // The pipeline step saved analysis as `growth_agent` key. The dashboard
    // reads from `growth_analysis`. Copy now before anything else can timeout.
    const pipelineGrowthAgent = (await getAuditPage(auditId)).results?.growth_agent;
    if (pipelineGrowthAgent && pipelineGrowthAgent.model !== 'fallback') {
      try {
        const sb = getSupabase();
        const { data: snapData } = await sb.from('snapshots').select('pipeline_output').eq('id', snapshotId).single();
        if (snapData) {
          const updated = { ...snapData.pipeline_output, growth_analysis: pipelineGrowthAgent };
          await sb.from('snapshots').update({ pipeline_output: updated }).eq('id', snapshotId);
          const { materializeSnapshotColumns } = await import('../data/kpi-extract');
          materializeSnapshotColumns(snapshotId, updated).catch(() => {});
        }
        console.log(`[radar] Copied growth_agent → growth_analysis (${pipelineGrowthAgent.prioritizedActions?.length || 0} actions)`);
      } catch (err) {
        console.error(`[radar] growth_analysis copy failed:`, (err as Error).message);
      }
    }

    // 5. Seed recommendations (IMPORTANT — plan de acción needs these)
    const allRecs = await getAllRecommendations(client.id);
    if (pipelineGrowthAgent?.prioritizedActions?.length) {
      try {
        const existingTitles = new Set(allRecs.map(r => r.title.toLowerCase()));
        let newCount = 0;
        for (const action of pipelineGrowthAgent.prioritizedActions) {
          if (!existingTitles.has(action.title.toLowerCase())) {
            await logRecommendation({
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
            });
            newCount++;
          }
        }
        result.newRecommendations = newCount;
        console.log(`[radar] Seeded ${newCount} new recommendations for ${client.domain}`);
      } catch (err) {
        console.error(`[radar] Recommendation seeding failed:`, (err as Error).message);
      }
    }

    // 6. Analytics ingestion (NICE-TO-HAVE — enriches but not critical for first view)
    try {
      const analyticsData = await ingestAnalytics(client.id, client.domain);
      if (analyticsData) {
        const sb = getSupabase();
        const { data: snapData } = await sb.from('snapshots').select('pipeline_output, date').eq('id', snapshotId).single();
        if (snapData) {
          const updated = { ...snapData.pipeline_output, analytics: analyticsData };
          await sb.from('snapshots').update({ pipeline_output: updated }).eq('id', snapshotId);
          console.log(`[radar] Analytics ingested: GA4=${!!analyticsData.ga4} GSC=${!!analyticsData.gsc}`);

          const { writeKpiSeries, materializeSnapshotColumns } = await import('../data/kpi-extract');
          writeKpiSeries(client.id, snapshotId, snapData.date, updated).catch(() => {});
          materializeSnapshotColumns(snapshotId, updated).catch(() => {});

          if (analyticsData.dataQualityScore != null) {
            const { updateDataQualityScore } = await import('../integrations');
            await updateDataQualityScore(client.id, 'google_analytics', analyticsData.dataQualityScore);
          }
        }
      }
    } catch (err) {
      console.error(`[radar] Analytics failed (non-fatal):`, (err as Error).message);
    }

    // 7. Diff engine + correlations (NICE-TO-HAVE — "cambios esta semana")
    try {
      const snapshots = await getAllSnapshots(client.id);
      const diff = analyzeEvolution(snapshots, allRecs);
      result.correlationsFound = diff.correlations.length;

      const meaningfulCorrelations = diff.correlations.filter(
        c => c.correlationType === 'probable_cause' || c.correlationType === 'possible_cause',
      );
      if (meaningfulCorrelations.length > 0) {
        const { saveLearnings } = await import('../advisor/db');
        await saveLearnings(client.id, meaningfulCorrelations.map(c => ({
          type: 'action_result' as const,
          content: c.explanation,
          metadata: {
            recommendation_title: c.actionTitle, action_date: c.actionDate,
            kpi_key: c.kpiKey, kpi_label: c.kpiLabel,
            delta_before: c.deltaBefore, delta_after: c.deltaAfter,
            delta_pct: c.deltaAfter && c.deltaBefore ? Math.round(((c.deltaAfter - c.deltaBefore) / Math.max(c.deltaBefore, 1)) * 100) : 0,
            correlation_type: c.correlationType,
          },
        })), 'radar').catch(() => {});

        // Write structured action_outcomes
        const sb = getSupabase();
        const onboarding = await getClientOnboarding(client.id);
        const outcomeRows = meaningfulCorrelations.map(c => ({
          client_id: client.id, action_title: c.actionTitle || 'Unknown',
          action_completed_at: c.actionDate || null, pillar: c.pillar || null,
          kpi_key: c.kpiKey, kpi_before: c.deltaBefore ?? null, kpi_after: c.deltaAfter ?? null,
          delta_abs: c.deltaAfter != null && c.deltaBefore != null ? c.deltaAfter - c.deltaBefore : null,
          delta_pct: c.deltaAfter != null && c.deltaBefore != null && c.deltaBefore !== 0
            ? Math.round(((c.deltaAfter - c.deltaBefore) / Math.abs(c.deltaBefore)) * 100) : null,
          correlation_type: c.correlationType, confidence: c.correlationType === 'probable_cause' ? 0.8 : 0.5,
          days_measured: 7, sector: onboarding?.sector || null,
        }));
        if (outcomeRows.length > 0) {
          await sb.from('action_outcomes').insert(outcomeRows).catch(() => {});
        }
        console.log(`[radar] ${meaningfulCorrelations.length} correlations + ${outcomeRows.length} outcomes`);
      }
    } catch (err) {
      console.error(`[radar] Diff engine failed (non-fatal):`, (err as Error).message);
    }

    // 6. Log interaction
    await logInteraction(client.id, 'radar_run', {
      auditId,
      snapshotId,
      correlations: diff.correlations.length,
      newRecommendations: result.newRecommendations,
      durationMs: Date.now() - t0,
    });

    result.success = true;
    console.log(`[radar] Complete for ${client.domain}: ${result.newRecommendations} new recs, ${result.correlationsFound} correlations`);
  } catch (err) {
    result.error = (err as Error).message;
    console.error(`[radar] Failed for ${client.domain}:`, result.error);
  }

  result.durationMs = Date.now() - t0;
  return result;
}
