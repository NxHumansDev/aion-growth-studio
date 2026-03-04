export const prerender = false;

import type { APIRoute } from 'astro';
import { getAuditPage, saveModuleResult, markAuditError } from '../../../../lib/audit/notion';
import { executeStep } from '../../../../lib/audit/runner';
import { STEP_PROGRESS } from '../../../../lib/audit/types';
import type { AuditStep } from '../../../../lib/audit/types';
import { validateApiKey, mapResultsForPlatform } from '../../../../lib/api-auth';

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

    // Execute the current step
    const currentStep = audit.currentStep as AuditStep;
    const { result, moduleKey, nextStep } = await executeStep(currentStep, audit);

    // Prepare extra property updates
    const extraProps: { score?: number; sector?: string } = {};
    if (moduleKey === 'score' && (result as any).total !== undefined) {
      extraProps.score = (result as any).total;
    }
    if (moduleKey === 'sector' && (result as any).sector) {
      extraProps.sector = (result as any).sector;
    }

    // Save result and advance step
    await saveModuleResult(id, moduleKey, result, nextStep, extraProps);

    const isCompleted = nextStep === 'done';
    const progress = isCompleted ? 100 : STEP_PROGRESS[nextStep as AuditStep] ?? 99;
    const allResults = isCompleted
      ? { ...audit.results, [moduleKey]: result }
      : null;

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
