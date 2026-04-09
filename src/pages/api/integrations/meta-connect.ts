import type { APIRoute } from 'astro';
import { getMetaAuthUrl, isMetaConfigured } from '../../../lib/integrations-meta';
export const prerender = false;

export const GET: APIRoute = async ({ request, redirect, cookies }) => {
  if (!isMetaConfigured()) return redirect('/dashboard/settings?error=meta_not_configured');
  const origin = new URL(request.url).origin;
  const clientId = cookies.get('aion_client_id')?.value || 'unknown';
  const state = Buffer.from(JSON.stringify({ clientId, ts: Date.now() })).toString('base64url');
  return redirect(getMetaAuthUrl(`${origin}/api/integrations/meta-callback`, state));
};
