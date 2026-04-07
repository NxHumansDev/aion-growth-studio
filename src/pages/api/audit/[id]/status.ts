export const prerender = false;

import type { APIRoute } from 'astro';
import { getAuditPage, saveModuleResult, savePhaseResults, markAuditError } from '../../../../lib/audit/supabase-storage';
import { updateLeadStatus } from '../../../../lib/db';
import { sendPostAuditEmail } from '../../../../lib/email/post-audit';
import { executeStep, executePhase, PHASE_ENTRY_STEPS } from '../../../../lib/audit/runner';
import { evaluateCoverage } from '../../../../lib/audit/coverage';
import { logAuditRun } from '../../../../lib/audit/audit-logger';
import { STEP_PROGRESS } from '../../../../lib/audit/types';
import type { AuditStep } from '../../../../lib/audit/types';
import { validateApiKey, mapResultsForPlatform } from '../../../../lib/api-auth';

// Progress values reported after each phase completes (shown as the next phase entry's progress)
const PHASE_COMPLETE_PROGRESS: Record<string, number> = {
  sector: 35,             // phase 1 done
  instagram: 50,          // phase 2 done
  competitor_traffic: 70, // phase 3 done (social)
  score: 87,              // phase 4 done (competitors)
};

export const GET: APIRoute = async ({ params, request }) => {
  const { id } = params;

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing audit ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = validateApiKey(request);

  if (!auth.valid) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isPlatform = auth.source === 'platform' || auth.source === 'dev';

  try {
    const audit = await getAuditPage(id);

    // Already completed
    if (audit.status === 'completed' || audit.currentStep === 'done') {
      const completedModules = Object.keys(audit.results);
      const mappedResults = isPlatform ? mapResultsForPlatform(audit.results) : audit.results;

      if (isPlatform) {
        return new Response(
          JSON.stringify({
            status: 'completed',
            currentModule: 'done',
            completedModules,
            results: mappedResults,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          status: 'completed',
          progress: 100,
          results: audit.results,
          score: audit.score,
          sector: audit.sector,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Error state
    if (audit.status === 'error') {
      if (isPlatform) {
        return new Response(
          JSON.stringify({ status: 'failed', error: 'Audit processing failed' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ status: 'error', progress: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const currentStep = audit.currentStep as AuditStep;

    // ── Phase execution (parallel steps) ─────────────────────────
    if (PHASE_ENTRY_STEPS.has(currentStep)) {
      const { moduleResults, nextStep, extraProps } = await executePhase(currentStep, audit);

      await savePhaseResults(id, moduleResults, nextStep, extraProps);

      const isCompleted = nextStep === 'done';
      const completedModuleKeys = moduleResults.map((r) => r.moduleKey);
      const progress = isCompleted
        ? 100
        : PHASE_COMPLETE_PROGRESS[nextStep as string] ?? STEP_PROGRESS[nextStep as AuditStep] ?? 50;

      if (isPlatform) {
        return new Response(
          JSON.stringify({
            status: isCompleted ? 'completed' : 'running',
            currentModule: isCompleted ? 'done' : (nextStep as string),
            completedModules: [...Object.keys(audit.results), ...completedModuleKeys],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          status: isCompleted ? 'completed' : 'processing',
          progress,
          module_completed: completedModuleKeys.join(','),
          currentStep: nextStep,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── Single step execution (crawl + score/insights/qa) ────────
    const { result, moduleKey, nextStep } = await executeStep(currentStep, audit);

    const extraProps: { score?: number; sector?: string } = {};
    if (moduleKey === 'score' && (result as any).total !== undefined) {
      extraProps.score = (result as any).total;
    }
    if (moduleKey === 'sector' && (result as any).sector) {
      extraProps.sector = (result as any).sector;
    }

    // If QA produced corrected insights, also save them
    if (moduleKey === 'qa' && (result as any).correctedInsights) {
      await saveModuleResult(id, 'insights', (result as any).correctedInsights, 'qa', {});
    }

    await saveModuleResult(id, moduleKey, result, nextStep, extraProps);

    const isCompleted = nextStep === 'done';

    // Log coverage on completion (no retry in this request to avoid timeout)
    if (isCompleted) {
      const finalResults = { ...audit.results, [moduleKey]: result };
      const coverage = evaluateCoverage(finalResults);
      console.log(`[audit:coverage] ${coverage.coveragePct}% (${coverage.successfulPoints}/${coverage.totalPoints}) | critical missing: ${coverage.criticalMissing.join(',') || 'none'}`);
      // Log to Supabase (non-blocking)
      logAuditRun(audit.url, id, finalResults, Date.now()).catch(() => {});
      // Update lead status (non-blocking)
      if (audit.email) {
        updateLeadStatus(audit.email, audit.url, 'audit_completed', id).catch(() => {});

        // Send post-audit email with score summary (non-blocking)
        const scoreResult = finalResults.score || {};
        const insightsResult = finalResults.insights || {};
        sendPostAuditEmail({
          to: audit.email,
          domain: new URL(audit.url).hostname.replace(/^www\./, ''),
          score: scoreResult.total ?? 0,
          auditId: id,
          scoreBreakdown: scoreResult.breakdown,
          topInsight: insightsResult.summary?.slice(0, 200),
        }).catch(() => {});
      }
    }

    const progress = isCompleted
      ? 100
      : PHASE_COMPLETE_PROGRESS[nextStep as string] ?? STEP_PROGRESS[nextStep as AuditStep] ?? 99;
    const allResults = isCompleted ? { ...audit.results, [moduleKey]: result } : null;

    if (isPlatform) {
      const completedModules = [...Object.keys(audit.results), moduleKey];
      return new Response(
        JSON.stringify({
          status: isCompleted ? 'completed' : 'running',
          currentModule: isCompleted ? 'done' : (nextStep as string),
          completedModules,
          ...(isCompleted && allResults ? { results: mapResultsForPlatform(allResults) } : {}),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        status: isCompleted ? 'completed' : 'processing',
        progress,
        module_completed: moduleKey,
        currentStep: nextStep,
        results: allResults,
        score: isCompleted ? extraProps.score ?? audit.score : undefined,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('Audit status error:', err);

    // If QA step fails/timeouts, complete the audit without QA rather than marking as error
    try {
      const audit = await getAuditPage(id);
      if (audit.currentStep === 'qa') {
        console.log(`[audit] QA timed out for ${id} — completing without QA`);
        const qaBypass = { approved: true, issues: [], suppressedSections: [], qaBypassed: true, overallAssessment: 'QA skipped (timeout)' };
        await saveModuleResult(id, 'qa', qaBypass, 'done', {});

        // Still send email + update lead
        if (audit.email) {
          const { sendPostAuditEmail } = await import('../../../../lib/email/post-audit');
          const { updateLeadStatus } = await import('../../../../lib/db');
          const finalResults = { ...audit.results, qa: qaBypass };
          const scoreResult = finalResults.score || {};
          sendPostAuditEmail({
            to: audit.email,
            domain: new URL(audit.url).hostname.replace(/^www\./, ''),
            score: scoreResult.total ?? 0,
            auditId: id,
            scoreBreakdown: scoreResult.breakdown,
            topInsight: finalResults.insights?.summary?.slice(0, 200),
          }).catch(() => {});
          updateLeadStatus(audit.email, audit.url, 'audit_completed', id).catch(() => {});
        }

        return new Response(
          JSON.stringify({ status: 'completed', progress: 100 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    } catch { /* ignore fallback error */ }

    try {
      await markAuditError(id);
    } catch {
      // ignore secondary error
    }

    if (isPlatform) {
      return new Response(
        JSON.stringify({ status: 'failed', error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ status: 'error', error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
