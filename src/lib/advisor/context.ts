import { getClientOnboarding, getLatestSnapshot, getAllSnapshots, getAllRecommendations } from '../db';
import { getRecentMessages, getLearnings, getDocuments, type AdvisorMessage } from './db';

/**
 * Build the full client context for the advisor prompt.
 *
 * Includes: onboarding, KPIs, evolution, recommendations, past conversations,
 * learnings, and uploaded documents.
 *
 * Memory strategy:
 * - Last 60 days: all messages included verbatim
 * - Older: only client_learnings (auto-summarized)
 */
export async function buildAdvisorContext(clientId: string, domain: string): Promise<string> {
  const [onboarding, latestSnap, allSnaps, recommendations, recentMsgs, learnings, documents] =
    await Promise.all([
      getClientOnboarding(clientId),
      getLatestSnapshot(clientId),
      getAllSnapshots(clientId),
      getAllRecommendations(clientId),
      getRecentMessages(clientId, 60),
      getLearnings(clientId, 50),
      getDocuments(clientId),
    ]);

  const sections: string[] = [];

  // ── 1. Client profile ──────────────────────────────────────────
  sections.push('## PERFIL DEL CLIENTE');
  sections.push(`Dominio: ${domain}`);
  if (onboarding) {
    if (onboarding.sector) sections.push(`Sector: ${onboarding.sector}`);
    if (onboarding.business_description) sections.push(`Negocio: ${onboarding.business_description}`);
    if (onboarding.primary_goal) sections.push(`Objetivo principal: ${onboarding.primary_goal}${onboarding.goal_detail ? ` — ${onboarding.goal_detail}` : ''}`);
    if (onboarding.geo_scope) sections.push(`Alcance geográfico: ${onboarding.geo_scope}${onboarding.geo_detail ? ` (${onboarding.geo_detail})` : ''}`);
    if (onboarding.monthly_budget) sections.push(`Presupuesto mensual: ${onboarding.monthly_budget}`);
    if (onboarding.team_size) sections.push(`Tamaño equipo: ${onboarding.team_size}`);
    if (onboarding.competitors?.length) {
      sections.push(`Competidores: ${onboarding.competitors.map(c => c.name || c.url).join(', ')}`);
    }
    if (onboarding.instagram_handle) sections.push(`Instagram: @${onboarding.instagram_handle}`);
    if (onboarding.linkedin_url) sections.push(`LinkedIn: ${onboarding.linkedin_url}`);
  }

  // ── 2. Current KPIs (latest snapshot) ──────────────────────────
  const r = (latestSnap && latestSnap.id !== 'empty') ? latestSnap.pipeline_output : null;
  if (r) {
    sections.push('\n## KPIS ACTUALES (último análisis)');
    const score = r.score as any;
    if (score?.total != null) {
      sections.push(`Score global: ${score.total}/100`);
      const b = score.breakdown || {};
      sections.push(`  SEO: ${b.seo ?? '?'} | GEO: ${b.geo ?? '?'} | Web: ${b.web ?? '?'} | Conversión: ${b.conversion ?? '?'} | Reputación: ${b.reputation ?? '?'}`);
    }

    const seo = r.seo as any;
    if (seo && !seo.skipped) {
      sections.push(`SEO: ${seo.keywordsTop10 ?? '?'} KW top10, ${seo.keywordsTop3 ?? '?'} top3, tráfico orgánico ~${seo.organicTraffic ?? '?'}, DR ${seo.domainRank ?? '?'}`);
    }

    const geo = r.geo as any;
    if (geo && !geo.skipped) {
      sections.push(`GEO (IA): mention rate ${geo.mentionRate ?? '?'}%`);
    }

    const ps = r.pagespeed as any;
    if (ps && !ps.skipped) {
      sections.push(`PageSpeed: mobile ${ps.mobile?.performance ?? '?'}, desktop ${ps.desktop?.performance ?? '?'}, LCP ${ps.mobile?.lcp ?? '?'}ms`);
    }

    const conversion = r.conversion as any;
    if (conversion && !conversion.skipped) {
      sections.push(`Conversión: funnel score ${conversion.funnelScore ?? '?'}/100, CTAs: ${conversion.ctaCount ?? '?'}, forms: ${conversion.formCount ?? '?'}`);
    }

    const ig = r.instagram as any;
    if (ig?.found && ig.followers) {
      sections.push(`Instagram: ${ig.followers} followers, ER ${ig.engagementRate ?? '?'}%`);
    }

    const li = r.linkedin as any;
    if (li?.found && li.followers) {
      sections.push(`LinkedIn: ${li.followers} followers`);
    }

    const rep = r.reputation as any;
    if (rep && !rep.skipped) {
      sections.push(`Reputación: ${rep.combinedRating ? `${rep.combinedRating}★` : 'sin rating'}, ${rep.totalReviews ?? 0} reviews, ${rep.newsCount ?? 0} menciones en prensa`);
    }

    // Competitor data
    const ct = r.competitor_traffic as any;
    if (ct?.items?.length) {
      sections.push('\nCompetidores (datos SEO):');
      for (const c of ct.items.slice(0, 3)) {
        sections.push(`  ${c.name || c.domain}: ${c.keywordsTop10 ?? '?'} KW top10, tráfico ~${c.organicTraffic ?? '?'}, DR ${c.domainRank ?? '?'}`);
      }
    }
  }

  // ── 3. Evolution (if multiple snapshots) ───────────────────────
  if (allSnaps.length >= 2) {
    sections.push('\n## EVOLUCIÓN');
    const prev = allSnaps[allSnaps.length - 2]?.pipeline_output;
    const curr = allSnaps[allSnaps.length - 1]?.pipeline_output;
    if (prev && curr) {
      const prevScore = (prev.score as any)?.total;
      const currScore = (curr.score as any)?.total;
      if (prevScore != null && currScore != null) {
        const delta = currScore - prevScore;
        sections.push(`Score: ${prevScore} → ${currScore} (${delta >= 0 ? '+' : ''}${delta})`);
      }
      const prevKW = (prev.seo as any)?.keywordsTop10;
      const currKW = (curr.seo as any)?.keywordsTop10;
      if (prevKW != null && currKW != null) {
        sections.push(`KW Top10: ${prevKW} → ${currKW} (${currKW - prevKW >= 0 ? '+' : ''}${currKW - prevKW})`);
      }
      const prevGeo = (prev.geo as any)?.mentionRate;
      const currGeo = (curr.geo as any)?.mentionRate;
      if (prevGeo != null && currGeo != null) {
        sections.push(`GEO mention rate: ${prevGeo}% → ${currGeo}%`);
      }
    }
    sections.push(`Total snapshots: ${allSnaps.length} (desde ${allSnaps[0]?.date || '?'})`);
  }

  // ── 4. Plan de acción (recommendations) ────────────────────────
  if (recommendations.length) {
    sections.push('\n## PLAN DE ACCIÓN');
    const byStatus = { pending: [] as any[], in_progress: [] as any[], done: [] as any[] };
    for (const rec of recommendations) {
      const bucket = byStatus[rec.status as keyof typeof byStatus] || byStatus.pending;
      bucket.push(rec);
    }
    if (byStatus.pending.length) {
      sections.push('Pendientes:');
      for (const r of byStatus.pending.slice(0, 5)) {
        sections.push(`  - [${r.impact}] ${r.title}`);
      }
    }
    if (byStatus.in_progress.length) {
      sections.push('En progreso:');
      for (const r of byStatus.in_progress) {
        sections.push(`  - ${r.title}`);
      }
    }
    if (byStatus.done.length) {
      sections.push(`Completadas: ${byStatus.done.length} acciones`);
      for (const r of byStatus.done.slice(0, 3)) {
        sections.push(`  - ${r.title} (${r.updated_at?.slice(0, 10) || '?'})`);
      }
    }
  }

  // ── 5. Learnings (accumulated memory) ──────────────────────────
  if (learnings.length) {
    sections.push('\n## APRENDIZAJES ACUMULADOS');
    for (const l of learnings.slice(0, 30)) {
      sections.push(`- [${l.type}] ${l.content}`);
    }
  }

  // ── 6. Documents ───────────────────────────────────────────────
  if (documents.length) {
    const withText = documents.filter((d: any) => d.extracted_text);
    if (withText.length) {
      sections.push('\n## DOCUMENTOS DEL CLIENTE');
      for (const doc of withText.slice(0, 5)) {
        const text = (doc.extracted_text || '').slice(0, 2000);
        sections.push(`### ${doc.filename}\n${text}`);
      }
    }
  }

  // ── 7. Conversation history (last 60 days) ─────────────────────
  if (recentMsgs.length) {
    sections.push('\n## CONVERSACIONES RECIENTES (últimos 60 días)');
    let currentThread = '';
    for (const msg of recentMsgs.slice(-100)) { // cap at 100 most recent messages
      if (msg.thread_id !== currentThread) {
        currentThread = msg.thread_id;
        sections.push(`\n--- Thread ${msg.created_at.slice(0, 10)} ---`);
      }
      const role = msg.role === 'user' ? 'Cliente' : 'Advisor';
      // Truncate very long messages in history
      const content = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content;
      sections.push(`${role}: ${content}`);
    }
  }

  return sections.join('\n');
}
