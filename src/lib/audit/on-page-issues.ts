// On-page SEO issues — shared helper used by both the dashboard SEO page
// (for rendering) and the Growth Agent (as input context, so the LLM can
// write contextual notes that reference the client's priority keywords).
//
// Each issue carries a stable `key` that the Growth Agent references in
// `growth_analysis.onPageAuditContext` for merging during render.
//
// Pure function: no side effects, no LLM. Rule-based evaluation of crawl
// data + PageSpeed + SSL from the audit pipeline.

export type IssueSeverity = 'critical' | 'warning' | 'good';

export interface OnPageIssue {
  key: string;                  // stable identifier used to match Growth Agent context
  severity: IssueSeverity;
  label: string;                // short title, rule-based
  detail: string;               // raw data point, rule-based (e.g., "69 caracteres")
  expanded: string;             // static expanded template (fallback when no LLM context)
}

interface CrawlLike {
  title?: string;
  description?: string;
  h1s?: string[];
  imageCount?: number;
  imagesWithAlt?: number;
  hasSchemaMarkup?: boolean;
  schemaTypes?: string[];
  hasSitemap?: boolean;
  hasCanonical?: boolean;
  wordCount?: number;
  internalLinks?: number;
}

interface SslLike {
  valid?: boolean;
  protocol?: string;
  daysUntilExpiry?: number;
}

interface PageSpeedLike {
  mobile?: { performance?: number; lcp?: number };
}

export function computeOnPageIssues(
  crawl: CrawlLike,
  ssl: SslLike,
  pagespeed: PageSpeedLike,
): OnPageIssue[] {
  const issues: OnPageIssue[] = [];

  // ─── Title ─────────────────────────────────────────────────────────────
  if (crawl.title) {
    const len = crawl.title.length;
    const titleText = crawl.title;
    if (len > 60) {
      issues.push({
        key: 'title_too_long',
        severity: 'warning',
        label: 'Title demasiado largo',
        detail: `${len} caracteres (recomendado: 50-60)`,
        expanded: `Tu título actual:\n"${titleText}"\n\nGoogle muestra máximo ~60 caracteres en los resultados. Los últimos ${len - 60} caracteres se cortarán. Pon las keywords principales al inicio y recorta a 50-60 chars.`,
      });
    } else if (len < 30) {
      issues.push({
        key: 'title_too_short',
        severity: 'warning',
        label: 'Title demasiado corto',
        detail: `${len} caracteres. Usa más espacio para keywords.`,
        expanded: `Tu título actual:\n"${titleText}"\n\nTienes ${60 - len} caracteres más disponibles. Incluye keywords relevantes y tu marca. El rango óptimo para Google es 50-60 caracteres.`,
      });
    } else {
      issues.push({
        key: 'title_ok',
        severity: 'good',
        label: 'Title correcto',
        detail: `${len} caracteres`,
        expanded: `Tu título actual:\n"${titleText}"\n\nLongitud óptima (50-60 chars). Google lo mostrará completo en los resultados.`,
      });
    }
  } else {
    issues.push({
      key: 'title_missing',
      severity: 'critical',
      label: 'Sin meta title',
      detail: 'Sin título definido — fundamental para SEO',
      expanded: `Tu web no tiene un <title> definido. Google generará uno automáticamente (y no será bueno).\n\nAñade en el <head>:\n<title>Tu keyword principal — Tu marca</title>\n\nLongitud óptima: 50-60 caracteres.`,
    });
  }

  // ─── Meta description ──────────────────────────────────────────────────
  if (crawl.description) {
    const len = crawl.description.length;
    const descText = crawl.description;
    if (len > 160) {
      issues.push({
        key: 'meta_desc_too_long',
        severity: 'warning',
        label: 'Meta description largo',
        detail: `${len} chars — Google lo cortará`,
        expanded: `Tu meta description actual (${len} chars):\n"${descText}"\n\nGoogle muestra máximo ~155-160 caracteres en escritorio y ~120 en móvil. Los últimos ${len - 155} caracteres se perderán.\n\nLongitud óptima: 120-155 caracteres. Incluye tu keyword principal y un CTA claro.`,
      });
    } else if (len < 70) {
      issues.push({
        key: 'meta_desc_too_short',
        severity: 'warning',
        label: 'Meta description corto',
        detail: `${len} chars — aprovecha más espacio`,
        expanded: `Tu meta description actual (${len} chars):\n"${descText}"\n\nTienes ${155 - len} caracteres más disponibles para convencer al usuario de hacer clic.\n\nLongitud óptima: 120-155 caracteres. Incluye keywords, propuesta de valor y un CTA.`,
      });
    } else {
      issues.push({
        key: 'meta_desc_ok',
        severity: 'good',
        label: 'Meta description ok',
        detail: `${len} chars`,
        expanded: `Tu meta description actual (${len} chars):\n"${descText}"\n\nLongitud dentro del rango óptimo (120-155 chars). Google lo mostrará completo.`,
      });
    }
  } else {
    issues.push({
      key: 'meta_desc_missing',
      severity: 'critical',
      label: 'Sin meta description',
      detail: 'Google generará una automática — menos clicks',
      expanded: `Tu web no tiene meta description. Google extraerá texto aleatorio de tu página — lo que reduce el CTR.\n\nAñade en el <head>:\n<meta name="description" content="Tu descripción aquí">\n\nLongitud óptima: 120-155 caracteres. En móvil Google corta a ~120 chars.`,
    });
  }

  // ─── H1 ────────────────────────────────────────────────────────────────
  const h1Count = crawl.h1s?.length ?? 0;
  if (h1Count === 0) {
    issues.push({
      key: 'h1_missing',
      severity: 'critical',
      label: 'Sin H1',
      detail: 'Sin encabezado principal',
      expanded: 'Tu página no tiene ningún <h1>. El H1 es el encabezado más importante para SEO — Google lo usa para entender de qué trata la página.\n\nAñade un único <h1> con tu keyword principal al inicio de tu contenido.',
    });
  } else if (h1Count > 1) {
    issues.push({
      key: 'h1_multiple',
      severity: 'warning',
      label: `${h1Count} H1s`,
      detail: 'Debería haber solo 1 H1',
      expanded: `Se encontraron ${h1Count} etiquetas H1:\n${(crawl.h1s || []).map((h, i) => `${i + 1}. "${h}"`).join('\n')}\n\nGoogle recomienda un solo H1 por página. Cambia los H1 extra a H2 o H3 según su jerarquía.`,
    });
  } else {
    issues.push({
      key: 'h1_ok',
      severity: 'good',
      label: 'H1 correcto',
      detail: `"${(crawl.h1s?.[0] || '').slice(0, 40)}"`,
      expanded: `Tu H1:\n"${crawl.h1s?.[0] || ''}"\n\nUn solo H1 bien definido. Asegúrate de que contenga tu keyword principal.`,
    });
  }

  // ─── Image alt text ────────────────────────────────────────────────────
  if ((crawl.imageCount ?? 0) > 0 && (crawl.imagesWithAlt ?? 0) < (crawl.imageCount ?? 0)) {
    const missing = (crawl.imageCount ?? 0) - (crawl.imagesWithAlt ?? 0);
    issues.push({
      key: 'images_missing_alt',
      severity: 'warning',
      label: `${missing} imágenes sin alt`,
      detail: 'Google no puede ver imágenes sin alt text',
      expanded: `${crawl.imageCount} imágenes en total, ${crawl.imagesWithAlt} con alt text, ${missing} sin él.\n\nEl atributo alt ayuda a Google a indexar las imágenes y mejora la accesibilidad. Describe lo que muestra cada imagen de forma breve y natural, incluyendo keywords cuando tenga sentido.`,
    });
  } else if ((crawl.imageCount ?? 0) > 0) {
    issues.push({
      key: 'images_all_alt',
      severity: 'good',
      label: 'Imágenes con alt text',
      detail: 'Todas las imágenes tienen texto alternativo',
      expanded: `${crawl.imageCount} imágenes encontradas, todas con alt text. Google puede indexarlas y aparecer en Google Images.`,
    });
  }

  // ─── SSL ───────────────────────────────────────────────────────────────
  if (ssl.valid) {
    issues.push({
      key: 'ssl_valid',
      severity: 'good',
      label: 'SSL activo',
      detail: `${ssl.protocol || 'TLS'} — expira en ${ssl.daysUntilExpiry ?? '?'} días`,
      expanded: `Certificado SSL válido.\nProtocolo: ${ssl.protocol || 'TLS'}\nExpira en: ${ssl.daysUntilExpiry ?? '?'} días\n\nGoogle da prioridad a sitios HTTPS. ${(ssl.daysUntilExpiry ?? 999) < 30 ? '⚠ Renueva pronto — quedan menos de 30 días.' : 'Sin problemas a la vista.'}`,
    });
  } else {
    issues.push({
      key: 'ssl_missing',
      severity: 'critical',
      label: 'Sin SSL',
      detail: 'Chrome marca tu web como "No segura"',
      expanded: 'Tu web no tiene certificado SSL (HTTPS). Chrome y otros navegadores muestran "No segura" en la barra de direcciones, lo que ahuyenta a los visitantes.\n\nAdemás, Google penaliza las webs sin HTTPS en los rankings. Instala un certificado SSL — muchos hostings lo ofrecen gratis con Let\'s Encrypt.',
    });
  }

  // ─── Schema markup ─────────────────────────────────────────────────────
  if (crawl.hasSchemaMarkup) {
    issues.push({
      key: 'schema_present',
      severity: 'good',
      label: 'Schema markup',
      detail: `Tipos: ${(crawl.schemaTypes || []).join(', ')}`,
      expanded: `Schema detectado: ${(crawl.schemaTypes || []).join(', ')}\n\nEl marcado Schema ayuda a Google a mostrar rich snippets (estrellas, precios, FAQ…) que aumentan el CTR. Revisa si cubre los tipos más relevantes para tu negocio.`,
    });
  } else {
    issues.push({
      key: 'schema_missing',
      severity: 'warning',
      label: 'Sin schema markup',
      detail: 'Google y las IAs no entienden tu negocio',
      expanded: 'No se detectó Schema (JSON-LD) en tu web. Sin Schema, Google no puede generar rich snippets (estrellas, FAQ, precios…) y las IAs no pueden estructurar tu información.\n\nAñade al menos Schema de tipo Organization y, si aplica, LocalBusiness, Product o FAQ.',
    });
  }

  // ─── Sitemap ───────────────────────────────────────────────────────────
  if (crawl.hasSitemap) {
    issues.push({
      key: 'sitemap_present',
      severity: 'good',
      label: 'Sitemap',
      detail: 'Google descubre tus páginas',
      expanded: `Se detectó sitemap.xml. Google lo usa para descubrir e indexar todas tus páginas.\n\nVerifica que esté actualizado y que incluya solo URLs canónicas (no duplicados ni páginas con noindex).`,
    });
  } else {
    issues.push({
      key: 'sitemap_missing',
      severity: 'warning',
      label: 'Sin sitemap.xml',
      detail: 'Google no descubre todas tus páginas',
      expanded: `No se encontró sitemap.xml. Sin él, Google depende del crawling para descubrir tus páginas — y puede perderse algunas.\n\nCrea un sitemap.xml en la raíz de tu web y envíalo en Google Search Console. La mayoría de CMS lo generan automáticamente.`,
    });
  }

  // ─── Canonical ─────────────────────────────────────────────────────────
  if (crawl.hasCanonical) {
    issues.push({
      key: 'canonical_present',
      severity: 'good',
      label: 'Canonical',
      detail: 'Evita duplicados',
      expanded: 'Se detectó etiqueta canonical. Esto indica a Google cuál es la URL principal de cada página, evitando problemas de contenido duplicado.',
    });
  } else {
    issues.push({
      key: 'canonical_missing',
      severity: 'warning',
      label: 'Sin canonical',
      detail: 'Posible contenido duplicado',
      expanded: 'No se detectó etiqueta <link rel="canonical">. Sin ella, Google puede indexar múltiples URLs con el mismo contenido (con/sin www, con/sin trailing slash, con parámetros…), diluyendo tu posicionamiento.\n\nAñade en cada página:\n<link rel="canonical" href="https://tudominio.com/pagina" />',
    });
  }

  // ─── PageSpeed mobile ──────────────────────────────────────────────────
  const mobilePS = pagespeed.mobile?.performance;
  if (mobilePS != null) {
    if (mobilePS >= 90) {
      issues.push({
        key: 'pagespeed_mobile_good',
        severity: 'good',
        label: `PageSpeed mobile: ${mobilePS}`,
        detail: 'Excelente',
        expanded: `Puntuación PageSpeed Insights para móvil: ${mobilePS}/100.\n\nExcelente rendimiento. Google prioriza la experiencia móvil desde 2021 (mobile-first indexing).`,
      });
    } else if (mobilePS >= 50) {
      issues.push({
        key: 'pagespeed_mobile_warning',
        severity: 'warning',
        label: `PageSpeed mobile: ${mobilePS}`,
        detail: 'Mejorable',
        expanded: `Puntuación PageSpeed Insights para móvil: ${mobilePS}/100.\n\nEl objetivo es superar 90. Revisa LCP (carga del elemento principal), CLS (estabilidad visual) y FID (interactividad).\n\n${pagespeed.mobile?.lcp ? `LCP actual: ${(pagespeed.mobile.lcp / 1000).toFixed(1)}s (Google recomienda < 2.5s)` : ''}\n\nAcciones comunes: optimizar imágenes (WebP), reducir JS/CSS no utilizado, usar lazy loading.`,
      });
    } else {
      issues.push({
        key: 'pagespeed_mobile_critical',
        severity: 'critical',
        label: `PageSpeed mobile: ${mobilePS}`,
        detail: `LCP: ${pagespeed.mobile?.lcp ? (pagespeed.mobile.lcp / 1000).toFixed(1) + 's' : '?'}`,
        expanded: `Puntuación PageSpeed Insights para móvil: ${mobilePS}/100 — rendimiento pobre.\n\n${pagespeed.mobile?.lcp ? `LCP: ${(pagespeed.mobile.lcp / 1000).toFixed(1)}s (Google recomienda < 2.5s)` : ''}\n\nEsto afecta directamente al ranking en Google. Prioriza: optimizar imágenes, reducir JavaScript, mejorar el servidor (TTFB) y habilitar compresión.`,
      });
    }
  }

  // ─── Content volume ────────────────────────────────────────────────────
  if ((crawl.wordCount ?? 0) < 300) {
    issues.push({
      key: 'word_count_low',
      severity: 'warning',
      label: `${crawl.wordCount ?? 0} palabras`,
      detail: 'Poco contenido para SEO',
      expanded: `Tu página tiene ${crawl.wordCount ?? 0} palabras. Google necesita contenido para entender de qué trata tu web.\n\nEl mínimo recomendado es 300 palabras para tu homepage. Las páginas que rankean en top 10 tienen de media 1.400+ palabras.\n\nAñade secciones con tus servicios, beneficios, casos de uso o FAQ.`,
    });
  }

  // ─── Internal linking ──────────────────────────────────────────────────
  if ((crawl.internalLinks ?? 0) < 5) {
    issues.push({
      key: 'internal_links_low',
      severity: 'warning',
      label: `${crawl.internalLinks ?? 0} enlaces internos`,
      detail: 'Pocos enlaces dificultan el crawling',
      expanded: `Solo ${crawl.internalLinks ?? 0} enlaces internos detectados. Los enlaces internos ayudan a Google a descubrir tus páginas y distribuyen la autoridad del dominio.\n\nRecomendación: al menos 5-10 enlaces internos en tu homepage apuntando a tus páginas más importantes (servicios, productos, contacto, blog).`,
    });
  }

  return issues;
}
