/**
 * Fire-and-forget trigger for /api/growth-agent/qa.
 *
 * Called right after a snapshot has been saved with a Sonnet draft that
 * has qaPending=true. The QA endpoint runs in its own Vercel Function
 * invocation (300s budget), loads the draft, runs Opus QA, and writes
 * the corrected analysis back to the snapshot.
 *
 * Errors are swallowed intentionally — this is best-effort. If the QA
 * never fires or fails silently, the weekly Radar will regenerate
 * anyway. Monitoring/alerting for stale qaPending drafts would live in
 * the radar reliability card (#76).
 */

import { waitUntil } from '@vercel/functions';

const CRON_SECRET = import.meta.env?.CRON_SECRET || process.env.CRON_SECRET;
const STUDIO_API_KEY = import.meta.env?.STUDIO_API_KEY || process.env.STUDIO_API_KEY;
const PUBLIC_SITE_URL = import.meta.env?.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://aiongrowth.studio';

export interface FireQABackgroundArgs {
  clientId: string;
  snapshotId: string;
  /** Optional: base URL derived from the current request. When omitted we
   *  fall back to PUBLIC_SITE_URL. Passing the current request URL lets
   *  the fire-and-forget hit the same deployment (preview vs production). */
  baseUrl?: string;
}

export function fireQABackground({ clientId, snapshotId, baseUrl }: FireQABackgroundArgs): void {
  if (!clientId || !snapshotId) return;

  const target = baseUrl
    ? new URL('/api/growth-agent/qa', baseUrl).href
    : `${PUBLIC_SITE_URL.replace(/\/$/, '')}/api/growth-agent/qa`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CRON_SECRET) headers['Authorization'] = `Bearer ${CRON_SECRET}`;
  else if (STUDIO_API_KEY) headers['x-studio-api-key'] = STUDIO_API_KEY;
  else {
    console.warn('[fire-qa-background] No CRON_SECRET or STUDIO_API_KEY — QA will fail auth');
    return;
  }

  console.log(`[fire-qa-background] client=${clientId} snapshot=${snapshotId} → ${target}`);

  // waitUntil keeps the parent Function alive until the fetch actually
  // flushes. Without it, Vercel kills the process on Response return and
  // the QA request is lost before reaching /api/growth-agent/qa.
  waitUntil(
    fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientId, snapshotId }),
    }).catch(err => {
      console.warn(`[fire-qa-background] HTTP failed (QA won't run this time): ${(err as Error).message}`);
    }),
  );
}
