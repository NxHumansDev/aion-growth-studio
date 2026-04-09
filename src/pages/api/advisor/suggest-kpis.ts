export const prerender = false;

import type { APIRoute } from 'astro';

const ANTHROPIC_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

const KPI_LIST = `KPIs disponibles (usa estas claves exactas):
- score: Score Global
- seo.keywordsTop10: Keywords Top 10
- seo.traffic: Tráfico Orgánico
- seo.domainRank: Domain Rank
- geo.mentionRate: Mention Rate IA
- web.mobile: PageSpeed Mobile
- web.desktop: PageSpeed Desktop
- conversion.score: Funnel Score
- reputation.score: Reputación`;

/**
 * POST /api/advisor/suggest-kpis
 * Given a task title+description, suggests 1-3 KPIs that should improve.
 * Uses Haiku for speed and cost (~$0.001 per call).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  if (!client?.id) {
    return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 });
  }

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ kpis: [] }), { headers: { 'Content-Type': 'application/json' } });
  }

  const { title, description } = await request.json();
  if (!title) {
    return new Response(JSON.stringify({ kpis: [] }), { headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Una empresa va a ejecutar esta acción de marketing digital:
Título: ${title}
${description ? `Descripción: ${description}` : ''}

${KPI_LIST}

¿Qué 1-3 KPIs deberían mejorar si esta acción se ejecuta bien? Responde SOLO con un JSON array:
[{"key":"seo.keywordsTop10","label":"Keywords Top 10","direction":"up"}]

Solo los KPIs más directamente afectados. JSON puro, sin explicación.`,
        }],
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ kpis: [] }), { headers: { 'Content-Type': 'application/json' } });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const kpis = JSON.parse(match[0]).filter((k: any) => k.key && k.label);
      return new Response(JSON.stringify({ kpis }), { headers: { 'Content-Type': 'application/json' } });
    }
  } catch { /* fall through */ }

  return new Response(JSON.stringify({ kpis: [] }), { headers: { 'Content-Type': 'application/json' } });
};
