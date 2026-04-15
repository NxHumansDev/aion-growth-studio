export const prerender = false;

import type { APIRoute } from 'astro';
import { resolveBusinessKpis } from '../../../../lib/business-impact/resolver';
import { KPI_DEFINITIONS } from '../../../../lib/business-impact/definitions';
import { getKpisForProfile } from '../../../../lib/business-impact/definitions';

/**
 * GET /api/dashboard/business-impact/resolve
 *
 * Returns the 4 resolved KPIs for the current client + the full catalog of
 * KPIs the user could swap to (filtered by applicable profile + availability).
 * Used by the Business Impact card at the top of the dashboard.
 */
export const GET: APIRoute = async ({ locals }) => {
  const client = (locals as any).client;
  if (!client?.id) return json({ error: 'Authentication required' }, 401);

  const resolved = await resolveBusinessKpis(client.id);

  // Catalog of KPIs available to this profile (for the customization modal)
  const catalog = getKpisForProfile(resolved.profile).map(def => ({
    key: def.key,
    label: def.label,
    short_label: def.short_label,
    unit: def.unit,
    source: def.source,
    description: def.description,
    better: def.better,
    requires_ga4: def.requires_ga4 ?? false,
    requires_gsc: def.requires_gsc ?? false,
    requires_gbp: def.requires_gbp ?? false,
    requires_deal_value: def.requires_deal_value ?? false,
    requires_ad_spend: def.requires_ad_spend ?? false,
    available: isAvailable(def, resolved.availability),
  }));

  return json({
    kpis: resolved.kpis,
    profile: resolved.profile,
    availability: resolved.availability,
    catalog,
  });
};

function isAvailable(def: any, av: any): boolean {
  if (def.requires_ga4 && !av.has_ga4) return false;
  if (def.requires_gsc && !av.has_gsc) return false;
  if (def.requires_gbp && !av.has_gbp) return false;
  if (def.requires_deal_value && !av.has_deal_value) return false;
  if (def.requires_ad_spend && !av.has_ad_spend) return false;
  return true;
}

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
