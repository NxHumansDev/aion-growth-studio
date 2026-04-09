/**
 * Audits GA4 + GSC configuration and data for errors, misconfigurations,
 * and improvement opportunities. Results go into pipeline_output.analytics.audit.
 */

import type { GA4Report } from './fetch-ga4';
import type { GSCReport } from './fetch-gsc';

export interface AnalyticsIssue {
  severity: 'critical' | 'warning' | 'info';
  category: 'config' | 'data_quality' | 'opportunity';
  source: 'ga4' | 'gsc';
  title: string;
  description: string;
  action?: string;
}

export interface AnalyticsAudit {
  issues: AnalyticsIssue[];
  opportunities: AnalyticsIssue[];
  configScore: number;  // 0-100
  summary: string;
}

export function auditAnalyticsData(ga4?: GA4Report, gsc?: GSCReport): AnalyticsAudit {
  const issues: AnalyticsIssue[] = [];
  const opportunities: AnalyticsIssue[] = [];

  // ─── GA4 checks ────────────────────────────────────────────────────────

  if (ga4) {
    // Conversions
    if (ga4.conversions === 0) {
      issues.push({
        severity: 'critical',
        category: 'config',
        source: 'ga4',
        title: 'Sin conversiones configuradas en GA4',
        description: 'No se detectan eventos de conversión. Sin esto no puedes medir el ROI de tus acciones de marketing.',
        action: 'Configura al menos un evento de conversión en GA4: formulario enviado, compra, solicitud de demo, etc.',
      });
    }

    // Bounce rate anomalies
    if (ga4.bounceRate < 5) {
      issues.push({
        severity: 'warning',
        category: 'data_quality',
        source: 'ga4',
        title: 'Bounce rate sospechosamente bajo (<5%)',
        description: `Bounce rate de ${ga4.bounceRate}%. Esto suele indicar un problema de implementación: eventos duplicados, tags mal configurados, o iframes que disparan pageviews extra.`,
        action: 'Revisa la configuración de GA4 Tag Manager. Verifica que no hay eventos duplicados.',
      });
    } else if (ga4.bounceRate > 85) {
      issues.push({
        severity: 'warning',
        category: 'data_quality',
        source: 'ga4',
        title: `Bounce rate muy alto (${ga4.bounceRate}%)`,
        description: 'Más del 85% de los visitantes se van sin interactuar. Puede indicar problemas de UX, velocidad de carga, o tráfico no cualificado.',
        action: 'Analiza las páginas con más rebote. Verifica que las landing pages cumplen la expectativa del usuario.',
      });
    }

    // Traffic source diversity
    const directPct = ga4.trafficSources.find(s => s.source === '(direct)')?.pct || 0;
    if (directPct > 70) {
      issues.push({
        severity: 'warning',
        category: 'config',
        source: 'ga4',
        title: `${directPct}% del tráfico es "directo"`,
        description: 'Un porcentaje tan alto de tráfico directo suele indicar que no tienes UTMs configurados en tus campañas, o que hay tráfico de referral que no se atribuye correctamente.',
        action: 'Configura parámetros UTM en todas tus campañas de email, social y paid. Revisa la configuración de referral exclusions.',
      });
    }

    // Session duration
    if (ga4.avgSessionDuration < 30 && ga4.sessions > 50) {
      issues.push({
        severity: 'info',
        category: 'data_quality',
        source: 'ga4',
        title: 'Duración media de sesión muy baja (<30s)',
        description: `Los usuarios pasan una media de ${ga4.avgSessionDuration}s en tu web. Puede indicar contenido poco relevante o problemas de UX.`,
      });
    }

    // Mobile dominance opportunity
    if (ga4.deviceBreakdown.mobile > 60) {
      opportunities.push({
        severity: 'info',
        category: 'opportunity',
        source: 'ga4',
        title: `${ga4.deviceBreakdown.mobile}% del tráfico es mobile`,
        description: 'La mayoría de tus visitantes usan móvil. Asegúrate de que la experiencia mobile está optimizada: velocidad, botones accesibles, formularios simplificados.',
        action: 'Prioriza la optimización mobile en PageSpeed y UX.',
      });
    }

    // Low pages per session
    if (ga4.pageviews > 0 && ga4.sessions > 0) {
      const pagesPerSession = ga4.pageviews / ga4.sessions;
      if (pagesPerSession < 1.5 && ga4.sessions > 50) {
        opportunities.push({
          severity: 'info',
          category: 'opportunity',
          source: 'ga4',
          title: `Solo ${pagesPerSession.toFixed(1)} páginas por sesión`,
          description: 'Los usuarios ven muy pocas páginas. Mejorar el enlazado interno y los CTAs puede aumentar el engagement.',
          action: 'Añade enlaces relacionados, CTAs entre secciones, y mejora la navegación.',
        });
      }
    }

    // Top page concentration
    if (ga4.topPages.length > 0 && ga4.pageviews > 0) {
      const topPagePct = Math.round((ga4.topPages[0].pageviews / ga4.pageviews) * 100);
      if (topPagePct > 60) {
        opportunities.push({
          severity: 'info',
          category: 'opportunity',
          source: 'ga4',
          title: `${topPagePct}% del tráfico va a una sola página`,
          description: `La página "${ga4.topPages[0].path}" concentra la mayoría del tráfico. Diversificar con más contenido puede captar más long-tail.`,
          action: 'Crea más páginas de destino y contenido específico para diferentes keywords.',
        });
      }
    }
  }

  // ─── GSC checks ────────────────────────────────────────────────────────

  if (gsc) {
    // No clicks
    if (gsc.totalClicks === 0 && gsc.totalImpressions > 0) {
      issues.push({
        severity: 'warning',
        category: 'data_quality',
        source: 'gsc',
        title: 'Impresiones en Google pero 0 clicks',
        description: `${gsc.totalImpressions} impresiones pero ningún click. Tus meta titles y descriptions no están atrayendo clicks.`,
        action: 'Reescribe los meta titles y descriptions de tus páginas principales para hacerlos más atractivos.',
      });
    }

    // Low CTR opportunity
    const lowCtrQueries = gsc.topQueries.filter(q => q.impressions > 50 && q.ctr < 2);
    if (lowCtrQueries.length > 0) {
      opportunities.push({
        severity: 'warning',
        category: 'opportunity',
        source: 'gsc',
        title: `${lowCtrQueries.length} keywords con muchas impresiones pero CTR bajo`,
        description: `Keywords como "${lowCtrQueries[0].query}" tienen ${lowCtrQueries[0].impressions} impresiones pero solo ${lowCtrQueries[0].ctr}% CTR. Optimizar los titles puede generar más clicks sin cambiar el ranking.`,
        action: 'Reescribe meta titles para estas keywords con copy más atractivo y CTAs implícitos.',
      });
    }

    // Almost top 10 opportunity
    const almostTop10 = gsc.topQueries.filter(q => q.position > 10 && q.position <= 20 && q.impressions > 30);
    if (almostTop10.length > 0) {
      opportunities.push({
        severity: 'info',
        category: 'opportunity',
        source: 'gsc',
        title: `${almostTop10.length} keywords en posiciones 11-20 (casi top 10)`,
        description: `Keywords como "${almostTop10[0].query}" (posición ${almostTop10[0].position}) están cerca del top 10. Un poco de optimización puede hacerlas entrar en primera página.`,
        action: 'Mejora el contenido de las páginas que rankean para estas keywords: más profundidad, mejor estructura, internal linking.',
      });
    }

    // High position keywords losing CTR
    const highPosLowCtr = gsc.topQueries.filter(q => q.position <= 5 && q.ctr < 5 && q.impressions > 20);
    if (highPosLowCtr.length > 0) {
      opportunities.push({
        severity: 'warning',
        category: 'opportunity',
        source: 'gsc',
        title: `Keywords en top 5 con CTR bajo`,
        description: `"${highPosLowCtr[0].query}" está en posición ${highPosLowCtr[0].position} pero solo ${highPosLowCtr[0].ctr}% CTR. Puede que un featured snippet o un competidor con mejor title te esté robando clicks.`,
        action: 'Añade schema markup, mejora el meta title, y revisa si hay un featured snippet que puedas capturar.',
      });
    }

    // Indexed pages
    if (gsc.indexedPages !== undefined && gsc.indexedPages < 5) {
      issues.push({
        severity: 'warning',
        category: 'data_quality',
        source: 'gsc',
        title: `Solo ${gsc.indexedPages} páginas indexadas`,
        description: 'Muy pocas páginas indexadas limita tu visibilidad en Google. Puede haber problemas de indexación o falta de contenido.',
        action: 'Verifica el sitemap, revisa robots.txt, y crea más contenido indexable.',
      });
    }
  }

  // ─── Config score ──────────────────────────────────────────────────────

  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const configScore = Math.max(0, 100 - (criticalCount * 30) - (warningCount * 10));

  // ─── Summary ───────────────────────────────────────────────────────────

  const parts: string[] = [];
  if (criticalCount > 0) parts.push(`${criticalCount} problema${criticalCount > 1 ? 's' : ''} crítico${criticalCount > 1 ? 's' : ''}`);
  if (warningCount > 0) parts.push(`${warningCount} advertencia${warningCount > 1 ? 's' : ''}`);
  if (opportunities.length > 0) parts.push(`${opportunities.length} oportunidad${opportunities.length > 1 ? 'es' : ''} de mejora`);

  const summary = parts.length > 0
    ? `Análisis de configuración: ${parts.join(', ')}. Score: ${configScore}/100.`
    : 'Configuración de analytics correcta. No se detectan problemas.';

  return { issues, opportunities, configScore, summary };
}
