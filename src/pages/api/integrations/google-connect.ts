import type { APIRoute } from 'astro';
import { getGoogleAuthUrl, isConfigured } from '../../../lib/integrations';

export const prerender = false;

/**
 * GET /api/integrations/google-connect
 * Starts Google OAuth flow for GA4/GSC. Redirects to Google consent screen.
 */
export const GET: APIRoute = async ({ request, redirect, locals }) => {
  if (!isConfigured()) {
    return redirect('/dashboard/settings?error=google_not_configured');
  }

  const client = (locals as any).client;
  if (!client?.id) {
    return redirect('/dashboard/settings?error=not_authenticated');
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/integrations/google-callback`;

  const state = Buffer.from(JSON.stringify({ clientId: client.id, ts: Date.now() })).toString('base64url');

  const authUrl = getGoogleAuthUrl(redirectUri, state);
  return redirect(authUrl);
};
