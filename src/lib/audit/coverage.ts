import type { ModuleResult } from './types';

/** Critical modules that must have data for a valid report */
const CRITICAL_MODULES = [
  'crawl', 'ssl', 'pagespeed', 'sector', 'seo',
  'conversion', 'techstack', 'geo',
  'competitors', 'competitor_traffic', 'keyword_gap',
  'score', 'insights',
] as const;

/** All modules that contribute data */
const ALL_MODULES = [
  'crawl', 'ssl', 'pagespeed', 'sector', 'seo', 'traffic',
  'content', 'content_cadence', 'conversion', 'techstack',
  'gbp', 'reputation', 'geo', 'instagram', 'linkedin',
  'meta_ads', 'competitors', 'competitor_traffic',
  'competitor_pagespeed', 'keyword_gap', 'score', 'insights',
] as const;

export interface CoverageResult {
  totalModules: number;
  successfulModules: number;
  coveragePct: number;
  criticalMissing: string[];
  allMissing: string[];
  meetsThreshold: boolean; // >= 90% coverage
}

/** Check if a module result has actual data (not skipped/error) */
function hasData(result: ModuleResult | undefined): boolean {
  if (!result) return false;
  if (result.skipped) return false;
  if (result.error && !result.queries && !result.bullets) return false;
  if ((result as any)._truncated) return false;
  return true;
}

/** Evaluate data coverage across all modules */
export function evaluateCoverage(results: Record<string, ModuleResult>): CoverageResult {
  let successful = 0;
  const allMissing: string[] = [];
  const criticalMissing: string[] = [];

  for (const mod of ALL_MODULES) {
    if (hasData(results[mod])) {
      successful++;
    } else {
      allMissing.push(mod);
    }
  }

  for (const mod of CRITICAL_MODULES) {
    if (!hasData(results[mod])) {
      criticalMissing.push(mod);
    }
  }

  const coveragePct = Math.round((successful / ALL_MODULES.length) * 100);

  return {
    totalModules: ALL_MODULES.length,
    successfulModules: successful,
    coveragePct,
    criticalMissing,
    allMissing,
    meetsThreshold: coveragePct >= 90 && criticalMissing.length === 0,
  };
}

/** Get list of modules that should be retried */
export function getRetryModules(results: Record<string, ModuleResult>): string[] {
  const retry: string[] = [];
  for (const mod of CRITICAL_MODULES) {
    if (!hasData(results[mod]) && mod !== 'crawl' && mod !== 'score' && mod !== 'insights') {
      retry.push(mod);
    }
  }
  return retry;
}
