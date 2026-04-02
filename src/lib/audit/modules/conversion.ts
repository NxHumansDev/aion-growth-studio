import axios from 'axios';
import * as cheerio from 'cheerio';
import type { ConversionResult, CrawlResult } from '../types';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

export async function runConversion(url: string, crawlData: CrawlResult): Promise<ConversionResult> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });

    const html = String(res.data);
    const $ = cheerio.load(html);
    const bodyText = $('body').text();

    // ── Forms ────────────────────────────────────────────────────
    const formCount = $('form').length;
    const formFieldCount = $('form input:not([type=hidden]), form textarea, form select').length;
    const hasContactForm = formFieldCount >= 2;

    // ── CTA buttons ──────────────────────────────────────────────
    const CTA_RE = /contact|contac|demo|prueba|trial|compra|buy|register|registra|empieza|agenda|book|reserv|solicita|request|download|descarg|get.start|suscr|subscribe|habla|llama|cotiza|quote/i;
    const ctaEls = $('button, a.btn, a.button, [class*="cta"], [class*="btn-"], [class*="button"]').filter((_, el) => {
      return CTA_RE.test($(el).text()) || CTA_RE.test($(el).attr('class') || '') || CTA_RE.test($(el).attr('href') || '');
    });
    const ctaCount = ctaEls.length;
    const hasCTA = ctaCount > 0;

    // ── Lead magnets ─────────────────────────────────────────────
    const LEAD_RE = /gratis|free|descarga|download|guía|guide|ebook|webinar|plantilla|template|checklist|recurso|resource|herramienta|tool|demo gratis|free trial/i;
    const hasLeadMagnet = LEAD_RE.test(bodyText);

    // ── Social proof / testimonials ──────────────────────────────
    const hasSchemaReview = $('[itemtype*="Review"], [itemtype*="Testimonial"]').length > 0;
    const TESTIMONIAL_RE = /testimonio|testimonial|opini[oó]n|review|cliente|client|caso de [eé]xito|case study|lo que dicen|what our/i;
    const hasTestimonials = hasSchemaReview || TESTIMONIAL_RE.test(bodyText);

    // ── Pricing ──────────────────────────────────────────────────
    const PRICING_RE = /precio|price|plan|tarifa|package|nuestros precios|our pricing/i;
    const hasPricing = PRICING_RE.test(bodyText) &&
      $('[class*="price"], [class*="pricing"], [class*="plan"], [class*="tarif"]').length > 0;

    // ── Video ────────────────────────────────────────────────────
    const hasVideo = $('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="wistia"], iframe[src*="loom"]').length > 0;

    // ── Chat widget ──────────────────────────────────────────────
    const hasChatWidget = $('[id*="chat"], [class*="chat-widget"], [class*="chat_widget"], [id*="crisp"], [id*="tidio"], [class*="intercom-"], [id*="drift"]').length > 0;

    // Post-validation: resolve contradictions
    // A lead magnet requires at least one CTA to access it
    const validatedHasCTA = hasCTA || hasLeadMagnet || hasContactForm;
    const validatedCtaCount = validatedHasCTA && ctaCount === 0 ? 1 : ctaCount;

    const structural = { formCount, formFieldCount, hasContactForm, ctaCount: validatedCtaCount, hasCTA: validatedHasCTA, hasLeadMagnet, hasTestimonials, hasPricing, hasVideo, hasChatWidget };

    // ── Heuristic score (no LLM needed) ─────────────────────────
    let funnelScore = 0;
    if (hasContactForm) funnelScore += 25;
    if (hasCTA) funnelScore += Math.min(20, ctaCount * 7);
    if (hasLeadMagnet) funnelScore += 20;
    if (hasTestimonials) funnelScore += 15;
    if (hasPricing) funnelScore += 10;
    if (hasVideo) funnelScore += 5;
    if (hasChatWidget) funnelScore += 5;
    funnelScore = Math.min(100, funnelScore);

    // ── LLM qualitative analysis (Haiku) ────────────────────────
    if (ANTHROPIC_API_KEY) {
      const llm = await analyzeWithLLM(url, structural, crawlData);

      // Post-validate LLM output: remove contradictions with structural data
      const FORM_RE = /formulario|form|lead magnet|captación|capture/i;
      let strengths = llm.strengths || [];
      let weaknesses = llm.weaknesses || [];

      if (!structural.hasContactForm && structural.formFieldCount === 0) {
        // No real form detected → remove form-related strengths, keep as weakness
        strengths = strengths.filter((s: string) => !FORM_RE.test(s));
      }
      if (structural.hasContactForm) {
        // Has form → remove "no form" from weaknesses
        weaknesses = weaknesses.filter((w: string) => !/sin formulario|no form|no tiene formulario/i.test(w));
      }

      return {
        ...structural,
        funnelScore: llm.funnelScore ?? funnelScore,
        summary: llm.summary,
        strengths,
        weaknesses,
      };
    }

    return { ...structural, funnelScore };
  } catch (err: any) {
    return { skipped: true, reason: err.message?.slice(0, 100) };
  }
}

async function analyzeWithLLM(
  url: string,
  structural: any,
  crawl: CrawlResult,
): Promise<{ funnelScore?: number; summary?: string; strengths?: string[]; weaknesses?: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const prompt = `Analiza la capacidad de conversión de este sitio web.

URL: ${url}
Título: ${crawl.title || '—'}
Descripción meta: ${crawl.description || '—'}
H1 principal: ${(crawl.h1s || []).join(', ') || '—'}

Elementos detectados automáticamente:
- Formularios: ${structural.formCount} (${structural.formFieldCount} campos visibles)
- CTAs detectados: ${structural.ctaCount}
- Lead magnet presente: ${structural.hasLeadMagnet ? 'Sí' : 'No'}
- Testimonios / prueba social: ${structural.hasTestimonials ? 'Sí' : 'No'}
- Precios visibles: ${structural.hasPricing ? 'Sí' : 'No'}
- Vídeo presente: ${structural.hasVideo ? 'Sí' : 'No'}
- Chat en vivo: ${structural.hasChatWidget ? 'Sí' : 'No'}

Responde SOLO con JSON válido (sin markdown, sin \`\`\`):
{
  "funnelScore": <número 0-100 que refleja la madurez del funnel de conversión>,
  "summary": "<1-2 frases evaluando la capacidad de convertir visitas en leads/clientes>",
  "strengths": ["fortaleza concreta 1", "fortaleza concreta 2"],
  "weaknesses": ["brecha o mejora prioritaria 1", "brecha o mejora prioritaria 2"]
}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return {};
    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
