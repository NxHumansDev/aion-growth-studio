import { createClient } from '@supabase/supabase-js';
import type { AuditStatus, AuditStepOrDone, ModuleResult, AuditPageData } from './types';

function getSupabase() {
  const url = import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}

export async function createAuditPage(
  url: string,
  email: string,
  opts?: { instagram?: string; linkedin?: string; competitors?: string[] },
): Promise<string> {
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  const sb = getSupabase();

  const { data, error } = await sb.from('audits').insert({
    url,
    hostname,
    email,
    status: 'processing',
    current_step: 'crawl',
    user_instagram: opts?.instagram || null,
    user_linkedin: opts?.linkedin || null,
    user_competitors: opts?.competitors?.length ? opts.competitors : null,
  }).select('id').single();

  if (error || !data) throw new Error(`Failed to create audit: ${error?.message}`);
  return data.id;
}

export async function getAuditPage(auditId: string): Promise<AuditPageData> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from('audits')
    .select('*')
    .eq('id', auditId)
    .single();

  if (error || !data) throw new Error(`Audit not found: ${auditId}`);

  return {
    id: data.id,
    url: data.url,
    email: data.email,
    status: data.status as AuditStatus,
    currentStep: data.current_step as AuditStepOrDone,
    score: data.score ?? undefined,
    sector: data.sector ?? undefined,
    userInstagram: data.user_instagram ?? undefined,
    userLinkedin: data.user_linkedin ?? undefined,
    userCompetitors: data.user_competitors ?? undefined,
    results: (data.results as Record<string, ModuleResult>) || {},
  };
}

export async function saveModuleResult(
  auditId: string,
  moduleKey: string,
  moduleResult: ModuleResult,
  nextStep: AuditStepOrDone,
  extraProps?: { score?: number; sector?: string; url?: string },
): Promise<void> {
  const sb = getSupabase();

  // Read current results, merge, write back
  const { data: current } = await sb.from('audits').select('results').eq('id', auditId).single();
  const merged = { ...(current?.results || {}), [moduleKey]: moduleResult };

  const update: Record<string, any> = {
    results: merged,
    current_step: nextStep,
    updated_at: new Date().toISOString(),
  };

  if (nextStep === 'done') {
    update.status = 'completed';
    update.completed_at = new Date().toISOString();
  }
  if (extraProps?.score !== undefined) update.score = extraProps.score;
  if (extraProps?.sector) update.sector = extraProps.sector;
  if (extraProps?.url) update.url = extraProps.url;

  const { error } = await sb.from('audits').update(update).eq('id', auditId);
  if (error) console.error(`[supabase-storage] saveModuleResult failed:`, error.message);
}

export async function savePhaseResults(
  auditId: string,
  moduleResults: Array<{ moduleKey: string; result: ModuleResult }>,
  nextStep: AuditStepOrDone,
  extraProps?: { score?: number; sector?: string },
): Promise<void> {
  const sb = getSupabase();

  // Read current results, merge all phase modules, write back
  const { data: current } = await sb.from('audits').select('results').eq('id', auditId).single();
  const merged = { ...(current?.results || {}) };
  for (const { moduleKey, result } of moduleResults) {
    merged[moduleKey] = result;
  }

  const update: Record<string, any> = {
    results: merged,
    current_step: nextStep,
    updated_at: new Date().toISOString(),
  };

  if (nextStep === 'done') {
    update.status = 'completed';
    update.completed_at = new Date().toISOString();
  }
  if (extraProps?.score !== undefined) update.score = extraProps.score;
  if (extraProps?.sector) update.sector = extraProps.sector;

  const { error } = await sb.from('audits').update(update).eq('id', auditId);
  if (error) console.error(`[supabase-storage] savePhaseResults failed:`, error.message);
}

export async function markAuditError(auditId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('audits').update({
    status: 'error',
    updated_at: new Date().toISOString(),
  }).eq('id', auditId);
  if (error) console.error(`[supabase-storage] markAuditError failed:`, error.message);
}
