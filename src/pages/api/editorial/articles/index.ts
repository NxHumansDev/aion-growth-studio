export const prerender = false;

import type { APIRoute } from 'astro';
import { listArticles } from '../../../../lib/editorial/db';
import type { ArticleStatus } from '../../../../lib/editorial/types';

/** GET /api/editorial/articles — list articles for the current client with filters. */
export const GET: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  if (!client?.id) return json({ error: 'Authentication required' }, 401);

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 100));

  let statusFilter: ArticleStatus[] | undefined;
  if (statusParam && statusParam !== 'all') {
    statusFilter = statusParam.split(',').map(s => s.trim()) as ArticleStatus[];
  }

  const articles = await listArticles(client.id, { status: statusFilter, limit });
  // Trim payload — UI only needs summary fields
  const rows = articles.map(a => ({
    id: a.id,
    topic: a.topic,
    status: a.status,
    profile_id: a.profile_id,
    language: a.language,
    tracking_id: a.tracking_id,
    primary_keyword: a.primary_keyword,
    cost_usd: a.cost_usd,
    iteration_count: a.iteration_count,
    published_url: a.published_url,
    published_at: a.published_at,
    performance_summary: a.performance_summary,
    created_at: a.created_at,
    updated_at: a.updated_at,
    editor_verdict_summary: a.editor_verdict ? {
      status: a.editor_verdict.status,
      seo_score: a.editor_verdict.seo_score,
      geo_score: a.editor_verdict.geo_score,
    } : null,
  }));

  return json({ articles: rows });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
