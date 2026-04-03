export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/auth/magic-link
 * Sends a magic link email via Supabase Auth.
 * User clicks the link → lands on /api/auth/callback → redirected to dashboard.
 */
export const POST: APIRoute = async ({ request }) => {
  const url = import.meta.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = import.meta.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'Auth not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const email = body.email?.trim();

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(url, key);
    const origin = new URL(request.url).origin;

    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/api/auth/callback`,
      },
    });

    if (error) {
      console.error('[magic-link] Supabase error:', error.message);
      return new Response(JSON.stringify({ error: 'Failed to send magic link' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, message: 'Magic link sent' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[magic-link] Error:', err.message);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
