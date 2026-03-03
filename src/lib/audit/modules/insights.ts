import type { InsightsResult, ModuleResult } from '../types';

const API_KEY = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

export async function runInsights(
  url: string,
  results: Record<string, ModuleResult>,
): Promise<InsightsResult> {
  if (!API_KEY) {
    return { skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const summary = buildSummary(url, results);
  const prompt = buildPrompt(summary);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]);
    return {
      bullets: (parsed.bullets || []).slice(0, 6),
      initiatives: (parsed.initiatives || []).slice(0, 3),
    };
  } catch (err: any) {
    return {
      bullets: [],
      initiatives: [],
      error: err.message?.slice(0, 100),
    };
  }
}

function buildSummary(url: string, r: Record<string, ModuleResult>): string {
  const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  const score = r.score as any;
  const crawl = r.crawl as any;
  const ssl = r.ssl as any;
  const ps = r.pagespeed as any;
  const sector = r.sector as any;
  const content = r.content as any;
  const geo = r.geo as any;
  const ig = r.instagram as any;
  const li = r.linkedin as any;
  const gbp = r.gbp as any;
  const competitors = r.competitors as any;

  const lines: string[] = [
    `Dominio: ${domain}`,
    `Sector: ${sector?.sector || 'desconocido'}`,
    `Score global: ${score?.total ?? '?'}/100`,
    `Puntuación técnica: ${score?.breakdown?.technical ?? '?'}/100`,
    `Velocidad web (móvil): ${ps?.mobile?.performance ?? '?'}/100`,
    `SSL válido: ${ssl?.valid ? 'sí' : 'no'}`,
    `Schema.org: ${crawl?.hasSchemaMarkup ? 'sí' : 'no'}`,
    `Sitemap: ${crawl?.hasSitemap ? 'sí' : 'no'}`,
    `Canonical: ${crawl?.hasCanonical ? 'sí' : 'no'}`,
    `Palabras en la web: ${crawl?.wordCount ?? '?'}`,
    `Claridad del contenido: ${content?.clarity ?? '?'}/100`,
    `Propuesta de valor: ${content?.valueProposition || 'no detectada'}`,
    `Visibilidad en IA (GEO): ${geo?.overallScore ?? '?'}/100`,
    `Instagram: ${ig?.found ? `@${ig.handle} · ${ig.followers ?? '?'} seguidores · engagement ${ig.engagementRate ?? '?'}%` : 'no encontrado'}`,
    `LinkedIn: ${li?.found ? `${li.followers ?? '?'} seguidores · ${li.employees ?? '?'} empleados` : 'no encontrado'}`,
    `Google Business Profile: ${gbp?.found ? `encontrado · ${gbp.rating ?? '?'}⭐ (${gbp.reviewCount ?? 0} reseñas)` : 'no encontrado'}`,
    `Competidores detectados: ${(competitors?.competitors || []).length}`,
  ];

  return lines.join('\n');
}

function buildPrompt(summary: string): string {
  return `Eres un consultor senior de marketing digital y negocios digitales con 15 años de experiencia ayudando a empresas a crecer online. Acabas de realizar un audit de presencia digital automático con los siguientes datos:

${summary}

Genera un diagnóstico ejecutivo para el propietario del negocio. Tu objetivo es:
1. Ser honesto pero constructivo — decirles dónde están SIN hundir el ánimo
2. Destacar la OPORTUNIDAD real que tienen si mejoran su presencia digital
3. Usar lenguaje de negocio claro, NO términos técnicos (nada de "canonical tags", "LCP", "schema markup" — di en cambio "tu web no está bien configurada para los buscadores", "tu web tarda demasiado en cargar en móvil", etc.)
4. Ser específico y relevante para su sector
5. Transmitir que hay mucho por ganar y que el momento de actuar es ahora

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin explicaciones fuera del JSON):
{
  "bullets": [
    "Bullet 1 — estado actual de un aspecto clave (1-2 frases, tono directo pero constructivo)",
    "Bullet 2",
    "Bullet 3",
    "Bullet 4",
    "Bullet 5",
    "Bullet 6"
  ],
  "initiatives": [
    {
      "title": "Título corto y motivador de la iniciativa (max 6 palabras)",
      "description": "2-3 frases explicando qué harías, por qué importa para su negocio específico y qué resultado concreto pueden esperar. Tono de experto que ve la oportunidad claramente."
    },
    {
      "title": "...",
      "description": "..."
    },
    {
      "title": "...",
      "description": "..."
    }
  ]
}`;
}
