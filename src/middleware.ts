import { defineMiddleware } from 'astro:middleware';
import { createClient } from '@supabase/supabase-js';
import { IS_DEMO, getClient, getClientById, getUserRole } from './lib/db';
import { DEMO_CLIENT, type Tier } from './lib/demo-data';

const VALID_TIERS: Tier[] = ['radar', 'señales', 'palancas'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  const isDashboardRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/advisor') || pathname.startsWith('/api/advisor') || pathname.startsWith('/api/dashboard') || pathname.startsWith('/api/integrations');
  const isAdminRoute = pathname.startsWith('/admin');

  if (!isDashboardRoute && !isAdminRoute) return next();

  // Demo mode: no admin panel, no real users
  if (IS_DEMO) {
    if (isAdminRoute) return context.redirect('/dashboard');
    const tierCookie = context.cookies.get('aion_tier')?.value as Tier | undefined;
    const tier: Tier = VALID_TIERS.includes(tierCookie as Tier) ? tierCookie! : 'señales';
    context.locals.client = { ...DEMO_CLIENT, tier };
    return next();
  }

  // Real mode: validate session
  const url = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = import.meta.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return context.redirect('/es/diagnostico');

  const sb = createClient(url, anonKey);
  const accessToken = context.cookies.get('sb-access-token')?.value;
  const refreshToken = context.cookies.get('sb-refresh-token')?.value;

  if (!accessToken) return context.redirect('/login');

  let authUser: { id: string; email?: string } | null = null;

  const { data: { user }, error } = await sb.auth.getUser(accessToken);

  if (error || !user) {
    if (refreshToken) {
      const { data: refreshData, error: refreshError } = await sb.auth.refreshSession({ refresh_token: refreshToken });
      if (refreshError || !refreshData.session) return context.redirect('/login');
      context.cookies.set('sb-access-token', refreshData.session.access_token, { path: '/', httpOnly: true, maxAge: 3600 });
      context.cookies.set('sb-refresh-token', refreshData.session.refresh_token, { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
      authUser = refreshData.user!;
    } else {
      return context.redirect('/login');
    }
  } else {
    authUser = user;
  }

  const email = authUser.email ?? '';
  const SUPERUSER_EMAILS = (import.meta.env?.SUPERUSER_EMAILS || process.env.SUPERUSER_EMAILS || '').split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
  const isSuperuser = email.endsWith('@aiongrowth.studio') || SUPERUSER_EMAILS.includes(email.toLowerCase());

  // ── Admin routes ────────────────────────────────────────────────────────────
  if (isAdminRoute) {
    if (!isSuperuser) return context.redirect('/dashboard');
    context.locals.user = { id: authUser.id, email, role: 'superuser' };
    return next();
  }

  // ── Dashboard routes ─────────────────────────────────────────────────────────
  if (isSuperuser) {
    const activeClientId = context.cookies.get('aion_active_client')?.value;
    if (!activeClientId) return context.redirect('/admin');
    try {
      const client = await getClientById(activeClientId);
      context.locals.client = client;
      context.locals.user = { id: authUser.id, email, role: 'superuser' };
    } catch {
      context.cookies.delete('aion_active_client', { path: '/' });
      return context.redirect('/admin');
    }
    return next();
  }

  // Normal user
  try {
    const client = await getClient(authUser.id);
    const role = await getUserRole(authUser.id, client.id);
    context.locals.client = client;
    context.locals.user = { id: authUser.id, email, role };
  } catch {
    // No client found → self-service onboarding
    return context.redirect('/dashboard/onboarding?step=0');
  }

  return next();
});
