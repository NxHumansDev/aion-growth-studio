/**
 * Meta (Instagram/Facebook) OAuth integration.
 * Requires META_APP_ID + META_APP_SECRET from Facebook Developers console.
 */

const META_APP_ID = import.meta.env?.META_APP_ID || process.env.META_APP_ID;
const META_APP_SECRET = import.meta.env?.META_APP_SECRET || process.env.META_APP_SECRET;

export const META_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
].join(',');

export function getMetaAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: META_APP_ID || '',
    redirect_uri: redirectUri,
    scope: META_SCOPES,
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${params}`;
}

export async function exchangeMetaCode(code: string, redirectUri: string): Promise<{
  access_token: string;
  token_type: string;
}> {
  const res = await fetch('https://graph.facebook.com/v19.0/oauth/access_token?' + new URLSearchParams({
    client_id: META_APP_ID || '',
    client_secret: META_APP_SECRET || '',
    redirect_uri: redirectUri,
    code,
  }));
  if (!res.ok) throw new Error(`Meta token exchange failed: ${await res.text()}`);
  return res.json();
}

/** Exchange short-lived token for long-lived (60 days) */
export async function getLongLivedToken(shortToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch('https://graph.facebook.com/v19.0/oauth/access_token?' + new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: META_APP_ID || '',
    client_secret: META_APP_SECRET || '',
    fb_exchange_token: shortToken,
  }));
  if (!res.ok) throw new Error('Meta long-lived token exchange failed');
  return res.json();
}

/** Get Instagram Business account linked to Facebook Page */
export async function getInstagramAccount(accessToken: string): Promise<{ id: string; username: string; name: string } | null> {
  // Get pages
  const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`);
  if (!pagesRes.ok) return null;
  const pages = await pagesRes.json();

  for (const page of pages.data || []) {
    const igRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`);
    if (!igRes.ok) continue;
    const igData = await igRes.json();
    const igId = igData.instagram_business_account?.id;
    if (!igId) continue;

    const profileRes = await fetch(`https://graph.facebook.com/v19.0/${igId}?fields=username,name&access_token=${accessToken}`);
    if (!profileRes.ok) continue;
    const profile = await profileRes.json();
    return { id: igId, username: profile.username, name: profile.name };
  }
  return null;
}

export function isMetaConfigured(): boolean {
  return !!(META_APP_ID && META_APP_SECRET);
}
