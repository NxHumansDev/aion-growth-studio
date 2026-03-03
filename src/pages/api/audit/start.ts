export const prerender = false;

import type { APIRoute } from 'astro';
import { createAuditPage } from '../../../lib/audit/notion';

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/$/, '');
  }
  return `https://${trimmed}`.replace(/\/$/, '');
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { email, url, name, company, instagramHandle, linkedinUrl, selectedCompetitors } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrl(url);
      new URL(normalizedUrl); // validate
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!import.meta.env.NOTION_AUDITS_DB_ID && !process.env.NOTION_AUDITS_DB_ID) {
      console.error('NOTION_AUDITS_DB_ID is not configured');
      return new Response(JSON.stringify({ error: 'Audit service not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const opts: { instagram?: string; linkedin?: string; competitors?: string[] } = {};
    if (instagramHandle && typeof instagramHandle === 'string') {
      opts.instagram = instagramHandle.replace(/^@/, '').trim();
    }
    if (linkedinUrl && typeof linkedinUrl === 'string') {
      opts.linkedin = linkedinUrl.trim();
    }
    if (Array.isArray(selectedCompetitors) && selectedCompetitors.length > 0) {
      opts.competitors = selectedCompetitors.slice(0, 5).filter((u: any) => typeof u === 'string');
    }

    const auditId = await createAuditPage(normalizedUrl, email.trim(), opts);

    return new Response(JSON.stringify({ audit_id: auditId, url: normalizedUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error starting audit:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
