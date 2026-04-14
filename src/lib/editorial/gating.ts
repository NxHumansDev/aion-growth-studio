/**
 * Editorial AI — access check for the "Generar automáticamente" CTA.
 *
 * Returns what the UI needs to decide:
 *   - Show the button enabled → redirect to /editorial/new with brief
 *   - Show the button disabled + upsell modal (Signals) → user has no feature flag
 *   - Show "contact an admin" modal → user is viewer but client has access
 *   - Show quota-exceeded modal → admin ran out for this month
 */

import { clientHasEditorial } from './db';
import { getQuotaStatus, type QuotaCheckResult } from './quota';

export type AccessDenialReason =
  | 'no_editorial_feature'
  | 'not_admin'
  | 'quota_generated_exceeded'
  | 'quota_approved_exceeded';

export interface EditorialAccessCheck {
  has_access: boolean;                  // client has feature flag
  is_admin: boolean;                    // user is admin for this client
  can_generate: boolean;                // admin + feature + quota ok
  can_approve: boolean;                 // admin + feature + approved quota ok
  denial_reason?: AccessDenialReason;
  quota: QuotaCheckResult | null;
  upsell_tier?: 'signals' | 'palancas';
}

/**
 * Compute access from a client + user. Safe to call from any server code.
 * Used by /api/editorial/access-check and by the dashboard UI when rendering
 * recommendation CTAs.
 */
export async function checkEditorialAccess(
  clientId: string,
  userRole: string | null | undefined,
): Promise<EditorialAccessCheck> {
  const hasFeature = await clientHasEditorial(clientId);
  const isAdmin = userRole === 'admin' || userRole === 'superuser';

  if (!hasFeature) {
    return {
      has_access: false,
      is_admin: isAdmin,
      can_generate: false,
      can_approve: false,
      denial_reason: 'no_editorial_feature',
      quota: null,
      upsell_tier: 'signals',
    };
  }

  if (!isAdmin) {
    return {
      has_access: true,
      is_admin: false,
      can_generate: false,
      can_approve: false,
      denial_reason: 'not_admin',
      quota: null,
    };
  }

  const quota = await getQuotaStatus(clientId);
  const generatedOk = quota.current.generated < quota.max.generated;
  const approvedOk = quota.current.approved < quota.max.approved;

  return {
    has_access: true,
    is_admin: true,
    can_generate: generatedOk,
    can_approve: approvedOk,
    denial_reason: !generatedOk ? 'quota_generated_exceeded'
                 : !approvedOk  ? 'quota_approved_exceeded'
                 : undefined,
    quota,
  };
}
