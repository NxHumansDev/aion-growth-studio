/**
 * Editorial AI — monthly quota enforcement.
 *
 * Default quota (Signals tier):
 *   - 16 articles generated per calendar month
 *   - 8 articles approved (i.e. reaching status='published' or 'approved_salvaged')
 *     per calendar month
 *
 * Quota is checked at 2 points:
 *   - Before calling POST /api/editorial/articles/generate (counts generated)
 *   - Before flipping an article to 'published' from the UI (counts approved)
 *
 * Quota resets on the 1st of each month. We store one row per client+month.
 */

import { getSupabase } from '../db';
import type { EditorialQuota, ClientFeatures } from './types';

const DEFAULT_MAX_GENERATED = 16;
const DEFAULT_MAX_APPROVED = 8;

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: 'generated_limit_reached' | 'approved_limit_reached';
  current: { generated: number; approved: number };
  max: { generated: number; approved: number };
  remaining: { generated: number; approved: number };
  resets_on: string;  // first day of next month, ISO date
}

function firstOfCurrentMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function firstOfNextMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

async function resolveMaxForClient(clientId: string): Promise<{ max_generated: number; max_approved: number }> {
  const sb = getSupabase();
  const { data } = await sb.from('clients').select('features, tier').eq('id', clientId).single();
  const features = ((data?.features ?? {}) as ClientFeatures);
  const override = features.editorial_quota_override;
  return {
    max_generated: override?.max_generated ?? DEFAULT_MAX_GENERATED,
    max_approved: override?.max_approved ?? DEFAULT_MAX_APPROVED,
  };
}

/** Fetches or creates the quota row for the current month. */
async function ensureCurrentQuota(clientId: string): Promise<EditorialQuota> {
  const sb = getSupabase();
  const month = firstOfCurrentMonth();
  const { data: existing } = await sb
    .from('editorial_quota').select('*')
    .eq('client_id', clientId).eq('month', month).single();
  if (existing) return existing as EditorialQuota;

  const { max_generated, max_approved } = await resolveMaxForClient(clientId);
  const { data, error } = await sb.from('editorial_quota').insert({
    client_id: clientId, month, max_generated, max_approved,
    generated_count: 0, approved_count: 0,
  }).select().single();
  if (error) throw error;
  return data as EditorialQuota;
}

/** Build a QuotaCheckResult from a quota row. */
function toResult(q: EditorialQuota, blockReason?: QuotaCheckResult['reason']): QuotaCheckResult {
  return {
    allowed: !blockReason,
    reason: blockReason,
    current: { generated: q.generated_count, approved: q.approved_count },
    max: { generated: q.max_generated, max_approved: q.max_approved } as any,
    remaining: {
      generated: Math.max(0, q.max_generated - q.generated_count),
      approved: Math.max(0, q.max_approved - q.approved_count),
    },
    resets_on: firstOfNextMonth(),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────

/** Returns the current status without modifying anything. */
export async function getQuotaStatus(clientId: string): Promise<QuotaCheckResult> {
  const q = await ensureCurrentQuota(clientId);
  return toResult(q);
}

/**
 * Check whether the client can start a new generation.
 * Returns { allowed: false, reason: 'generated_limit_reached' } if quota full.
 */
export async function canGenerate(clientId: string): Promise<QuotaCheckResult> {
  const q = await ensureCurrentQuota(clientId);
  if (q.generated_count >= q.max_generated) return toResult(q, 'generated_limit_reached');
  return toResult(q);
}

/**
 * Check whether the client can mark an article as approved (published or
 * approved_salvaged). Returns allowed=false if monthly approved limit hit.
 */
export async function canApprove(clientId: string): Promise<QuotaCheckResult> {
  const q = await ensureCurrentQuota(clientId);
  if (q.approved_count >= q.max_approved) return toResult(q, 'approved_limit_reached');
  return toResult(q);
}

/**
 * Increment generated_count atomically. Returns the new quota row.
 * Call this immediately after creating an article record.
 */
export async function incrementGenerated(clientId: string): Promise<EditorialQuota> {
  await ensureCurrentQuota(clientId);
  const sb = getSupabase();
  const month = firstOfCurrentMonth();
  const { data, error } = await sb.rpc('increment_editorial_quota', {
    p_client_id: clientId, p_month: month, p_field: 'generated_count',
  });
  if (error) {
    // Fallback: update with CAS-style retry (not atomic but close enough at low concurrency)
    const { data: row } = await sb.from('editorial_quota').select('*')
      .eq('client_id', clientId).eq('month', month).single();
    if (!row) throw error;
    await sb.from('editorial_quota').update({
      generated_count: (row as EditorialQuota).generated_count + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', (row as EditorialQuota).id);
    return { ...(row as EditorialQuota), generated_count: (row as EditorialQuota).generated_count + 1 };
  }
  return data as EditorialQuota;
}

/** Increment approved_count. Call when an article becomes 'published' or 'approved_salvaged'. */
export async function incrementApproved(clientId: string): Promise<EditorialQuota> {
  await ensureCurrentQuota(clientId);
  const sb = getSupabase();
  const month = firstOfCurrentMonth();
  const { data, error } = await sb.rpc('increment_editorial_quota', {
    p_client_id: clientId, p_month: month, p_field: 'approved_count',
  });
  if (error) {
    const { data: row } = await sb.from('editorial_quota').select('*')
      .eq('client_id', clientId).eq('month', month).single();
    if (!row) throw error;
    await sb.from('editorial_quota').update({
      approved_count: (row as EditorialQuota).approved_count + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', (row as EditorialQuota).id);
    return { ...(row as EditorialQuota), approved_count: (row as EditorialQuota).approved_count + 1 };
  }
  return data as EditorialQuota;
}

/** Decrement generated_count (used if generation fails before writer starts). */
export async function decrementGenerated(clientId: string): Promise<void> {
  const sb = getSupabase();
  const month = firstOfCurrentMonth();
  const { data: row } = await sb.from('editorial_quota').select('*')
    .eq('client_id', clientId).eq('month', month).single();
  if (!row) return;
  const q = row as EditorialQuota;
  if (q.generated_count <= 0) return;
  await sb.from('editorial_quota').update({
    generated_count: q.generated_count - 1,
    updated_at: new Date().toISOString(),
  }).eq('id', q.id);
}
