import type { APIRoute } from 'astro';
import { getLinkedInAuthUrl, isLinkedInConfigured } from '../../../lib/integrations-linkedin';
export const prerender = false;

export const GET: APIRoute = async ({ request, redirect, cookies }) => {
  if (!isLinkedInConfigured()) return redirect('/dashboard/settings?error=linkedin_not_configured');
  const origin = new URL(request.url).origin;
  const clientId = cookies.get('aion_client_id')?.value || 'unknown';
  const state = Buffer.from(JSON.stringify({ clientId, ts: Date.now() })).toString('base64url');
  return redirect(getLinkedInAuthUrl(`${origin}/api/integrations/linkedin-callback`, state));
};
