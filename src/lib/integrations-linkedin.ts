/**
 * LinkedIn OAuth integration.
 * Requires LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET from LinkedIn Developers.
 */

const LINKEDIN_CLIENT_ID = import.meta.env?.LINKEDIN_CLIENT_ID || process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = import.meta.env?.LINKEDIN_CLIENT_SECRET || process.env.LINKEDIN_CLIENT_SECRET;

export const LINKEDIN_SCOPES = 'r_organization_social rw_organization_admin r_basicprofile';

export function getLinkedInAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINKEDIN_CLIENT_ID || '',
    redirect_uri: redirectUri,
    scope: LINKEDIN_SCOPES,
    state,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export async function exchangeLinkedInCode(code: string, redirectUri: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: LINKEDIN_CLIENT_ID || '',
      client_secret: LINKEDIN_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${await res.text()}`);
  return res.json();
}

/** Get the user's administered organizations */
export async function getLinkedInOrganizations(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch('https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organizationalTarget~(localizedName)))', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.elements || []).map((el: any) => ({
    id: el.organizationalTarget?.split(':').pop() || '',
    name: el['organizationalTarget~']?.localizedName || '',
  })).filter((o: any) => o.id);
}

export function isLinkedInConfigured(): boolean {
  return !!(LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET);
}
