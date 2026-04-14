/**
 * Editorial AI — default format_rules per publication platform.
 *
 * Used by the setup wizard to seed new publication_profiles with sensible
 * defaults. The user can override any field from the settings UI afterwards.
 */

import type { PublicationPlatform, PublicationProfileFormat } from './types';

export const PLATFORM_DEFAULTS: Record<PublicationPlatform, {
  name: string;
  format_rules: PublicationProfileFormat;
}> = {
  blog: {
    name: 'Blog corporativo',
    format_rules: {
      target_length_min: 1500,
      target_length_max: 2500,
      structure: 'H2-driven con intro potente + 4-6 H2 + conclusión accionable + FAQ',
      allow_headings: true,
      require_meta: true,
      require_schema: true,
      tone_intensity: 'editorial',
    },
  },
  linkedin_post: {
    name: 'LinkedIn (post nativo)',
    format_rules: {
      target_length_min: 800,
      target_length_max: 1200,
      structure: 'hook primera línea + tesis + 3 argumentos + cierre con pregunta',
      allow_headings: false,
      hashtags_count: 4,
      require_meta: false,
      require_schema: false,
      tone_intensity: 'conversational',
    },
  },
  linkedin_article: {
    name: 'LinkedIn Article',
    format_rules: {
      target_length_min: 1200,
      target_length_max: 2000,
      structure: 'hook + intro + 3-4 secciones con H2 + conclusión',
      allow_headings: true,
      require_meta: false,
      require_schema: false,
      tone_intensity: 'editorial',
    },
  },
  newsletter: {
    name: 'Newsletter',
    format_rules: {
      target_length_min: 400,
      target_length_max: 800,
      structure: 'hook + 2-3 puntos clave + CTA',
      allow_headings: false,
      require_meta: false,
      require_schema: false,
      tone_intensity: 'conversational',
    },
  },
  column: {
    name: 'Columna editorial',
    format_rules: {
      target_length_min: 1500,
      target_length_max: 2500,
      structure: 'tesis fuerte + argumentación con datos + posicionamiento del autor',
      allow_headings: true,
      require_meta: true,
      require_schema: false,
      tone_intensity: 'editorial',
    },
  },
  twitter: {
    name: 'Twitter / X (thread)',
    format_rules: {
      target_length_min: 150,
      target_length_max: 280,
      structure: 'hook breve, tesis en una frase',
      allow_headings: false,
      hashtags_count: 2,
      require_meta: false,
      require_schema: false,
      tone_intensity: 'conversational',
    },
  },
};
