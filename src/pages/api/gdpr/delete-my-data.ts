export const prerender = false;

import type { APIRoute } from 'astro';
import { purgeClientData } from '../../../lib/gdpr';

/**
 * DELETE /api/gdpr/delete-my-data
 *
 * GDPR "right to erasure" (Art. 17). Permanently deletes ALL data for the
 * authenticated client. Irreversible. Requires the client's domain as
 * confirmation in the request body: { confirmDomain: "kikogamez.com" }.
 *
 * After deletion, the client's session is invalidated (they can't access
 * the dashboard anymore because the clients row no longer exists).
 */
export const DELETE: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  if (!client?.id || !client?.domain) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const confirmDomain = body.confirmDomain?.trim()?.toLowerCase();

    if (!confirmDomain || confirmDomain !== client.domain.toLowerCase()) {
      return new Response(JSON.stringify({
        error: 'Confirmation required',
        message: `Para confirmar el borrado, envía { "confirmDomain": "${client.domain}" }. Esta acción es IRREVERSIBLE.`,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[gdpr] DELETE request for client ${client.id} (${client.domain}) — starting purge`);
    const result = await purgeClientData(client.id);

    if (result.success) {
      return new Response(JSON.stringify({
        ok: true,
        message: 'Todos tus datos han sido eliminados permanentemente. Tu cuenta ya no existe.',
        tablesCleared: result.tablesCleared,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({
        ok: false,
        message: 'La purga se completó parcialmente. Contacta con soporte para resolverlo.',
        tablesCleared: result.tablesCleared,
        errors: result.errors,
        clientDeleted: result.clientDeleted,
      }), { status: 207, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (err: any) {
    console.error('[gdpr] Delete error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
