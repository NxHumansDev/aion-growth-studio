/**
 * Business Impact — catalog of all available KPIs.
 *
 * Each definition declares the source, unit, applicable business profiles,
 * and what integrations/inputs it requires. The resolver uses this to
 * decide which KPIs are feasible for a given client and how to extract
 * their value from pipeline_output + analytics + manual inputs.
 */

import type { KpiDefinition, KpiKey } from './types';

export const KPI_DEFINITIONS: Record<KpiKey, KpiDefinition> = {
  // ─── Google Business Profile ─────────────────────────────────────────
  gbp_calls: {
    key: 'gbp_calls',
    label: 'Llamadas desde Google Business',
    short_label: 'Llamadas GBP',
    unit: 'count',
    source: 'gbp',
    profiles: ['local_foot_traffic', 'local_services'],
    requires_gbp: true,
    description: 'Llamadas directas que has recibido desde tu ficha de Google Business este mes.',
    better: 'up',
  },
  gbp_direction_requests: {
    key: 'gbp_direction_requests',
    label: 'Solicitudes de dirección',
    short_label: 'Cómo llegar',
    unit: 'count',
    source: 'gbp',
    profiles: ['local_foot_traffic'],
    requires_gbp: true,
    description: 'Personas que han pedido indicaciones para llegar a tu ubicación — intención de visita.',
    better: 'up',
  },
  gbp_website_clicks: {
    key: 'gbp_website_clicks',
    label: 'Clicks a la web desde Google Business',
    short_label: 'Web clicks GBP',
    unit: 'count',
    source: 'gbp',
    profiles: ['local_services', 'local_foot_traffic'],
    requires_gbp: true,
    description: 'Clicks al botón "Sitio web" desde tu ficha de Google Business.',
    better: 'up',
  },
  gbp_profile_views: {
    key: 'gbp_profile_views',
    label: 'Visitas a la ficha de Google Business',
    short_label: 'Visitas ficha',
    unit: 'count',
    source: 'gbp',
    profiles: ['local_foot_traffic'],
    requires_gbp: true,
    description: 'Veces que tu ficha ha aparecido en los resultados de búsqueda o Maps.',
    better: 'up',
  },

  // ─── Reseñas ─────────────────────────────────────────────────────────
  reviews_new_google: {
    key: 'reviews_new_google',
    label: 'Reseñas nuevas en Google',
    short_label: 'Reseñas Google',
    unit: 'count',
    source: 'gbp',
    profiles: ['local_foot_traffic', 'local_services', 'ecommerce'],
    requires_gbp: true,
    description: 'Reseñas nuevas recibidas en Google Business este periodo.',
    better: 'up',
  },
  reviews_new_total: {
    key: 'reviews_new_total',
    label: 'Reseñas nuevas (Google + Trustpilot)',
    short_label: 'Reseñas nuevas',
    unit: 'count',
    source: 'reputation',
    profiles: ['local_foot_traffic', 'local_services', 'ecommerce'],
    description: 'Reseñas nuevas sumando todas las plataformas (Google + Trustpilot).',
    better: 'up',
  },

  // ─── Tráfico ─────────────────────────────────────────────────────────
  traffic_organic_estimate: {
    key: 'traffic_organic_estimate',
    label: 'Tráfico orgánico estimado',
    short_label: 'Tráfico orgánico',
    unit: 'count',
    source: 'dfs_seo',
    profiles: 'all',
    description: 'Visitas mensuales estimadas desde Google por las keywords donde rankeas. Estimado por DataForSEO.',
    better: 'up',
  },
  traffic_branded: {
    key: 'traffic_branded',
    label: 'Tráfico de marca',
    short_label: 'Tráfico marca',
    unit: 'count',
    source: 'dfs_seo',
    profiles: ['ecommerce', 'freelance_personal', 'b2b_services', 'media'],
    description: 'Búsquedas que contienen tu nombre de marca — indicador directo de brand awareness.',
    better: 'up',
  },
  gsc_clicks: {
    key: 'gsc_clicks',
    label: 'Clicks reales desde Google',
    short_label: 'GSC clicks',
    unit: 'count',
    source: 'gsc',
    profiles: 'all',
    requires_gsc: true,
    description: 'Clicks reales desde los resultados de Google (datos de Search Console, no estimados).',
    better: 'up',
  },
  keywords_indexed_top10: {
    key: 'keywords_indexed_top10',
    label: 'Keywords en top 10',
    short_label: 'Keywords top 10',
    unit: 'count',
    source: 'dfs_seo',
    profiles: ['freelance_personal', 'media', 'b2b_saas', 'b2b_services'],
    description: 'Número de keywords donde apareces en la primera página de Google.',
    better: 'up',
  },

  // ─── E-commerce ──────────────────────────────────────────────────────
  ecommerce_revenue: {
    key: 'ecommerce_revenue',
    label: 'Revenue total',
    short_label: 'Revenue',
    unit: 'currency',
    source: 'ga4',
    profiles: ['ecommerce'],
    requires_ga4: true,
    description: 'Ingresos totales atribuidos por GA4 este periodo (requiere Enhanced Ecommerce configurado).',
    better: 'up',
  },
  ecommerce_transactions: {
    key: 'ecommerce_transactions',
    label: 'Transacciones',
    short_label: 'Ventas',
    unit: 'count',
    source: 'ga4',
    profiles: ['ecommerce'],
    requires_ga4: true,
    description: 'Número de compras completadas — cada una cuenta como una venta.',
    better: 'up',
  },
  ecommerce_cpa: {
    key: 'ecommerce_cpa',
    label: 'Coste por venta',
    short_label: 'CPA',
    unit: 'currency',
    source: 'derived',
    profiles: ['ecommerce'],
    requires_ga4: true,
    requires_ad_spend: true,
    description: 'Inversión en publicidad dividida entre ventas totales (monthly_ad_spend / transactions).',
    better: 'down',
  },
  ecommerce_roas: {
    key: 'ecommerce_roas',
    label: 'ROAS',
    short_label: 'ROAS',
    unit: 'ratio',
    source: 'derived',
    profiles: ['ecommerce'],
    requires_ga4: true,
    requires_ad_spend: true,
    description: 'Return on Ad Spend: revenue / inversión publicitaria. >1 = rentable.',
    better: 'up',
  },

  // ─── Lead-gen / SaaS ─────────────────────────────────────────────────
  leads_generated: {
    key: 'leads_generated',
    label: 'Leads generados',
    short_label: 'Leads',
    unit: 'count',
    source: 'ga4',
    profiles: ['b2b_services', 'b2b_saas', 'local_services'],
    requires_ga4: true,
    description: 'Formularios enviados o eventos de lead capturados en GA4 este periodo.',
    better: 'up',
  },
  leads_manual: {
    key: 'leads_manual',
    label: 'Leads (registrados manualmente)',
    short_label: 'Leads',
    unit: 'count',
    source: 'manual',
    profiles: ['b2b_services', 'b2b_saas', 'local_services'],
    description: 'Leads reportados manualmente. Útil como fallback cuando GA4 no está conectado.',
    better: 'up',
  },
  cost_per_lead: {
    key: 'cost_per_lead',
    label: 'Coste por lead',
    short_label: 'CPL',
    unit: 'currency',
    source: 'derived',
    profiles: ['b2b_services', 'b2b_saas'],
    requires_ad_spend: true,
    description: 'Inversión en publicidad dividida entre leads totales este mes.',
    better: 'down',
  },
  activations: {
    key: 'activations',
    label: 'Activaciones / conversiones',
    short_label: 'Activaciones',
    unit: 'count',
    source: 'ga4',
    profiles: ['b2b_saas'],
    requires_ga4: true,
    description: 'Usuarios que han completado el evento de activación clave (sign_up / trial / start_free).',
    better: 'up',
  },
  cost_per_activation: {
    key: 'cost_per_activation',
    label: 'Coste por activación',
    short_label: 'CPA',
    unit: 'currency',
    source: 'derived',
    profiles: ['b2b_saas'],
    requires_ga4: true,
    requires_ad_spend: true,
    description: 'Inversión en publicidad dividida entre activaciones totales.',
    better: 'down',
  },

  // ─── Derived ─────────────────────────────────────────────────────────
  estimated_pipeline: {
    key: 'estimated_pipeline',
    label: 'Pipeline estimado',
    short_label: 'Pipeline €',
    unit: 'currency',
    source: 'derived',
    profiles: ['b2b_services', 'b2b_saas'],
    requires_deal_value: true,
    description: 'Valor estimado del pipeline: leads × valor medio de cliente × tasa de cierre.',
    better: 'up',
  },

  // ─── Engagement (media profile only) ─────────────────────────────────
  engagement_total: {
    key: 'engagement_total',
    label: 'Engagement social',
    short_label: 'Engagement',
    unit: 'count',
    source: 'social',
    profiles: ['media'],
    description: 'Suma de likes + comentarios + shares en redes sociales este mes.',
    better: 'up',
  },
};

/** Helper to get a KPI definition by key. */
export function getKpiDefinition(key: KpiKey): KpiDefinition | undefined {
  return KPI_DEFINITIONS[key];
}

/** All KPIs applicable to a given profile. */
export function getKpisForProfile(profile: import('./types').BusinessProfile): KpiDefinition[] {
  return Object.values(KPI_DEFINITIONS).filter(
    (k) => k.profiles === 'all' || (k.profiles as string[]).includes(profile),
  );
}
