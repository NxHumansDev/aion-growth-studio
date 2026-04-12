export const prerender = false;

import type { APIRoute } from 'astro';
import { getDataSummary } from '../../../lib/gdpr';

/**
 * GET /api/gdpr/data-summary
 *
 * Returns a count of records we hold for the authenticated client, per table.
 * Used in the "Mis datos" panel for transparency.
 */
export const GET: APIRoute = async ({ locals }) => {
  const client = (locals as any).client;
  if (!client?.id) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const summary = await getDataSummary(client.id);
    return new Response(JSON.stringify({ clientId: client.id, domain: client.domain, ...summary }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
