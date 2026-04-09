/**
 * Google Analytics / GSC integration layer.
 * Handles OAuth token management, property listing, and data fetching.
 */

import { IS_DEMO } from './db';

const GOOGLE_CLIENT_ID = import.meta.env?.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = import.meta.env?.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const SUPABASE_URL = import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Scopes for GA4 + GSC read access
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  // 'https://www.googleapis.com/auth/adwords.readonly', // Enable after activating Google Ads API in Cloud Console
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export interface Integration {
  id: string;
  client_id: string;
  provider: string;
  status: 'connected' | 'disconnected' | 'error';
  access_token?: string;
  refresh_token: string;
  token_expires_at?: string;
  property_id?: string;
  property_name?: string;
  account_email?: string;
  scopes?: string[];
  data_quality_score?: number;
  metadata?: Record<string, any>;
}

// ─── Supabase helpers ─────────────────────────────────────────────────────

function getServiceClient() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
}

export async function getIntegration(clientId: string, provider: string): Promise<Integration | null> {
  if (IS_DEMO) return null;
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('integrations')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', provider)
    .eq('status', 'connected')
    .single();
  if (error || !data) return null;
  return data as Integration;
}

export async function saveIntegration(integration: Partial<Integration> & { client_id: string; provider: string; refresh_token: string }): Promise<string> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('integrations')
    .upsert({
      ...integration,
      status: 'connected',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id,provider' })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to save integration: ${error.message}`);
  return data.id;
}

export async function disconnectIntegration(clientId: string, provider: string): Promise<void> {
  const sb = getServiceClient();
  await sb.from('integrations')
    .update({ status: 'disconnected', access_token: null, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('provider', provider);
}

export async function updateDataQualityScore(clientId: string, provider: string, score: number): Promise<void> {
  const sb = getServiceClient();
  await sb.from('integrations')
    .update({ data_quality_score: score, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('provider', provider);
}

// ─── Google OAuth ─────────────────────────────────────────────────────────

export function getGoogleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID || '',
      client_secret: GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID || '',
      client_secret: GOOGLE_CLIENT_SECRET || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Token refresh failed');
  return res.json();
}

/** Get a valid access token, refreshing if expired */
export async function getValidAccessToken(integration: Integration): Promise<string> {
  if (integration.access_token && integration.token_expires_at) {
    const expiresAt = new Date(integration.token_expires_at).getTime();
    if (Date.now() < expiresAt - 60_000) return integration.access_token; // 1min buffer
  }
  // Refresh
  const { access_token, expires_in } = await refreshAccessToken(integration.refresh_token);
  // Update in DB
  const sb = getServiceClient();
  await sb.from('integrations').update({
    access_token,
    token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', integration.id);
  return access_token;
}

// ─── Google APIs ──────────────────────────────────────────────────────────

export async function getGoogleUserEmail(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to get user info');
  const data = await res.json();
  return data.email;
}

export interface GA4Property {
  name: string;         // "properties/123456"
  displayName: string;  // "My Website"
  propertyType: string;
}

export async function listGA4Properties(accessToken: string): Promise<GA4Property[]> {
  // List all GA4 accounts, then properties
  const accountsRes = await fetch('https://analyticsadmin.googleapis.com/v1beta/accounts', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!accountsRes.ok) return [];
  const accountsData = await accountsRes.json();
  const accounts = accountsData.accounts || [];

  const properties: GA4Property[] = [];
  for (const account of accounts) {
    const propsRes = await fetch(
      `https://analyticsadmin.googleapis.com/v1beta/properties?filter=parent:${account.name}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!propsRes.ok) continue;
    const propsData = await propsRes.json();
    for (const p of propsData.properties || []) {
      properties.push({
        name: p.name,
        displayName: p.displayName,
        propertyType: p.propertyType || 'GA4',
      });
    }
  }
  return properties;
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' });
}

export function isConfigured(): boolean {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}
