import { runCrawl } from './modules/crawl';
import { runSSL } from './modules/ssl';
import { runPageSpeed } from './modules/pagespeed';
import { runSector } from './modules/sector';
import { runContent } from './modules/content';
import { runGEO } from './modules/geo';
import { runInstagram } from './modules/instagram';
import { runLinkedIn } from './modules/linkedin';
import { runGBP } from './modules/gbp';
import { runTraffic } from './modules/traffic';
import { runSEO } from './modules/seo';
import { runSeoPages } from './modules/seo-pages';
import { runCompetitors } from './modules/competitors';
import { runCompetitorTraffic } from './modules/competitor-traffic';
import { runKeywordGap } from './modules/keyword-gap';
import { runTechStack } from './modules/techstack';
import { runConversion } from './modules/conversion';
import { runScore } from './modules/score';
import { runInsights } from './modules/insights';
import { runContentCadence } from './modules/content-cadence';
import { runReputation } from './modules/reputation';
import { runMetaAds } from './modules/meta-ads';
import { runQAAgent } from './modules/qa-agent';
import { runCompetitorPageSpeed } from './modules/competitor-pagespeed';
import { NEXT_STEP } from './types';
import type { AuditStep, AuditStepOrDone, ModuleResult, AuditPageData, CrawlResult } from './types';

const APPS_SCRIPT_SOCIAL_WEBHOOK =
  import.meta.env.APPS_SCRIPT_SOCIAL_WEBHOOK || process.env.APPS_SCRIPT_SOCIAL_WEBHOOK;

// ── Phase definitions ─────────────────────────────────────────────
// 4 phases: crawl runs alone, then 3 parallel phases, then synthesis (sequential).

/** Steps within each phase — run in parallel via Promise.allSettled */
export const PHASE_STEPS: Record<string, AuditStep[]> = {
  // Phase 1: all steps that only need URL / crawl data
  ssl: [
    'ssl', 'pagespeed', 'seo', 'seo_pages', 'traffic',
    'gbp', 'techstack', 'content_cadence',
  ],
  // Phase 2: steps that need crawl + phase 1 results
  sector: ['sector', 'content', 'conversion', 'reputation', 'competitors'],
  // Phase 3: steps that need competitors from phase 2
  competitor_traffic: [
    'competitor_traffic', 'competitor_pagespeed', 'keyword_gap',
    'geo', 'instagram', 'linkedin', 'meta_ads',
  ],
};

/** Phase entry step → next phase entry step (or first synthesis step) */
export const PHASE_NEXT_STEP: Record<string, AuditStepOrDone> = {
  ssl: 'sector',
  sector: 'competitor_traffic',
  competitor_traffic: 'score',
};

/** Set for O(1) phase entry lookup */
export const PHASE_ENTRY_STEPS = new Set(Object.keys(PHASE_STEPS));

// ── Per-module timeouts (ms) ──────────────────────────────────────

export const STEP_TIMEOUTS: Record<string, number> = {
  geo: 55_000,
  competitor_traffic: 45_000,
  seo: 30_000,
  pagespeed: 40_000,
  traffic: 30_000,
  instagram: 15_000,
  linkedin: 15_000,
  reputation: 20_000,
  insights: 65_000,
  qa: 40_000,
  score: 10_000,
  competitors: 20_000,
};
const DEFAULT_TIMEOUT = 15_000;

// ── Social prefetch ───────────────────────────────────────────────

function triggerSocialPrefetch(pageId: string, crawl: CrawlResult): void {
  if (!APPS_SCRIPT_SOCIAL_WEBHOOK) return;
  if (!crawl.instagramHandle && !crawl.linkedinUrl) return;

  fetch(APPS_SCRIPT_SOCIAL_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pageId,
      instagramHandle: crawl.instagramHandle || null,
      linkedinUrl: crawl.linkedinUrl || null,
    }),
  }).catch(() => { /* intentionally ignored */ });
}

// ── Step execution ────────────────────────────────────────────────

export interface StepExecution {
  result: ModuleResult;
  moduleKey: string;
  nextStep: AuditStepOrDone;
}

/** Run a single step with a per-module timeout. Returns {skipped} on timeout. */
async function executeStepWithTimeout(
  step: AuditStep,
  audit: AuditPageData,
): Promise<ModuleResult> {
  const timeoutMs = STEP_TIMEOUTS[step] ?? DEFAULT_TIMEOUT;
  const t0 = Date.now();

  const result = await Promise.race([
    runStep(step, audit),
    new Promise<ModuleResult>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${step} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]).catch((err: Error) => ({
    skipped: true,
    reason: err.message.slice(0, 120),
  }));

  const ms = Date.now() - t0;
  const status = result.skipped ? 'SKIP' : (result as any).error ? 'ERR' : 'OK';
  const detail = (result as any)._log || (result as any).reason || (result as any).error || '';
  console.log(`[audit:${step}] ${status} ${ms}ms${detail ? ' | ' + detail.slice(0, 120) : ''}`);

  return { ...result, _t: ms };
}

/** Core step dispatcher — same logic as before, now called by timeout wrapper */
async function runStep(step: AuditStep, audit: AuditPageData): Promise<ModuleResult> {
  const { url, results } = audit;

  switch (step) {
    case 'crawl':
      return runCrawl(url);

    case 'ssl':
      return runSSL(url);

    case 'pagespeed':
      return runPageSpeed(url);

    case 'sector':
      return runSector(url, results.crawl || {});

    case 'content':
      return runContent(url, results.crawl || {});

    case 'geo': {
      const sector = (results.sector as any)?.sector || 'business services';
      const comps: Array<{ name: string; url: string }> =
        (results.competitors as any)?.competitors || [];
      return runGEO(url, sector, results.crawl || {}, comps);
    }

    case 'competitor_pagespeed': {
      const comps: Array<{ name: string; url: string }> =
        (results.competitors as any)?.competitors || [];
      return runCompetitorPageSpeed(comps);
    }

    case 'gbp':
      return runGBP(url, results.crawl || {});

    case 'reputation':
      return runReputation(url, results.crawl || {}, results.gbp);

    case 'traffic':
      return runTraffic(url);

    case 'seo':
      return runSEO(url);

    case 'seo_pages':
      return runSeoPages(url);

    case 'content_cadence':
      return runContentCadence(url);

    case 'competitors': {
      const sector = (results.sector as any)?.sector || 'business services';
      // Use DataForSEO organic competitors from SEO module when no user competitors were selected.
      // These domains are guaranteed to have DataForSEO data → competitor_traffic won't fail.
      const dfsOrganic = !audit.userCompetitors?.length
        ? (results.seo as any)?.organicCompetitors
        : undefined;
      return runCompetitors(url, sector, results.crawl || {}, audit.userCompetitors, dfsOrganic);
    }

    case 'competitor_traffic': {
      const comps: Array<{ name: string; url: string }> =
        (results.competitors as any)?.competitors || [];
      return runCompetitorTraffic(comps);
    }

    case 'keyword_gap': {
      const ctItems: Array<{ url: string; domainRank?: number }> =
        (results.competitor_traffic as any)?.items || [];
      const compsByDr = [...ctItems].sort((a, b) => (b.domainRank || 0) - (a.domainRank || 0));
      const bestComp = compsByDr[0]?.url ||
        (results.competitors as any)?.competitors?.[0]?.url || '';
      return runKeywordGap(url, bestComp);
    }

    case 'instagram': {
      if (results.instagram) return results.instagram;
      const competitorUrls = (results.competitors as any)?.competitors?.map((c: any) => c.url) || [];
      return runInstagram(results.crawl || {}, competitorUrls, audit.userInstagram);
    }

    case 'linkedin': {
      if (results.linkedin) return results.linkedin;
      const competitorUrls = (results.competitors as any)?.competitors?.map((c: any) => c.url) || [];
      return runLinkedIn(results.crawl || {}, competitorUrls, audit.userLinkedin);
    }

    case 'techstack':
      return runTechStack(url);

    case 'conversion':
      return runConversion(url, results.crawl || {});

    case 'score':
      return runScore(results);

    case 'insights':
      return runInsights(url, results);

    case 'meta_ads': {
      const comps: Array<{ name: string; url: string }> =
        (results.competitors as any)?.competitors || [];
      return runMetaAds(url, results.crawl || {}, comps);
    }

    case 'qa':
      return runQAAgent(results);

    default:
      return { skipped: true, reason: `Unknown step: ${step}` };
  }
}

// ── Phase execution ───────────────────────────────────────────────

export interface PhaseExecution {
  moduleResults: Array<{ moduleKey: string; result: ModuleResult }>;
  nextStep: AuditStepOrDone;
  extraProps: { score?: number; sector?: string };
}

/**
 * Run all steps in a phase in parallel (Promise.allSettled).
 * Returns all results regardless of individual failures.
 */
export async function executePhase(
  phaseEntry: AuditStep,
  audit: AuditPageData,
): Promise<PhaseExecution> {
  const steps = PHASE_STEPS[phaseEntry];
  const nextStep = PHASE_NEXT_STEP[phaseEntry] ?? 'score';

  const settled = await Promise.allSettled(
    steps.map(async (step) => {
      const result = await executeStepWithTimeout(step, audit);
      return { moduleKey: step, result };
    }),
  );

  const moduleResults = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { moduleKey: steps[i], result: { skipped: true, reason: 'Phase step failed unexpectedly' } },
  );

  // Extract extra props (score, sector) if present
  const extraProps: { score?: number; sector?: string } = {};
  for (const { moduleKey, result } of moduleResults) {
    if (moduleKey === 'score' && (result as any).total !== undefined) {
      extraProps.score = (result as any).total;
    }
    if (moduleKey === 'sector' && (result as any).sector) {
      extraProps.sector = (result as any).sector;
    }
  }

  return { moduleResults, nextStep, extraProps };
}

// ── Single step execution (crawl + synthesis steps) ──────────────

/**
 * Execute a single step (used for crawl + score/insights/qa).
 * Applies correctedInsights from QA if present.
 */
export async function executeStep(step: AuditStep, audit: AuditPageData): Promise<StepExecution> {
  const nextStep = NEXT_STEP[step];
  let result: ModuleResult;

  try {
    result = await executeStepWithTimeout(step, audit);

    // Crawl: trigger social prefetch after completing
    if (step === 'crawl') {
      triggerSocialPrefetch(audit.notionPageId, result as CrawlResult);
    }

    // QA: if correctedInsights provided, update insights in results for downstream use
    if (step === 'qa' && (result as any).correctedInsights) {
      audit.results.insights = {
        ...(audit.results.insights || {}),
        ...(result as any).correctedInsights,
      };
    }
  } catch (err: any) {
    result = { error: err.message?.slice(0, 150) || 'Module failed unexpectedly' };
  }

  return { result, moduleKey: step, nextStep };
}
