export const prerender = false;

import type { APIRoute } from 'astro';
import { saveLead } from '../../lib/db';

/**
 * POST /api/diagnostic-leads
 * Saves a lead from the diagnostic page.
 * Now writes to Supabase instead of Notion.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { email, company, name, url } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await saveLead({
      email,
      url: url || '',
      name: name || undefined,
      company: company || undefined,
      status: 'new',
      source: 'diagnostic',
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error saving lead:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
