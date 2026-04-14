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
import { runContentCadence } from './modules/content-cadence';
import { runReputation } from './modules/reputation';
import { runMetaAds } from './modules/meta-ads';
import { runGoogleShopping } from './modules/google-shopping';
import { runGrowthAgent } from '../ai/growth-agent';
import { runCompetitorPageSpeed } from './modules/competitor-pagespeed';
import { NEXT_STEP } from './types';
import type { AuditStep, AuditStepOrDone, ModuleResult, AuditPageData, CrawlResult } from './types';

// APPS_SCRIPT_SOCIAL_WEBHOOK removed — social modules fetch directly in Phase 3

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
  // Phase 3: social + brand signals (heavy Apify calls need their own time slot)
  instagram: ['instagram', 'linkedin', 'meta_ads', 'google_shopping'],
  // Phase 4: competitor enrichment (each module gets more time without competing)
  competitor_traffic: ['competitor_traffic', 'competitor_pagespeed', 'keyword_gap', 'geo'],
};

/** Phase entry step → next phase entry step (or first synthesis step) */
export const PHASE_NEXT_STEP: Record<string, AuditStepOrDone> = {
  ssl: 'sector',
  sector: 'instagram',
  instagram: 'competitor_traffic',
  competitor_traffic: 'score',
};

/** Set for O(1) phase entry lookup */
export const PHASE_ENTRY_STEPS = new Set(Object.keys(PHASE_STEPS));

// ── Per-module timeouts (ms) ──────────────────────────────────────

// Vercel Pro hard ceiling is 300s per function invocation. Each audit step
// is its own HTTP call, so every step gets the full 300s budget.
// We don't want artificial timeouts to be the cause of audit failures:
// every module gets as much time as Vercel allows, minus a safety margin
// so the timeout wrapper still catches genuinely stuck calls before Vercel
// kills the function with a 504 (which loses diagnostics).
const GENEROUS = 270_000; // 270s — leaves 30s headroom under the 300s Vercel ceiling

export const STEP_TIMEOUTS: Record<string, number> = {
  // Synthesis steps need less — they only run locally / on cached data
  score: 30_000,
  // growth_agent: Sonnet draft (~150-220s on full prompt with profile context)
  // + structural (~1s) + Opus QA (~60-120s) + corrections. Observed sum
  // reached 260s+ after adding the PROFILE benchmark context to the prompt.
  // Retry is disabled for this step (see runner retry guard), so a long
  // timeout can't cascade into a Vercel 300s kill. 290s leaves 10s headroom
  // under the 300s ceiling — worst case Opus QA is aborted and the draft is
  // returned as-is (still high quality, just not QA-verified).
  growth_agent: 290_000,
};
const DEFAULT_TIMEOUT = GENEROUS;

// ── Social prefetch ───────────────────────────────────────────────

// Social prefetch was a Notion-era optimization — modules fetch directly in Phase 3
function triggerSocialPrefetch(_auditId: string, _crawl: CrawlResult): void {
  // no-op: instagram/linkedin modules handle their own fetching
}

// ── Step execution ────────────────────────────────────────────────

export interface StepExecution {
  result: ModuleResult;
  moduleKey: string;
  nextStep: AuditStepOrDone;
}

/** Run a single step with a per-module timeout. Retries once on timeout/error. */
export async function executeStepWithTimeout(
  step: AuditStep,
  audit: AuditPageData,
): Promise<ModuleResult> {
  const timeoutMs = STEP_TIMEOUTS[step] ?? DEFAULT_TIMEOUT;
  const t0 = Date.now();

  const attempt = () => Promise.race([
    runStep(step, audit),
    new Promise<ModuleResult>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${step} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);

  let result = await attempt().catch((err: Error) => ({
    skipped: true,
    reason: err.message.slice(0, 120),
    _retryable: true,
  }));

  // growth_agent has its own internal fallback (deterministic analysis from pipeline data).
  // A retry would double the step budget (~200s) and push the audit past Vercel's 300s limit.
  if (step === 'growth_agent') {
    delete (result as any)._retryable;
  }

  // Retry once on timeout or error — many modules fail intermittently
  if ((result.skipped || (result as any).error) && (result as any)._retryable) {
    const elapsed = Date.now() - t0;
    const remaining = (timeoutMs * 2) - elapsed; // allow up to 2x original timeout for retry
    if (remaining > 5000) {
      console.log(`[audit:${step}] RETRY after ${elapsed}ms — ${(result as any).reason || (result as any).error}`);
      const retryResult = await Promise.race([
        runStep(step, audit),
        new Promise<ModuleResult>((_, reject) =>
          setTimeout(() => reject(new Error(`${step} retry timed out`)), remaining),
        ),
      ]).catch((err: Error) => ({
        skipped: true,
        reason: `retry failed: ${err.message.slice(0, 80)}`,
      }));
      // Use retry result only if it succeeded
      if (!retryResult.skipped && !(retryResult as any).error) {
        result = retryResult;
        console.log(`[audit:${step}] RETRY SUCCESS after ${Date.now() - t0}ms`);
      }
    }
  }
  delete (result as any)._retryable;

  const ms = Date.now() - t0;
  const status = result.skipped ? 'SKIP' : (result as any).error ? 'ERR' : 'OK';
  const detail = (result as any)._log || (result as any).reason || (result as any).error || '';
  console.log(`[audit:${step}] ${status} ${ms}ms${detail ? ' | ' + detail.slice(0, 120) : ''}`);

  return { ...result, _t: ms };
}

/** Core step dispatcher — same logic as before, now called by timeout wrapper */
async function runStep(step: AuditStep, audit: AuditPageData): Promise<ModuleResult> {
  const { results } = audit;
  // Prefer the post-redirect canonical URL when crawl detected a cross-domain
  // redirect (e.g. hercesa.es → hercesa.com). Without this, downstream modules
  // query DataForSEO against the original domain and come back empty because
  // the real content lives under the canonical host. The crawl step itself
  // must use the original URL — we only swap for later steps.
  const url = step === 'crawl'
    ? audit.url
    : ((results.crawl as any)?.finalUrl || audit.url);

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
      return runGEO(url, sector, results.crawl || {}, comps, audit.geoSamples ?? 1);
    }

    case 'competitor_pagespeed': {
      const comps: Array<{ name: string; url: string }> =
        (results.competitors as any)?.competitors || [];
      return runCompetitorPageSpeed(comps);
    }

    case 'gbp':
      return runGBP(url, results.crawl || {});

    case 'reputation':
      return runReputation(url, results.crawl || {}, results.gbp, (results.sector as any)?.sector);

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
      return runCompetitors(url, sector, results.crawl || {}, audit.userCompetitors, dfsOrganic, {
        businessType: (results.sector as any)?.businessType,
        instagramBio: (results.instagram as any)?.bio,
        gbpCategories: (results.gbp as any)?.categories,
        seoKeywordsTop10: (results.seo as any)?.keywordsTop10,
        seoTraffic: (results.seo as any)?.organicTraffic,
      });
    }

    case 'competitor_traffic': {
      const comps: Array<{ name: string; url: string }> =
        (results.competitors as any)?.competitors || [];
      const clientKw: number | undefined = (results.seo as any)?.keywordsTop10;
      return runCompetitorTraffic(comps, clientKw);
    }

    case 'keyword_gap': {
      const ctItems: Array<{ url: string; keywordsTop10?: number }> =
        (results.competitor_traffic as any)?.items || [];
      // Pick the competitor with most keywords in top 10 — the strongest SEO peer
      const compsByKw = [...ctItems].sort((a, b) => (b.keywordsTop10 || 0) - (a.keywordsTop10 || 0));
      const bestComp = compsByKw[0]?.url ||
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
      return runTechStack(url, results.crawl);

    case 'conversion':
      return runConversion(url, results.crawl || {});

    case 'score':
      return runScore(results, audit.clientOnboarding || null);

    case 'growth_agent': {
      // Unified analysis: Sonnet draft → structural validate → Opus QA → corrections.
      // Runs with minimal context (no client onboarding yet — audit is anonymous until
      // the client signs up and links it). first-run.ts copies the result verbatim to
      // snapshot.pipeline_output so the audit report and dashboard share the exact same
      // growth_analysis. Zero drift audit → dashboard.
      const hostname = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
      const analysis = await runGrowthAgent({
        clientName: hostname,
        domain: hostname,
        sector: (results.sector as any)?.sector,
        onboarding: null,
        pipelineOutput: results,
        priorSnapshot: null,
      });
      // Module result shape — return analysis directly so it lands in results.growth_agent.
      // Audit report reads from audit.results.growth_agent (which == GrowthAnalysis).
      return analysis as any;
    }

    case 'meta_ads': {
      const comps: Array<{ name: string; url: string }> =
        (results.competitors as any)?.competitors || [];
      return runMetaAds(url, results.crawl || {}, comps);
    }

    case 'google_shopping': {
      const businessType = (results.crawl as any)?.businessType;
      if (businessType !== 'ecommerce') return { skipped: true, reason: 'Not ecommerce' };
      const topKw: any[] = (results.seo as any)?.topKeywords || [];
      const comps: Array<{ name: string; url: string }> =
        (results.competitors as any)?.competitors || [];
      return runGoogleShopping(url, topKw, comps);
    }

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

/** A module result counts as "good — don't re-run" unless it's a transient failure we can retry */
function isModuleResultGood(result: ModuleResult | undefined): boolean {
  if (!result) return false;
  const reason = (result as any)?.reason || (result as any)?.error || '';
  const isTransient = ((result as any)?.skipped || (result as any)?.error) &&
    /timed out|timeout|aborted|econn|enotfound|network|fetch failed/i.test(reason);
  if (isTransient) return false;
  // Any other state (success, or a non-transient skip like "API key missing")
  // counts as final and shouldn't be re-run on a phase retry.
  return true;
}

/**
 * Run all steps in a phase in parallel (Promise.allSettled).
 * On a phase re-poll (cross-poll retry), skips modules that already have
 * good results from the previous attempt — we only re-run the ones that
 * failed transiently.
 */
export async function executePhase(
  phaseEntry: AuditStep,
  audit: AuditPageData,
): Promise<PhaseExecution> {
  const steps = PHASE_STEPS[phaseEntry];
  const nextStep = PHASE_NEXT_STEP[phaseEntry] ?? 'score';

  const settled = await Promise.allSettled(
    steps.map(async (step) => {
      const existing = audit.results[step];
      if (isModuleResultGood(existing)) {
        // Reuse the good result from the previous phase attempt
        return { moduleKey: step, result: existing };
      }
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

    // Crawl: follow redirects + trigger social prefetch
    if (step === 'crawl') {
      const crawlResult = result as CrawlResult;
      // If the domain redirected (e.g. legalitas.es → legalitas.com), update the URL
      // so all downstream modules analyze the correct domain
      if (crawlResult.finalUrl) {
        console.log(`[audit] Domain redirected: ${audit.url} → ${crawlResult.finalUrl} — updating for downstream modules`);
        audit.url = crawlResult.finalUrl;
      }
      triggerSocialPrefetch(audit.id, crawlResult);
    }

  } catch (err: any) {
    result = { error: err.message?.slice(0, 150) || 'Module failed unexpectedly' };
  }

  return { result, moduleKey: step, nextStep };
}
