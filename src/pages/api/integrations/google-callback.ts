import type { APIRoute } from 'astro';
import {
  exchangeCodeForTokens, getGoogleUserEmail, listGA4Properties,
  saveIntegration, isConfigured,
} from '../../../lib/integrations';

export const prerender = false;

/**
 * GET /api/integrations/google-callback
 * OAuth callback from Google. Exchanges code for tokens,
 * lists GA4 properties, and saves the integration.
 */
export const GET: APIRoute = async ({ url, redirect, cookies, locals }) => {
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    console.error(`[google-callback] OAuth error: ${error}`);
    return redirect('/dashboard/settings?error=google_denied');
  }

  if (!code || !isConfigured()) {
    return redirect('/dashboard/settings?error=google_no_code');
  }

  // Parse state
  let clientId = 'unknown';
  try {
    const state = JSON.parse(Buffer.from(stateParam || '', 'base64url').toString());
    clientId = state.clientId;
  } catch {}

  // If we don't have clientId from state, try middleware locals
  if (clientId === 'unknown') {
    const client = (locals as any)?.client;
    if (client?.id) clientId = client.id;
  }

  const origin = url.origin;
  const redirectUri = `${origin}/api/integrations/google-callback`;

  try {
    // 1. Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    console.log(`[google-callback] Tokens received, scope: ${tokens.scope}`);

    // 2. Get user email
    const email = await getGoogleUserEmail(tokens.access_token);
    console.log(`[google-callback] Google account: ${email}`);

    // 3. List GA4 properties
    const properties = await listGA4Properties(tokens.access_token);
    console.log(`[google-callback] Found ${properties.length} GA4 properties`);

    // 4. Save integration
    // If only one property, auto-select it. Otherwise, redirect to selection.
    const selectedProperty = properties.length === 1 ? properties[0] : null;

    await saveIntegration({
      client_id: clientId,
      provider: 'google_analytics',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      account_email: email,
      scopes: tokens.scope.split(' '),
      property_id: selectedProperty?.name || undefined,
      property_name: selectedProperty?.displayName || undefined,
      metadata: {
        available_properties: properties.map(p => ({ name: p.name, displayName: p.displayName })),
      },
    });

    if (properties.length > 1) {
      // Multiple properties — user needs to select
      return redirect('/dashboard/settings?ga4=select_property');
    }

    return redirect('/dashboard/settings?ga4=connected');

  } catch (err) {
    console.error(`[google-callback] Error:`, (err as Error).message);
    return redirect(`/dashboard/settings?error=google_failed&detail=${encodeURIComponent((err as Error).message)}`);
  }
};
