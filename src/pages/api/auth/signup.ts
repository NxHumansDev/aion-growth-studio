import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

/**
 * POST /api/auth/signup
 * Creates a Supabase auth user + client + client_users link.
 * Called from the public onboarding funnel after checkout.
 *
 * Body: { email, password, domain, plan? }
 * Returns: { ok, userId, clientId } or { error }
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const supabaseUrl = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = import.meta.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const anonKey = import.meta.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 500 });
  }

  try {
    const { email, password, domain, plan } = await request.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400 });
    }

    const sbAdmin = createClient(supabaseUrl, serviceKey);
    const sbAnon = createClient(supabaseUrl, anonKey);

    // 1. Create auth user
    const { data: userData, error: userError } = await sbAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { domain },
    });

    if (userError) {
      // User might already exist
      if (userError.message?.includes('already been registered')) {
        // Try to sign in instead
        const { data: signInData, error: signInError } = await sbAnon.auth.signInWithPassword({ email, password });
        if (signInError) {
          return new Response(JSON.stringify({ error: 'Este email ya existe y la contraseña no coincide.' }), { status: 400 });
        }
        // Set session cookies
        if (signInData.session) {
          cookies.set('sb-access-token', signInData.session.access_token, { path: '/', httpOnly: true, maxAge: 3600, sameSite: 'lax' });
          cookies.set('sb-refresh-token', signInData.session.refresh_token, { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 30, sameSite: 'lax' });
        }
        return new Response(JSON.stringify({ ok: true, userId: signInData.user?.id, existing: true }));
      }
      return new Response(JSON.stringify({ error: userError.message }), { status: 400 });
    }

    const userId = userData.user.id;

    // 2. Check if client exists for this domain, or create new
    const cleanDomain = (domain || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    let clientId: string;

    const { data: existingClient } = await sbAdmin
      .from('clients')
      .select('id')
      .eq('domain', cleanDomain)
      .limit(1)
      .single();

    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient, error: clientError } = await sbAdmin
        .from('clients')
        .insert({
          name: cleanDomain.split('.')[0].charAt(0).toUpperCase() + cleanDomain.split('.')[0].slice(1),
          domain: cleanDomain,
          tier: plan || 'señales',
          sector: '',
        })
        .select('id')
        .single();

      if (clientError || !newClient) {
        return new Response(JSON.stringify({ error: `Client creation failed: ${clientError?.message}` }), { status: 500 });
      }
      clientId = newClient.id;
    }

    // 3. Link user to client
    await sbAdmin.from('client_users').upsert({
      client_id: clientId,
      user_id: userId,
      role: 'admin',
      name: email.split('@')[0],
      email,
    }, { onConflict: 'user_id,client_id' });

    // 4. Sign in to get session tokens
    const { data: session, error: sessionError } = await sbAnon.auth.signInWithPassword({ email, password });
    if (session?.session) {
      cookies.set('sb-access-token', session.session.access_token, { path: '/', httpOnly: true, maxAge: 3600, sameSite: 'lax' });
      cookies.set('sb-refresh-token', session.session.refresh_token, { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 30, sameSite: 'lax' });
    }

    return new Response(JSON.stringify({ ok: true, userId, clientId }));

  } catch (err) {
    console.error('[signup] Error:', (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
};
