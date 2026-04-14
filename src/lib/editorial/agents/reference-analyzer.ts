/**
 * Editorial AI — reference analyzer (Haiku 4.5).
 *
 * Fetches a URL, extracts the article text, and analyzes its style.
 * Returns the data needed to populate an editorial_reference_media row:
 *   - why_reference (1-2 sentences explaining the stylistic value)
 *   - notes (concrete patterns worth emulating)
 *
 * Best-effort: if the URL is unreachable or the text is too short,
 * returns an error with fallback suggestion.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { logGeneration } from '../db';
import type { EditorialLanguage } from '../types';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5';

export interface ReferenceAnalysisResult {
  name: string;             // proposed name (domain or extracted site title)
  url: string;
  why_reference: string;
  notes: string;
  detected_language?: EditorialLanguage;
}

async function fetchArticleText(url: string): Promise<{ text: string; title?: string }> {
  const res = await axios.get(url, {
    timeout: 15_000,
    maxRedirects: 5,
    validateStatus: s => s < 500,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AIONEditorialBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);

  const html = String(res.data);
  const $ = cheerio.load(html);

  // Remove clearly non-article elements
  $('script, style, nav, header, footer, aside, form, noscript, iframe').remove();

  // Prefer <article> or main content containers
  const article = $('article, [role="main"], main').first();
  const container = article.length > 0 ? article : $('body');

  // Flatten paragraphs and headings
  const parts: string[] = [];
  container.find('h1, h2, h3, p, li').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 30) parts.push(text);
  });

  const fullText = parts.join('\n\n').slice(0, 6000);
  const title = $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    new URL(url).hostname;

  return { text: fullText, title };
}

const SYSTEM = `Eres un analista de estilo editorial. Tu trabajo es leer un artículo de referencia y explicar QUÉ lo hace un buen modelo a imitar estilísticamente (no su tema, sino su voz y estructura).

Output JSON con campos:
- why_reference: 1-2 frases concretas explicando el valor estilístico del medio/autor (ejemplo: "Análisis económico con opinión fundamentada. Frases declarativas cortas. Cita fuentes en paréntesis al final de cada párrafo.")
- notes: 4-8 patrones estilísticos concretos que un redactor imitaría (cada uno en una frase corta accionable)
- detected_language: "es" o "en"
- name: nombre del medio/autor (extrae del título o del dominio)

Reglas:
- NO comentes sobre el tema del artículo — solo sobre cómo está escrito
- NO uses adjetivos vagos ("claro", "profesional"). Sé concreto ("frases <15 palabras", "abre con cita de fuente")
- Si el texto es muy corto o no parece un artículo, incluye esa advertencia en why_reference

JSON sin markdown, sin comentarios alrededor.`;

export async function analyzeReference(url: string): Promise<{
  success: boolean;
  result?: ReferenceAnalysisResult;
  error?: string;
  cost_usd: number;
  latency_ms: number;
}> {
  const t0 = Date.now();

  if (!ANTHROPIC_API_KEY) {
    return { success: false, error: 'Missing ANTHROPIC_API_KEY', cost_usd: 0, latency_ms: 0 };
  }

  // Normalize URL
  let normalizedUrl: string;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    normalizedUrl = u.toString();
  } catch {
    return { success: false, error: 'Invalid URL', cost_usd: 0, latency_ms: 0 };
  }

  // Fetch article text
  let fetched: { text: string; title?: string };
  try {
    fetched = await fetchArticleText(normalizedUrl);
  } catch (err: any) {
    return {
      success: false,
      error: `Could not fetch article: ${err?.message ?? 'unknown'}`,
      cost_usd: 0, latency_ms: Date.now() - t0,
    };
  }

  if (fetched.text.length < 200) {
    return {
      success: false,
      error: `Article text too short (${fetched.text.length} chars) — URL might be a homepage or paywall`,
      cost_usd: 0, latency_ms: Date.now() - t0,
    };
  }

  // Haiku analysis
  const userBlock = `URL: ${normalizedUrl}
Título detectado: ${fetched.title ?? 'desconocido'}

### Artículo

${fetched.text}

Analiza el estilo y devuelve el JSON.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: userBlock }],
      }),
    });

    const latency_ms = Date.now() - t0;
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Anthropic ${res.status}: ${errText.slice(0, 300)}`, cost_usd: 0, latency_ms };
    }

    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');

    const cost_usd = (data.usage?.input_tokens ?? 0) * 1.0 / 1_000_000 +
                     (data.usage?.output_tokens ?? 0) * 5.0 / 1_000_000;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'No JSON in response', cost_usd, latency_ms };

    let parsed: ReferenceAnalysisResult;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e: any) {
      return { success: false, error: `JSON parse failed: ${e.message}`, cost_usd, latency_ms };
    }

    parsed.url = normalizedUrl;
    parsed.name ??= fetched.title ?? new URL(normalizedUrl).hostname;

    logGeneration({
      agent: 'reference_analyzer', model: MODEL,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      cost_usd, latency_ms, success: true,
    }).catch(() => {});

    return { success: true, result: parsed, cost_usd, latency_ms };
  } catch (err: any) {
    return {
      success: false,
      error: err?.name === 'AbortError' ? 'Reference analysis timed out' : String(err?.message ?? err),
      cost_usd: 0, latency_ms: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}
