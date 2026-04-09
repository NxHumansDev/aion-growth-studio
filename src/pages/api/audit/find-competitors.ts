export const prerender = false;

import type { APIRoute } from 'astro';
import axios from 'axios';
import * as cheerio from 'cheerio';

const API_KEY = import.meta.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return json({ error: 'URL required' }, 400);
    }

    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    const domain = new URL(normalizedUrl).hostname.replace(/^www\./, '');

    // Quick page fetch
    let title = '', description = '', h1 = '', bodyText = '';
    try {
      const res = await axios.get(normalizedUrl, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)', Accept: 'text/html' },
        validateStatus: (s) => s < 500,
      });
      const $ = cheerio.load(res.data as string);
      title = $('title').first().text().trim().slice(0, 120);
      description = $('meta[name="description"]').attr('content')?.trim().slice(0, 200) || '';
      h1 = $('h1').first().text().trim().slice(0, 120);
      bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 600);
    } catch {
      // Continue with domain only
    }

    if (!API_KEY) {
      return json({ competitors: [], sector: 'desconocido', businessScope: 'unknown' });
    }

    // Two parallel LLM queries with different angles:
    // A) Website analysis → sector + scope + competitors (structured output)
    // B) LLM general knowledge → competitors the AI already knows about this space
    const [resultA, resultB] = await Promise.allSettled([
      callClaude(API_KEY, promptWebsite(domain, title, description, h1, bodyText)),
      callClaude(API_KEY, promptKnowledge(domain, title, description)),
    ]);

    // Parse Query A (primary — provides sector + scope)
    let sector = 'desconocido';
    let businessScope = 'unknown';
    let location: string | null = null;
    let competitorsA: any[] = [];

    if (resultA.status === 'fulfilled') {
      try {
        const match = resultA.value.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          sector = parsed.sector || 'desconocido';
          businessScope = parsed.businessScope || 'unknown';
          location = parsed.location || null;
          competitorsA = (parsed.competitors || []).filter((c: any) => c.url && !c.url.includes(domain));
        }
      } catch {}
    }

    // Parse Query B (secondary — LLM general knowledge)
    let competitorsB: any[] = [];
    if (resultB.status === 'fulfilled') {
      try {
        const match = resultB.value.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          competitorsB = (parsed || []).filter((c: any) => c.url && !c.url.includes(domain));
        }
      } catch {}
    }

    // Merge: deduplicate by domain, prefer A entries, fill with B up to 8 candidates
    const seenDomains = new Set<string>([domain]);
    const candidates: any[] = [];

    for (const c of [...competitorsA, ...competitorsB]) {
      try {
        const d = new URL(c.url.startsWith('http') ? c.url : `https://${c.url}`)
          .hostname.replace(/^www\./, '');
        if (seenDomains.has(d)) continue;
        seenDomains.add(d);
        candidates.push({
          name: (c.name || d).slice(0, 80),
          url: (c.url.startsWith('http') ? c.url : `https://${c.url}`).slice(0, 120),
          why: (c.why || c.snippet || '').slice(0, 150),
        });
        if (candidates.length >= 8) break;
      } catch {}
    }

    // Validate: HEAD-check all candidates in parallel, filter out dead domains
    const validated = await Promise.all(
      candidates.map(async (c) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(c.url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
          });
          clearTimeout(timer);
          return (res.ok || res.status === 403 || res.status === 405) ? c : null;
        } catch {
          return null;
        }
      }),
    );
    const merged = validated.filter(Boolean).slice(0, 6);

    return json({ sector, businessScope, location, competitors: merged });
  } catch (err: any) {
    console.error('find-competitors error:', err.message);
    return json({ competitors: [], sector: 'desconocido', businessScope: 'unknown' });
  }
};

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || '';
}

function promptWebsite(domain: string, title: string, description: string, h1: string, body: string): string {
  return `Analiza esta empresa y devuelve sus competidores directos.

Dominio: ${domain}
Título web: ${title || 'N/A'}
Meta descripción: ${description || 'N/A'}
H1 principal: ${h1 || 'N/A'}
Contenido parcial: ${body || 'N/A'}

Determina:
1. El sector/industria de la empresa
2. Si es LOCAL (ciudad/región), NACIONAL (país) o GLOBAL/SAAS
3. El TAMAÑO aparente del negocio (freelance/autónomo, pyme, mediana, grande)
4. 4-5 competidores directos REALES con sus URLs

REGLAS CRÍTICAS DE TAMAÑO:
- Si parece una web PERSONAL o de FREELANCE → busca otros freelances o profesionales independientes del mismo nicho. NUNCA propongas consultoras grandes (Deloitte, McKinsey, Accenture, BCG) ni empresas de >500 empleados.
- Si parece una PYME → busca otras pymes del mismo sector y tamaño, no líderes del mercado.
- Si parece una EMPRESA GRANDE → entonces sí, compara con otras grandes del sector.
- Máximo 1 competidor "aspiracional" (algo más grande, no 100x más grande).

EJEMPLOS:
- Freelance consultor digital → CORRECTO: otros consultores independientes → INCORRECTO: Accenture, Deloitte
- Personal trainer → CORRECTO: otros entrenadores de su ciudad → INCORRECTO: McFit, Basic-Fit
- Pequeño SaaS → CORRECTO: otros SaaS pequeños del nicho → INCORRECTO: Salesforce, SAP

OTRAS REGLAS:
- Para negocios locales: competidores de la misma ciudad/región
- Para nacionales (España/Latinoamérica): competidores del mismo país
- Para SaaS/global: competidores internacionales del mismo espacio
- Solo empresas con web activa · No incluyas ${domain}

Responde ÚNICAMENTE con JSON válido:
{
  "sector": "nombre del sector en español",
  "businessScope": "local" | "national" | "global",
  "businessSize": "freelance" | "pyme" | "mediana" | "grande",
  "location": "ciudad/región si es local, null si no",
  "competitors": [
    {"name": "Nombre Empresa", "url": "https://...", "why": "Por qué es competidor directo de tamaño similar (1 frase)"}
  ]
}`;
}

function promptKnowledge(domain: string, title: string, description: string): string {
  return `Basándote en tu conocimiento interno, dame 5-6 competidores conocidos para esta empresa.

Empresa: ${domain}
${title ? `Nombre: ${title}` : ''}
${description ? `Descripción: ${description}` : ''}

Busca en tu conocimiento empresas que operan en el mismo espacio de mercado.

REGLAS CRÍTICAS:
- AJUSTA AL TAMAÑO: si parece un freelance o profesional independiente, sugiere otros freelances o profesionales similares. NO sugiereas multinacionales o grandes consultoras.
- Solo empresas reales con URLs verificables · No incluyas ${domain}
- Si no conoces competidores directos para algún nicho muy específico, usa los más cercanos del sector Y del mismo tamaño

Responde ÚNICAMENTE con JSON array (sin texto adicional):
[{"name": "Nombre", "url": "https://...", "why": "Por qué compite (1 frase)"}]`;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
