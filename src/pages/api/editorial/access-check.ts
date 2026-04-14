export const prerender = false;

import type { APIRoute } from 'astro';
import { checkEditorialAccess } from '../../../lib/editorial/gating';

/**
 * GET /api/editorial/access-check
 *
 * Returns the EditorialAccessCheck object for the current user + client.
 * The dashboard UI uses this to decide whether the "Generar automáticamente"
 * button is active, shows an upsell modal, or shows a quota-exceeded modal.
 */
export const GET: APIRoute = async ({ locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;
  if (!client?.id || !user?.id) {
    return json({ error: 'Authentication required' }, 401);
  }
  const role = user.clientRole ?? user.role;
  const access = await checkEditorialAccess(client.id, role);
  return json(access);
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
