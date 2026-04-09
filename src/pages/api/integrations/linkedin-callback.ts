import type { APIRoute } from 'astro';
import { exchangeLinkedInCode, getLinkedInOrganizations, isLinkedInConfigured } from '../../../lib/integrations-linkedin';
import { saveIntegration } from '../../../lib/integrations';
export const prerender = false;

export const GET: APIRoute = async ({ url, redirect }) => {
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!code || !isLinkedInConfigured()) return redirect('/dashboard/settings?error=linkedin_no_code');

  let clientId = 'unknown';
  try { clientId = JSON.parse(Buffer.from(stateParam || '', 'base64url').toString()).clientId; } catch {}

  const redirectUri = `${url.origin}/api/integrations/linkedin-callback`;

  try {
    const { access_token, expires_in } = await exchangeLinkedInCode(code, redirectUri);
    const orgs = await getLinkedInOrganizations(access_token);
    const selectedOrg = orgs.length === 1 ? orgs[0] : null;

    await saveIntegration({
      client_id: clientId,
      provider: 'linkedin',
      access_token,
      refresh_token: access_token,
      token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
      property_id: selectedOrg?.id,
      property_name: selectedOrg?.name,
      metadata: { organizations: orgs },
    });

    return redirect('/dashboard/settings?linkedin=connected');
  } catch (err) {
    console.error('[linkedin-callback]', (err as Error).message);
    return redirect(`/dashboard/settings?error=linkedin_failed`);
  }
};
