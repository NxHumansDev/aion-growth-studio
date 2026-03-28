import { createClient } from '@supabase/supabase-js';
import { evaluateCoverage } from './coverage';

const SUPABASE_URL = import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;

/**
 * Log a completed audit run to the audit_runs table in Supabase.
 * Non-blocking — errors are caught and logged but don't affect the audit.
 */
export async function logAuditRun(
  domain: string,
  auditId: string,
  results: Record<string, any>,
  startTime: number,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  try {
    const coverage = evaluateCoverage(results);
    const duration = Date.now() - startTime;
    const score = results.score?.total ?? null;

    // Classify each module
    const modulesOk: string[] = [];
    const modulesFail: string[] = [];
    for (const [key, val] of Object.entries(results)) {
      if (key.startsWith('_')) continue;
      if (!val || (val as any).skipped || (val as any)._truncated || (val as any).error) {
        modulesFail.push(key);
      } else {
        modulesOk.push(key);
      }
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    await sb.from('audit_runs').insert({
      domain,
      audit_id: auditId,
      duration_ms: duration,
      coverage_pct: coverage.coveragePct,
      coverage_detail: {
        total: coverage.totalPoints,
        ok: coverage.successfulPoints,
        criticalOk: coverage.criticalOk,
        criticalTotal: coverage.criticalTotal,
        missing: coverage.allMissing,
        criticalMissing: coverage.criticalMissing,
      },
      modules_ok: modulesOk,
      modules_fail: modulesFail,
      critical_missing: coverage.criticalMissing,
      score,
    });

    console.log(`[audit-logger] Saved to Supabase: ${domain} | ${coverage.coveragePct}% | ${duration}ms | score ${score}`);
  } catch (err: any) {
    console.error(`[audit-logger] Failed to save: ${err.message?.slice(0, 100)}`);
  }
}
