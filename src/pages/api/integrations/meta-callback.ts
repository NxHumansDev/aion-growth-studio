import type { APIRoute } from 'astro';
import { exchangeMetaCode, getLongLivedToken, getInstagramAccount, isMetaConfigured } from '../../../lib/integrations-meta';
import { saveIntegration } from '../../../lib/integrations';
export const prerender = false;

export const GET: APIRoute = async ({ url, redirect }) => {
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!code || !isMetaConfigured()) return redirect('/dashboard/settings?error=meta_no_code');

  let clientId = 'unknown';
  try { clientId = JSON.parse(Buffer.from(stateParam || '', 'base64url').toString()).clientId; } catch {}

  const redirectUri = `${url.origin}/api/integrations/meta-callback`;

  try {
    const { access_token: shortToken } = await exchangeMetaCode(code, redirectUri);
    const { access_token, expires_in } = await getLongLivedToken(shortToken);
    const igAccount = await getInstagramAccount(access_token);

    await saveIntegration({
      client_id: clientId,
      provider: 'instagram',
      access_token,
      refresh_token: access_token, // Meta long-lived tokens don't have separate refresh
      token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
      account_email: igAccount?.username || '',
      property_id: igAccount?.id,
      property_name: igAccount ? `@${igAccount.username}` : undefined,
    });

    return redirect('/dashboard/settings?instagram=connected');
  } catch (err) {
    console.error('[meta-callback]', (err as Error).message);
    return redirect(`/dashboard/settings?error=meta_failed`);
  }
};
