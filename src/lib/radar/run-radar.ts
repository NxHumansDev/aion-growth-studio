import { createAuditPage, getAuditPage, saveModuleResult, savePhaseResults } from '../audit/supabase-storage';
import { executeStep, executePhase, PHASE_ENTRY_STEPS, PHASE_NEXT_STEP } from '../audit/runner';
import { NEXT_STEP } from '../audit/types';
import type { AuditStep, AuditStepOrDone } from '../audit/types';
import {
  createSnapshotFromAudit, getAllSnapshots, getAllRecommendations,
  getClientOnboarding, logRecommendation, logInteraction,
} from '../db';
import { analyzeEvolution } from './diff-engine';
import { generateBriefing } from '../briefing';
import { buildClientContext } from './client-context';

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
 * Run the full Radar workflow for a single client:
 * 1. Create audit → run full pipeline
 * 2. Create snapshot from audit
 * 3. Analyze evolution (diff + correlations)
 * 4. Generate new recommendations based on context
 */
export async function runRadarForClient(client: RadarClient): Promise<RadarRunResult> {
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
    console.log(`[radar] Starting for ${client.domain}...`);

    // 0. Load onboarding data (competitors, social handles, sector)
    const clientOnboarding = await getClientOnboarding(client.id);
    const compUrls = (clientOnboarding?.competitors || []).map(c => c.url).filter(Boolean);

    // 1. Create audit with client's configured data
    const url = `https://${client.domain}`;
    const email = client.email || 'radar@aiongrowth.com';
    const auditId = await createAuditPage(url, email, {
      competitors: compUrls.length ? compUrls : undefined,
      instagram: clientOnboarding?.instagram_handle || undefined,
      linkedin: clientOnboarding?.linkedin_url || undefined,
    });
    result.auditId = auditId;

    // 2. Run full pipeline (synchronous, step by step)
    let currentStep: AuditStepOrDone = 'crawl';
    while (currentStep !== 'done') {
      const audit = await getAuditPage(auditId);

      if (PHASE_ENTRY_STEPS.has(currentStep as AuditStep)) {
        // Phase execution (parallel steps)
        const { moduleResults, nextStep, extraProps } = await executePhase(currentStep as AuditStep, audit);
        await savePhaseResults(auditId, moduleResults, nextStep, extraProps);
        currentStep = nextStep;
      } else {
        // Single step execution
        const { result: stepResult, moduleKey, nextStep } = await executeStep(currentStep as AuditStep, audit);
        const extraProps: { score?: number; sector?: string } = {};
        if (moduleKey === 'score' && (stepResult as any).total !== undefined) {
          extraProps.score = (stepResult as any).total;
        }
        if (moduleKey === 'sector' && (stepResult as any).sector) {
          extraProps.sector = (stepResult as any).sector;
        }
        if (moduleKey === 'qa' && (stepResult as any).correctedInsights) {
          await saveModuleResult(auditId, 'insights', (stepResult as any).correctedInsights, 'qa', {});
        }
        await saveModuleResult(auditId, moduleKey, stepResult, nextStep, extraProps);
        currentStep = nextStep;
      }
    }

    console.log(`[radar] Pipeline complete for ${client.domain} in ${Date.now() - t0}ms`);

    // 3. Create snapshot from completed audit
    const snapshotId = await createSnapshotFromAudit(auditId, client.id);
    result.snapshotId = snapshotId;

    // 4. Analyze evolution + correlations
    const snapshots = await getAllSnapshots(client.id);
    const allRecs = await getAllRecommendations(client.id);
    const diff = analyzeEvolution(snapshots, allRecs);
    result.correlationsFound = diff.correlations.length;

    // 5. Build full client context and generate new recommendations
    const ctx = await buildClientContext(client.id, client.name, client.domain);
    const onboarding = ctx.onboarding;
    if (onboarding) {
      const latestSnapshot = snapshots[snapshots.length - 1];
      const briefing = await generateBriefing({
        onboarding,
        auditResults: latestSnapshot.pipeline_output,
        clientName: client.name,
        domain: client.domain,
        clientContext: ctx.text,
      });

      // Seed new recommendations (only ones not already tracked)
      const existingTitles = new Set(allRecs.map(r => r.title.toLowerCase()));
      let newCount = 0;
      for (const priority of briefing.priorities || []) {
        if (!existingTitles.has(priority.title.toLowerCase())) {
          await logRecommendation({
            client_id: client.id,
            source: 'radar',
            title: priority.title,
            description: priority.description,
            impact: priority.impact || 'high',
            status: 'pending',
          });
          newCount++;
        }
      }
      result.newRecommendations = newCount;
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
