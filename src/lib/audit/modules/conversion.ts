import axios from 'axios';
import * as cheerio from 'cheerio';
import type { ConversionResult, CrawlResult } from '../types';

const ANTHROPIC_API_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

// Match the crawl module's headers — some sites (SPAs, Shopify) serve empty
// HTML when Accept doesn't include text/html explicitly.
const CRAWL_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0; +https://aiongrowth.studio)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
};

// ─── Reusable signal detection (runs on any page) ───────────────────────

interface SignalSet {
  formCount: number;
  formFieldCount: number;
  hasContactForm: boolean;
  ctaCount: number;
  hasCTA: boolean;
  hasLeadMagnet: boolean;
  hasTestimonials: boolean;
  hasPricing: boolean;
  hasVideo: boolean;
  hasChatWidget: boolean;
  hasAddToCart: boolean;
  hasCart: boolean;
  hasCheckout: boolean;
  hasProductPrices: boolean;
  hasNewsletter: boolean;
  hasWishlist: boolean;
  hasProductFilters: boolean;
  productCount: number;
}

function detectSignals($: cheerio.CheerioAPI, html: string): SignalSet {
  const bodyText = $('body').text();

  // Lead-gen signals
  const formCount = $('form').length;
  const formFieldCount = $('form input:not([type=hidden]), form textarea, form select').length;
  const EMBED_FORM_RE = /hubspot|typeform|calendly|acuity|booksy|jotform|cognito|wufoo|formstack|gravity|wpforms|ninja-forms|contact-form-7|elementor.*form|mailchimp/i;
  const hasEmbeddedForm = $('iframe, script, div[data-form], div[data-src]').filter((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-form') || '';
    const cls = $(el).attr('class') || '';
    const id = $(el).attr('id') || '';
    return EMBED_FORM_RE.test(src) || EMBED_FORM_RE.test(cls) || EMBED_FORM_RE.test(id);
  }).length > 0 || EMBED_FORM_RE.test(html);
  const hasContactForm = formFieldCount >= 2 || hasEmbeddedForm;

  const CTA_RE = /contact|contac|demo|prueba|trial|compra|buy|register|registra|empieza|start|agenda|book|reserv|solicita|request|download|descarg|get.start|suscr|subscribe|habla|llama|cotiza|quote|pedir|enviar|send|submit|presupuesto|budget|apunt|join|unirse|contratar|hire|probar|comenzar|empezar|inscri|sign.up|log.?in|acceder|iniciar|ver.plan|see.plan|obtener|obtén|consult|agendar|schedule|apply|postul|particip/i;
  const CTA_SELECTOR = [
    'button',
    'input[type="submit"]',
    'input[type="button"]',
    '[role="button"]',
    'a.btn', 'a.button',
    '[class*="cta"]', '[class*="btn-"]', '[class*="btn_"]',
    '[class*="button"]', '[class*="action"]',
    '[class*="hero"] a', '[class*="header"] a',
  ].join(', ');
  const ctaFromButtons = $(CTA_SELECTOR).filter((_, el) => {
    const text = $(el).text().trim();
    const cls = $(el).attr('class') || '';
    const href = $(el).attr('href') || '';
    return CTA_RE.test(text) || CTA_RE.test(cls) || CTA_RE.test(href);
  });
  const ctaFromLinks = $('a[href]').filter((_, el) => {
    const text = $(el).text().trim();
    if (text.length < 2 || text.length > 60) return false;
    return CTA_RE.test(text);
  });
  const ctaSet = new Set<any>();
  ctaFromButtons.each((_, el) => ctaSet.add(el));
  ctaFromLinks.each((_, el) => ctaSet.add(el));
  const ctaCount = ctaSet.size;
  const hasCTA = ctaCount > 0;

  const LEAD_RE = /gratis|free|descarga|download|guía|guide|ebook|webinar|plantilla|template|checklist|recurso|resource|herramienta|tool|demo gratis|free trial/i;
  const hasLeadMagnet = LEAD_RE.test(bodyText);

  const hasSchemaReview = $('[itemtype*="Review"], [itemtype*="Testimonial"]').length > 0;
  const TESTIMONIAL_RE = /testimonio|testimonial|opini[oó]n|review|cliente|client|caso de [eé]xito|case study|lo que dicen|what our/i;
  const hasTestimonials = hasSchemaReview || TESTIMONIAL_RE.test(bodyText);

  const PRICING_RE = /precio|price|plan|tarifa|package|nuestros precios|our pricing/i;
  const hasPricing = PRICING_RE.test(bodyText) &&
    $('[class*="price"], [class*="pricing"], [class*="plan"], [class*="tarif"]').length > 0;

  const hasVideo = $('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="wistia"], iframe[src*="loom"]').length > 0;

  const hasChatWidget = $('[id*="chat"], [class*="chat-widget"], [class*="chat_widget"], [id*="crisp"], [id*="tidio"], [class*="intercom-"], [id*="drift"]').length > 0;

  // Commerce signals
  const CART_RE = /carrito|cart|cesta|basket|bag|bolsa|a[ñn]adir|add.to.cart|add.to.bag|comprar|buy.now|kaufen/i;
  const hasAddToCart = $(
    'button, a.btn, a.button, [class*="add-to-cart"], [class*="addtocart"], [class*="buy-button"]'
  ).filter((_, el) => CART_RE.test($(el).text()) || CART_RE.test($(el).attr('class') || '')).length > 0;

  const CART_PAGE_RE = /\/cart|\/carrito|\/cesta|\/basket|\/bag|\/checkout|\/pago|\/finalizar/i;
  const hasCart = hasAddToCart
    || $('a[href*="/cart"], a[href*="/carrito"], a[href*="/cesta"], a[href*="/basket"]').length > 0
    || CART_PAGE_RE.test(html);

  const CHECKOUT_RE = /\/checkout|\/pago|\/finalizar|\/tramitar|\/payment|\/order/i;
  const hasCheckout = $('a[href*="checkout"], a[href*="pago"], a[href*="finalizar"]').length > 0
    || CHECKOUT_RE.test(html);

  const PRODUCT_PRICE_RE = /(\d+[.,]\d{2}\s*€|€\s*\d+[.,]\d{2}|\$\s*\d+[.,]\d{2}|\d+[.,]\d{2}\s*\$)/;
  const priceElements = $('[class*="price"], [class*="precio"], [data-price], [itemprop="price"]');
  const hasProductPrices = priceElements.length >= 2 || (priceElements.length >= 1 && PRODUCT_PRICE_RE.test(bodyText));
  const productCount = $('[itemtype*="Product"], [class*="product-card"], [class*="product-item"], [class*="producto"]').length;

  const NEWSLETTER_RE = /newsletter|suscr[íi]bete|suscripci[oó]n|email.*ofertas|mantente.informad|te avisamos|no te pierdas|sign.up.*email|stay.updated/i;
  const hasNewsletter = NEWSLETTER_RE.test(bodyText)
    || $('[class*="newsletter"], [id*="newsletter"], [class*="subscribe"], [class*="popup-email"]').length > 0;

  const hasWishlist = $('[class*="wishlist"], [class*="favorit"], [class*="lista-deseos"], [aria-label*="wishlist"], [aria-label*="favorit"]').length > 0
    || /lista de deseos|wishlist|guardar favorit|add to wishlist/i.test(bodyText);

  const hasProductFilters = $('[class*="filter"], [class*="filtro"], [class*="facet"], [data-filter]').length >= 2
    || $('select[name*="sort"], select[name*="orden"]').length > 0;

  return {
    formCount, formFieldCount, hasContactForm,
    ctaCount, hasCTA, hasLeadMagnet, hasTestimonials,
    hasPricing, hasVideo, hasChatWidget,
    hasAddToCart, hasCart, hasCheckout, hasProductPrices,
    hasNewsletter, hasWishlist, hasProductFilters, productCount,
  };
}

// ─── Internal page discovery ────────────────────────────────────────────

const SHOP_PATH_RE = /\/(shop|tienda|productos?|products?|collections?|colecciones?|catalog[oe]?|categor[iy]a?|departamento|novedades|new-arrivals|sale|rebajas|outlet)\b/i;
const SKIP_PATH_RE = /\/(blog|contacto?|about|privacy|privacidad|legal|terms|terminos|cookies|faq|login|register|account|admin|wp-admin|feed|cart|checkout|pago|carrito)\b/i;
const NAV_LINK_TEXT_RE = /\b(tienda|shop|productos?|products?|comprar|catálogo|catalog|colección|collection|novedades|new|rebajas|sale|outlet|mujer|hombre|niñ[oa]|women|men)\b/i;

function findBestInternalPage($: cheerio.CheerioAPI, baseUrl: string): string | null {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return null; }
  const hostname = base.hostname;

  const candidates = new Map<string, number>(); // url → score

  // Collect all internal links
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href') || '';
    let resolved: URL;
    try { resolved = new URL(raw, baseUrl); } catch { return; }

    // Skip external, anchors, non-HTTP
    if (resolved.hostname !== hostname) return;
    if (resolved.pathname === '/' || resolved.pathname === base.pathname) return;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|xml|json)$/i.test(resolved.pathname)) return;

    const key = resolved.origin + resolved.pathname;
    let score = candidates.get(key) ?? 0;

    // Score by path pattern
    if (SHOP_PATH_RE.test(resolved.pathname)) score += 5;
    if (SKIP_PATH_RE.test(resolved.pathname)) score -= 5;

    // Score by link text / context
    const text = $(el).text().trim();
    if (NAV_LINK_TEXT_RE.test(text)) score += 3;

    // Bonus: link is inside <nav> or header (more likely to be a main category)
    if ($(el).closest('nav, header, [class*="nav"], [class*="menu"]').length > 0) score += 2;

    // Prefer shorter paths (category index > deep product page)
    const depth = resolved.pathname.split('/').filter(Boolean).length;
    if (depth <= 2) score += 1;
    if (depth >= 4) score -= 1;

    candidates.set(key, score);
  });

  if (candidates.size === 0) return null;

  // Pick highest scoring candidate above threshold
  let bestUrl = '';
  let bestScore = 1; // minimum threshold
  for (const [url, score] of candidates) {
    if (score > bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }

  return bestUrl || null;
}

// ─── Merge signals from homepage + internal page ────────────────────────

function mergeSignals(a: SignalSet, b: SignalSet | null): SignalSet {
  if (!b) return a;
  return {
    formCount: Math.max(a.formCount, b.formCount),
    formFieldCount: Math.max(a.formFieldCount, b.formFieldCount),
    hasContactForm: a.hasContactForm || b.hasContactForm,
    ctaCount: Math.max(a.ctaCount, b.ctaCount),
    hasCTA: a.hasCTA || b.hasCTA,
    hasLeadMagnet: a.hasLeadMagnet || b.hasLeadMagnet,
    hasTestimonials: a.hasTestimonials || b.hasTestimonials,
    hasPricing: a.hasPricing || b.hasPricing,
    hasVideo: a.hasVideo || b.hasVideo,
    hasChatWidget: a.hasChatWidget || b.hasChatWidget,
    hasAddToCart: a.hasAddToCart || b.hasAddToCart,
    hasCart: a.hasCart || b.hasCart,
    hasCheckout: a.hasCheckout || b.hasCheckout,
    hasProductPrices: a.hasProductPrices || b.hasProductPrices,
    hasNewsletter: a.hasNewsletter || b.hasNewsletter,
    hasWishlist: a.hasWishlist || b.hasWishlist,
    hasProductFilters: a.hasProductFilters || b.hasProductFilters,
    productCount: Math.max(a.productCount, b.productCount),
  };
}

// ─── Main entry point ───────────────────────────────────────────────────

export async function runConversion(url: string, crawlData: CrawlResult): Promise<ConversionResult> {
  // If the crawler was blocked, we cannot analyze the real page content.
  // Return "not measurable" instead of scoring an error page.
  if (crawlData.crawlerBlocked) {
    return {
      skipped: false, // not skipped — we ran but the data is unreliable
      crawlerBlocked: true,
      funnelScore: undefined,
      detectedModel: undefined,
      summary: `No medible — ${crawlData.crawlerBlockedReason || 'sitio bloqueado al crawler'}. Los datos de conversion requieren acceso al HTML real del sitio.`,
      strengths: [],
      weaknesses: ['Sitio bloqueado al crawler — pendiente de verificar una vez resuelto el bloqueo'],
    } as any;
  }

  try {
    const res = await axios.get(url, {
      timeout: 120_000,
      headers: CRAWL_HEADERS,
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });

    const html = String(res.data);
    const $ = cheerio.load(html);

    // ── Detect signals on homepage ──────────────────────────────
    const homepageSignals = detectSignals($, html);

    // ── Try to find and analyze an internal product/category page ──
    // Many ecommerce sites show a hero+categories homepage without product
    // cards or prices. The real signals live on /shop, /tienda, /products etc.
    let internalSignals: SignalSet | null = null;
    let internalUrl: string | null = null;
    const candidateUrl = findBestInternalPage($, url);

    if (candidateUrl) {
      try {
        const intRes = await axios.get(candidateUrl, {
          timeout: 30_000,
          headers: CRAWL_HEADERS,
          maxRedirects: 3,
          validateStatus: (s) => s < 500,
        });
        const intHtml = String(intRes.data);
        const $int = cheerio.load(intHtml);
        internalSignals = detectSignals($int, intHtml);
        internalUrl = candidateUrl;
        console.log(`[conversion] Internal page ${candidateUrl}: addToCart=${internalSignals.hasAddToCart} prices=${internalSignals.hasProductPrices} products=${internalSignals.productCount} filters=${internalSignals.hasProductFilters}`);
      } catch {
        console.log(`[conversion] Internal page fetch failed: ${candidateUrl}`);
      }
    } else {
      console.log('[conversion] No internal product/category page found');
    }

    // ── Merge homepage + internal page signals ──────────────────
    const merged = mergeSignals(homepageSignals, internalSignals);

    // ── Detect dominant conversion model ────────────────────────
    const commerceSignals = [merged.hasCart, merged.hasAddToCart, merged.hasCheckout, merged.hasProductPrices, merged.productCount >= 3].filter(Boolean).length;
    const leadGenSignals = [merged.hasContactForm, merged.hasLeadMagnet, merged.hasChatWidget].filter(Boolean).length;
    const detectedModel: 'ecommerce' | 'lead_gen' | 'hybrid' | 'informational' =
      commerceSignals >= 3 ? 'ecommerce'
        : leadGenSignals >= 2 && commerceSignals >= 2 ? 'hybrid'
        : leadGenSignals >= 1 ? 'lead_gen'
        : commerceSignals >= 1 ? 'hybrid'
        : 'informational';

    // Post-validation: resolve contradictions
    const validatedHasCTA = merged.hasCTA || merged.hasLeadMagnet || merged.hasContactForm || merged.hasAddToCart;
    const validatedCtaCount = validatedHasCTA && merged.ctaCount === 0 ? 1 : merged.ctaCount;

    const structural = {
      ...merged,
      ctaCount: validatedCtaCount,
      hasCTA: validatedHasCTA,
      detectedModel,
    };

    // ── Heuristic score — counts ALL signals regardless of model ──
    let funnelScore = 0;
    if (merged.hasContactForm) funnelScore += 15;
    if (merged.hasCTA) funnelScore += Math.min(15, merged.ctaCount * 5);
    if (merged.hasLeadMagnet) funnelScore += 12;
    if (merged.hasChatWidget) funnelScore += 5;
    if (merged.hasAddToCart) funnelScore += 15;
    if (merged.hasCart) funnelScore += 5;
    if (merged.hasCheckout) funnelScore += 10;
    if (merged.hasProductPrices) funnelScore += 8;
    if (merged.hasProductFilters) funnelScore += 5;
    if (merged.hasNewsletter) funnelScore += 5;
    if (merged.hasWishlist) funnelScore += 3;
    if (merged.hasTestimonials) funnelScore += 10;
    if (merged.hasPricing) funnelScore += 7;
    if (merged.hasVideo) funnelScore += 5;
    funnelScore = Math.min(100, funnelScore);

    // ── LLM qualitative analysis (Haiku) ────────────────────────
    if (ANTHROPIC_API_KEY) {
      const llm = await analyzeWithLLM(url, structural, crawlData, internalUrl);

      const FORM_RE = /formulario|form|lead magnet|captación|capture/i;
      let strengths = llm.strengths || [];
      let weaknesses = llm.weaknesses || [];

      if (!structural.hasContactForm && structural.formFieldCount === 0) {
        strengths = strengths.filter((s: string) => !FORM_RE.test(s));
      }
      if (structural.hasContactForm) {
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
  internalUrl: string | null,
): Promise<{ funnelScore?: number; summary?: string; strengths?: string[]; weaknesses?: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  try {
    const prompt = `Analiza la capacidad de conversión de este sitio web. Evalúa TODOS los elementos — tanto de captación de leads (formularios, CTAs) como de comercio electrónico (carrito, checkout, fichas de producto).

URL: ${url}
Título: ${crawl.title || '—'}
Descripción meta: ${crawl.description || '—'}
H1 principal: ${(crawl.h1s || []).join(', ') || '—'}
Modelo detectado: ${structural.detectedModel}
Páginas analizadas: Homepage${internalUrl ? ` + ${internalUrl}` : ' (solo homepage)'}

Señales de captación de leads:
- Formularios: ${structural.formCount} (${structural.formFieldCount} campos visibles)
- CTAs detectados: ${structural.ctaCount}
- Lead magnet: ${structural.hasLeadMagnet ? 'Sí' : 'No'}
- Chat en vivo: ${structural.hasChatWidget ? 'Sí' : 'No'}

Señales de comercio electrónico:
- Botón "Añadir al carrito": ${structural.hasAddToCart ? 'Sí' : 'No'}
- Carrito / cesta: ${structural.hasCart ? 'Sí' : 'No'}
- Checkout / pago: ${structural.hasCheckout ? 'Sí' : 'No'}
- Precios de producto visibles: ${structural.hasProductPrices ? 'Sí' : 'No'}
- Fichas de producto detectadas: ${structural.productCount}
- Filtros de producto: ${structural.hasProductFilters ? 'Sí' : 'No'}
- Lista de deseos / favoritos: ${structural.hasWishlist ? 'Sí' : 'No'}

Señales compartidas:
- Newsletter / suscripción email: ${structural.hasNewsletter ? 'Sí' : 'No'}
- Testimonios / prueba social: ${structural.hasTestimonials ? 'Sí' : 'No'}
- Precios visibles (servicios/planes): ${structural.hasPricing ? 'Sí' : 'No'}
- Vídeo: ${structural.hasVideo ? 'Sí' : 'No'}

IMPORTANTE: las señales anteriores se extraen del HTML estático (sin ejecutar JavaScript). Si el sitio usa frameworks JS (React, Vue, Angular, Next.js) o embeds de terceros (Calendly, HubSpot), es posible que CTAs y formularios existan pero NO se hayan detectado. NO marques "sin CTA" o "sin formulario" como debilidad si sospechas que el sitio es moderno y probablemente los tenga renderizados con JS. Sé conservador al señalar ausencias.

Responde SOLO con JSON válido (sin markdown, sin \`\`\`):
{
  "funnelScore": <0-100 madurez del funnel de conversión, sea de leads o de venta>,
  "summary": "<1-2 frases evaluando la capacidad de convertir visitas en leads o ventas, según lo que sea este negocio>",
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
