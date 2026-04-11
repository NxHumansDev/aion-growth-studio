import { executeStep, executePhase } from '../audit/runner';
import type { AuditPageData } from '../audit/types';

/** Run the full audit pipeline for a domain and return all step results. */
export async function runAuditForQA(domain: string): Promise<Record<string, any>> {
  const url = domain.startsWith('http') ? domain : `https://${domain}`;

  const audit: AuditPageData = {
    id: `qa-${Date.now()}`,
    url,
    email: 'qa@aiongrowth.studio',
    status: 'processing',
    currentStep: 'crawl',
    results: {},
  };

  console.log(`[QA] crawl → ${domain}`);
  const crawlExec = await executeStep('crawl', audit);
  audit.results.crawl = crawlExec.result;

  console.log(`[QA] phase-1 (ssl/seo/pagespeed/traffic/gbp/techstack)`);
  const phase1 = await executePhase('ssl', audit);
  for (const { moduleKey, result } of phase1.moduleResults) {
    audit.results[moduleKey] = result;
  }

  console.log(`[QA] phase-2 (sector/content/competitors/reputation/conversion)`);
  const phase2 = await executePhase('sector', audit);
  for (const { moduleKey, result } of phase2.moduleResults) {
    audit.results[moduleKey] = result;
  }

  console.log(`[QA] phase-3 (competitor_traffic/geo/keyword_gap/meta_ads)`);
  const phase3 = await executePhase('competitor_traffic', audit);
  for (const { moduleKey, result } of phase3.moduleResults) {
    audit.results[moduleKey] = result;
  }

  console.log(`[QA] synthesis (score/growth_agent)`);
  const scoreExec = await executeStep('score', audit);
  audit.results.score = scoreExec.result;

  // Growth Agent — unified analysis (replaces the old insights + qa steps).
  // Internally: Sonnet draft → structural validate → Opus QA → corrections.
  const growthExec = await executeStep('growth_agent', audit);
  audit.results.growth_agent = growthExec.result;

  // Log to Supabase
  const { logAuditRun } = await import('../audit/audit-logger');
  await logAuditRun(domain, audit.id, audit.results, Date.now()).catch(() => {});

  return audit.results;
}
