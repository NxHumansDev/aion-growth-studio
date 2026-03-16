export const prerender = false;

import type { APIRoute } from 'astro';
import { Client } from '@notionhq/client';

const SITE = 'https://aiongrowth.studio';

export const GET: APIRoute = async ({ request }) => {
  // Simple auth — require the STUDIO_API_KEY header or dev mode
  const envKey = process.env.NOTION_TOKEN;
  if (!envKey) {
    return json({ error: 'NOTION_TOKEN not configured' }, 500);
  }

  const notion = new Client({ auth: envKey });
  const DATABASE_ID = process.env.NOTION_DATABASE_ID!;

  try {
    // Fetch all published posts
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: { property: 'Published', checkbox: { equals: true } },
    });

    const pages = response.results as any[];
    let updated = 0;
    let skipped = 0;

    for (const page of pages) {
      // Skip if URL already set
      const existingUrl = page.properties['URL']?.url;
      if (existingUrl) { skipped++; continue; }

      // Build slug
      const rawSlug =
        page.properties['Slug']?.rich_text?.map((t: any) => t.plain_text).join('') || '';
      const title =
        page.properties['Title']?.title?.map((t: any) => t.plain_text).join('') || '';
      const slug = rawSlug ? slugify(rawSlug) : slugify(title);
      const lang = page.properties['Lang']?.select?.name || 'es';

      if (!slug) { skipped++; continue; }

      const url = lang === 'en'
        ? `${SITE}/en/blog/${slug}`
        : `${SITE}/blog/${slug}`;

      await notion.pages.update({
        page_id: page.id,
        properties: { URL: { url } },
      });

      updated++;
    }

    return json({ ok: true, updated, skipped, total: pages.length });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
