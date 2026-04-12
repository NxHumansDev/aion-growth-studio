export const prerender = false;

import type { APIRoute } from 'astro';
import { exportClientData } from '../../../lib/gdpr';

/**
 * GET /api/gdpr/export-my-data
 *
 * GDPR "right of access" (Art. 15) and "right to data portability" (Art. 20).
 * Returns ALL data AION holds for the authenticated client as a downloadable
 * JSON file. Excludes: OAuth tokens (security), internal UUIDs (not useful).
 *
 * Response: application/json with Content-Disposition: attachment.
 */
export const GET: APIRoute = async ({ locals }) => {
  const client = (locals as any).client;
  if (!client?.id) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await exportClientData(client.id);
    const filename = `aion-data-export-${client.domain}-${new Date().toISOString().slice(0, 10)}.json`;

    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error('[gdpr] Export error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
