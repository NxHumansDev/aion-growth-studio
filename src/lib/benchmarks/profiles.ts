/**
 * The 8 benchmark profiles — thresholds + pillar weights + playbook for
 * each business type. All hardcoded thresholds that used to live in
 * score.ts and content-score.ts are centralized here.
 *
 * Thresholds are defined for scope='national' (the base). For other
 * scopes they get multiplied by geo-multipliers.ts.
 *
 * Realistic references used:
 * - freelance: personal brand, 1 person, local/national reach
 *     - 1K IG / 1.5K LinkedIn = solid for a consultor
 *     - 1-5 press mentions / quarter = visible
 * - ecommerce B2C: scale-dependent, reputation + conversion heavy
 *     - 10K IG = solid, 50K = great
 *     - Product reviews + trustpilot matter more than press
 * - SaaS: SEO + content heavy, LinkedIn over Instagram
 * - local-single: GBP reviews are dominant, social less so
 */

import type { BenchmarkProfile } from './types';

export const PROFILES: Record<string, BenchmarkProfile> = {
  freelance: {
    profile: 'freelance',
    weights: {
      seo: 0.20, geo: 0.20, web: 0.10, conversion: 0.10, reputation: 0.40,
    },
    thresholds: {
      keywordsTop10: { ceiling: 200 },         // realistic for personal brand
      organicTrafficMonthly: { ceiling: 10_000 },
      instagramFollowers: { ceiling: 10_000 },
      linkedinFollowers: { ceiling: 10_000 },
      pressMentionsQuarterly: { strong: 10, good: 5, ok: 2, weak: 1 },
      blogPostsPerMonth: { strong: 4, good: 2, ok: 1, weak: 0.33 },
      gbpReviews: { ceiling: 50 },
      instagramEngagementRate: { strong: 4, good: 2.5, ok: 1.5, weak: 0.5 },
      linkedinEngagementRate: { strong: 3, good: 1.5, ok: 0.7, weak: 0.2 },
    },
    playbook: {
      label: 'Freelance / marca personal',
      description: 'Consultor independiente, abogado, coach, diseñador — una persona que vende su expertise.',
      valueSignals: [
        'Presencia en LinkedIn con actividad publicando',
        'Menciones en prensa o podcasts del sector',
        'Testimonios y casos de éxito visibles en la web',
        'Blog con artículos de autoridad (aunque sean pocos)',
        'Google Business Profile si atiende clientes presenciales',
      ],
      ignoreSignals: [
        'Catálogo de productos / carrito de compra',
        'Tráfico orgánico masivo (irrealista para una persona)',
        'Volumen de seguidores estilo influencer',
        'Métricas de ecommerce (AOV, conversion rate transaccional)',
      ],
      exampleClients: ['Kiko Gámez (consultor AI)', 'Abogado independiente', 'Diseñador freelance'],
    },
  },

  'professional-services': {
    profile: 'professional-services',
    weights: {
      seo: 0.30, geo: 0.20, web: 0.15, conversion: 0.20, reputation: 0.15,
    },
    thresholds: {
      keywordsTop10: { ceiling: 800 },
      organicTrafficMonthly: { ceiling: 50_000 },
      instagramFollowers: { ceiling: 15_000 },
      linkedinFollowers: { ceiling: 30_000 },
      pressMentionsQuarterly: { strong: 20, good: 10, ok: 5, weak: 2 },
      blogPostsPerMonth: { strong: 6, good: 3, ok: 1.5, weak: 0.5 },
      gbpReviews: { ceiling: 150 },
      instagramEngagementRate: { strong: 3, good: 1.5, ok: 0.8, weak: 0.3 },
      linkedinEngagementRate: { strong: 2, good: 1, ok: 0.5, weak: 0.15 },
    },
    playbook: {
      label: 'Servicios profesionales (agencia / consultoría / despacho)',
      description: 'Empresa pequeña-mediana que vende servicios B2B: agencia, despacho, consultoría.',
      valueSignals: [
        'Formulario de contacto / solicitud de presupuesto optimizado',
        'Casos de estudio y sector-specific landing pages',
        'Content marketing con cadencia (blog, whitepapers, webinars)',
        'LinkedIn corporativo activo + perfiles de socios',
        'Menciones en prensa sectorial',
      ],
      ignoreSignals: [
        'Carrito de compra o precios públicos de transacción',
        'Métricas de engagement típicas de B2C (ER altísimo en IG)',
      ],
      exampleClients: ['Agencia de marketing', 'Despacho de abogados', 'Consultora tecnológica'],
    },
  },

  saas: {
    profile: 'saas',
    weights: {
      seo: 0.35, geo: 0.20, web: 0.20, conversion: 0.15, reputation: 0.10,
    },
    thresholds: {
      keywordsTop10: { ceiling: 2_000 },        // matches old global default
      organicTrafficMonthly: { ceiling: 500_000 },
      instagramFollowers: { ceiling: 20_000 },
      linkedinFollowers: { ceiling: 50_000 },
      pressMentionsQuarterly: { strong: 25, good: 12, ok: 5, weak: 2 },
      blogPostsPerMonth: { strong: 8, good: 4, ok: 2, weak: 1 },
      gbpReviews: { ceiling: 100 },
      instagramEngagementRate: { strong: 2.5, good: 1.2, ok: 0.6, weak: 0.2 },
      linkedinEngagementRate: { strong: 2.5, good: 1.2, ok: 0.5, weak: 0.15 },
    },
    playbook: {
      label: 'SaaS / plataforma digital',
      description: 'Software, plataforma online, app, herramienta digital con modelo de suscripción o freemium.',
      valueSignals: [
        'SEO de contenido (blog técnico, comparadores, use cases)',
        'Docs / base de conocimiento como activo SEO',
        'Conversión a trial / demo / signup',
        'Reviews en G2, Capterra, Product Hunt',
        'Integración con productos complementarios',
      ],
      ignoreSignals: [
        'Google Business Profile (salvo si hay oficina con atención al público)',
        'Trustpilot (G2/Capterra son más relevantes)',
        'Engagement social típico de B2C',
      ],
      exampleClients: ['Notion', 'Linear', 'Hotjar', 'Airtable'],
    },
  },

  ecommerce: {
    profile: 'ecommerce',
    weights: {
      seo: 0.30, geo: 0.15, web: 0.15, conversion: 0.25, reputation: 0.15,
    },
    thresholds: {
      keywordsTop10: { ceiling: 3_000 },
      organicTrafficMonthly: { ceiling: 1_000_000 },
      instagramFollowers: { ceiling: 50_000 },   // IG is primary for B2C
      linkedinFollowers: { ceiling: 10_000 },    // LinkedIn less critical
      pressMentionsQuarterly: { strong: 15, good: 8, ok: 3, weak: 1 },
      blogPostsPerMonth: { strong: 8, good: 4, ok: 2, weak: 1 },
      gbpReviews: { ceiling: 300 },
      instagramEngagementRate: { strong: 4, good: 2.5, ok: 1.2, weak: 0.4 },
      linkedinEngagementRate: { strong: 1.5, good: 0.7, ok: 0.3, weak: 0.1 },
    },
    playbook: {
      label: 'Ecommerce B2C',
      description: 'Tienda online que vende productos directo al consumidor final.',
      valueSignals: [
        'Carrito funcional, checkout sin fricciones, envíos claros',
        'Ficha de producto rica (imágenes, reviews, stock)',
        'Instagram activo con product discovery y shopping',
        'Google Shopping y ads de catálogo',
        'Trustpilot / reviews verificadas',
      ],
      ignoreSignals: [
        'Formulario de "solicitar presupuesto" (no aplica)',
        'LinkedIn como canal principal',
        'Content authority puro (importa más la conversión)',
      ],
      exampleClients: ['Tienda de moda online', 'Marketplace vertical', 'D2C brand'],
    },
  },

  'local-single': {
    profile: 'local-single',
    weights: {
      seo: 0.15, geo: 0.15, web: 0.10, conversion: 0.15, reputation: 0.45,
    },
    thresholds: {
      keywordsTop10: { ceiling: 100 },          // hiper-local, pocas kw
      organicTrafficMonthly: { ceiling: 5_000 },
      instagramFollowers: { ceiling: 5_000 },
      linkedinFollowers: { ceiling: 2_000 },
      pressMentionsQuarterly: { strong: 5, good: 3, ok: 1, weak: 0 },
      blogPostsPerMonth: { strong: 2, good: 1, ok: 0.33, weak: 0 },
      gbpReviews: { ceiling: 200 },             // GBP reviews = oxígeno
      instagramEngagementRate: { strong: 6, good: 4, ok: 2, weak: 0.8 },
      linkedinEngagementRate: { strong: 2, good: 1, ok: 0.5, weak: 0.15 },
    },
    playbook: {
      label: 'Negocio local (1 ubicación)',
      description: 'Restaurante, clínica, tienda física u otro negocio con una única ubicación física.',
      valueSignals: [
        'Google Business Profile completo con fotos, horarios, reviews',
        'Volumen de reseñas en Google (señal nº1 de confianza local)',
        'Dirección, teléfono, horario visibles en la web',
        'Instagram con contenido del día a día del negocio',
        'Aparecer en packs locales / Google Maps',
      ],
      ignoreSignals: [
        'Tráfico orgánico nacional',
        'Catálogo online / ecommerce (salvo si es clave)',
        'LinkedIn corporativo (casi irrelevante)',
        'Content marketing de autoridad',
      ],
      exampleClients: ['Restaurante de barrio', 'Clínica dental', 'Tienda de ropa física'],
    },
  },

  'local-chain': {
    profile: 'local-chain',
    weights: {
      seo: 0.25, geo: 0.20, web: 0.15, conversion: 0.15, reputation: 0.25,
    },
    thresholds: {
      keywordsTop10: { ceiling: 500 },
      organicTrafficMonthly: { ceiling: 100_000 },
      instagramFollowers: { ceiling: 30_000 },
      linkedinFollowers: { ceiling: 10_000 },
      pressMentionsQuarterly: { strong: 20, good: 10, ok: 4, weak: 1 },
      blogPostsPerMonth: { strong: 4, good: 2, ok: 1, weak: 0.33 },
      gbpReviews: { ceiling: 1_000 },           // sumatorio multi-sede
      instagramEngagementRate: { strong: 4, good: 2.5, ok: 1.2, weak: 0.4 },
      linkedinEngagementRate: { strong: 2, good: 1, ok: 0.5, weak: 0.15 },
    },
    playbook: {
      label: 'Cadena / franquicia multi-sede',
      description: 'Negocio físico con varias ubicaciones: cadena, franquicia, red de tiendas o clínicas.',
      valueSignals: [
        'GBP por ubicación con reviews agregadas',
        'SEO local multi-sede (landing por ciudad / sede)',
        'Schema LocalBusiness con branches',
        'Buscador de tiendas funcional en la web',
        'Marca reconocida en prensa / medios sectoriales',
      ],
      ignoreSignals: [
        'Conversión a demo (no aplica)',
        'Métricas de ER social estilo influencer',
      ],
      exampleClients: ['Cadena de clínicas dentales', 'Franquicia de restaurantes', 'Retail con 10+ tiendas'],
    },
  },

  'media-education': {
    profile: 'media-education',
    weights: {
      seo: 0.35, geo: 0.20, web: 0.15, conversion: 0.15, reputation: 0.15,
    },
    thresholds: {
      keywordsTop10: { ceiling: 5_000 },
      organicTrafficMonthly: { ceiling: 2_000_000 }, // publishers escalan alto
      instagramFollowers: { ceiling: 100_000 },
      linkedinFollowers: { ceiling: 30_000 },
      pressMentionsQuarterly: { strong: 30, good: 15, ok: 5, weak: 1 },
      blogPostsPerMonth: { strong: 20, good: 10, ok: 5, weak: 2 },
      gbpReviews: { ceiling: 50 },
      instagramEngagementRate: { strong: 3, good: 1.5, ok: 0.8, weak: 0.3 },
      linkedinEngagementRate: { strong: 2, good: 1, ok: 0.5, weak: 0.15 },
    },
    playbook: {
      label: 'Medios / educación online',
      description: 'Blog monetizado, publisher digital, academia online, escuela de formación.',
      valueSignals: [
        'Volumen de tráfico orgánico y retención',
        'Cadencia alta de publicación con calidad',
        'Email list / newsletter como activo',
        'Reviews de estudiantes (si es formación)',
        'Contenido evergreen posicionado',
      ],
      ignoreSignals: [
        'Conversión a demo (no aplica salvo academia)',
        'GBP (salvo si hay sede física)',
      ],
      exampleClients: ['Platzi', 'Xataka', 'Domestika'],
    },
  },

  'nonprofit-institutional': {
    profile: 'nonprofit-institutional',
    weights: {
      seo: 0.20, geo: 0.25, web: 0.15, conversion: 0.15, reputation: 0.25,
    },
    thresholds: {
      keywordsTop10: { ceiling: 400 },
      organicTrafficMonthly: { ceiling: 100_000 },
      instagramFollowers: { ceiling: 50_000 },
      linkedinFollowers: { ceiling: 20_000 },
      pressMentionsQuarterly: { strong: 30, good: 15, ok: 5, weak: 1 },
      blogPostsPerMonth: { strong: 4, good: 2, ok: 1, weak: 0.33 },
      gbpReviews: { ceiling: 100 },
      instagramEngagementRate: { strong: 5, good: 3, ok: 1.5, weak: 0.5 },
      linkedinEngagementRate: { strong: 2.5, good: 1.2, ok: 0.6, weak: 0.2 },
    },
    playbook: {
      label: 'ONG / fundación / institución',
      description: 'Organización sin ánimo de lucro, fundación, asociación o institución pública/educativa.',
      valueSignals: [
        'Mención en medios y autoridad reputacional',
        'Presencia en respuestas de IAs (visibilidad institucional)',
        'Donaciones recurrentes / socios (si aplica)',
        'Transparencia: memoria anual, cuentas, proyectos',
        'Engagement comunitario en social',
      ],
      ignoreSignals: [
        'Carrito de compra / checkout transaccional',
        'Growth hacks agresivos',
        'CAC / LTV (ratios comerciales)',
      ],
      exampleClients: ['Greenpeace', 'Cruz Roja', 'Fundación cultural'],
    },
  },
};

export function getProfile(profile: string): BenchmarkProfile {
  return PROFILES[profile] || PROFILES['professional-services'];
}

export const ALL_PROFILE_KEYS = Object.keys(PROFILES) as Array<keyof typeof PROFILES>;
