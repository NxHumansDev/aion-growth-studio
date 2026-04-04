import { Resend } from 'resend';
import { isTestEmail } from './config';

const RESEND_API_KEY = import.meta.env?.RESEND_API_KEY || process.env.RESEND_API_KEY;
const SITE_URL = import.meta.env?.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://aiongrowth.studio';
const FROM_EMAIL = import.meta.env?.RESEND_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'AION Growth Studio <noreply@aiongrowth.studio>';

interface PostAuditEmailData {
  to: string;
  domain: string;
  score: number;
  auditId: string;
  scoreBreakdown?: {
    seo?: number;
    geo?: number;
    web?: number;
    conversion?: number;
    reputation?: number;
  };
  topInsight?: string;
  competitorCount?: number;
}

function getScoreColor(score: number): string {
  if (score >= 70) return '#1D9E75';
  if (score >= 40) return '#BA7517';
  return '#E24B4A';
}

function getScoreLabel(score: number): string {
  if (score >= 70) return 'Bueno';
  if (score >= 40) return 'Mejorable';
  return 'Necesita atención';
}

function buildScoreBar(label: string, value: number): string {
  const color = getScoreColor(value);
  const width = Math.max(value, 5);
  return `
    <tr>
      <td style="padding:4px 12px 4px 0;font-size:13px;color:#666;width:100px;">${label}</td>
      <td style="padding:4px 0;">
        <div style="background:#f0f0f0;border-radius:4px;height:20px;width:100%;overflow:hidden;">
          <div style="background:${color};height:100%;width:${width}%;border-radius:4px;"></div>
        </div>
      </td>
      <td style="padding:4px 0 4px 8px;font-size:13px;font-weight:600;color:${color};width:40px;text-align:right;">${value}</td>
    </tr>`;
}

function buildEmailHtml(data: PostAuditEmailData): string {
  const scoreColor = getScoreColor(data.score);
  const scoreLabel = getScoreLabel(data.score);
  const reportUrl = `${SITE_URL}/es/audit/${data.auditId}`;
  const radarUrl = `${SITE_URL}/dashboard/onboarding`;
  const bd = data.scoreBreakdown || {};

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f7f9ff;">

  <!-- Header -->
  <div style="background:#0F1B35;padding:32px 24px;text-align:center;">
    <img src="${SITE_URL}/images/aion-logo-full.png" alt="AION Growth Studio" style="height:48px;width:auto;" />
  </div>

  <!-- Body -->
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">

    <!-- Score Hero -->
    <div style="background:white;border-radius:16px;padding:32px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:24px;">
      <p style="font-size:13px;color:#888;margin:0 0 8px;">Tu Score de Presencia Digital</p>
      <div style="display:inline-block;width:100px;height:100px;border-radius:50%;border:6px solid ${scoreColor};line-height:88px;font-size:36px;font-weight:900;color:${scoreColor};">
        ${data.score}
      </div>
      <p style="font-size:14px;font-weight:700;color:${scoreColor};margin:12px 0 4px;">${scoreLabel}</p>
      <p style="font-size:22px;font-weight:800;color:#1A1A2E;margin:8px 0 4px;">${data.domain}</p>
      <p style="font-size:13px;color:#888;margin:0;">Analisis completado</p>
    </div>

    <!-- Breakdown -->
    ${bd.seo != null ? `
    <div style="background:white;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:24px;">
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin:0 0 16px;">Desglose por area</p>
      <table style="width:100%;border-collapse:collapse;">
        ${bd.seo != null ? buildScoreBar('SEO', bd.seo) : ''}
        ${bd.geo != null ? buildScoreBar('Visibilidad IA', bd.geo) : ''}
        ${bd.web != null ? buildScoreBar('Web', bd.web) : ''}
        ${bd.conversion != null ? buildScoreBar('Conversion', bd.conversion) : ''}
        ${bd.reputation != null ? buildScoreBar('Reputacion', bd.reputation) : ''}
      </table>
    </div>
    ` : ''}

    <!-- Top Insight -->
    ${data.topInsight ? `
    <div style="background:#FFF8E1;border-left:4px solid #BA7517;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px;">
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;color:#BA7517;margin:0 0 4px;">Insight principal</p>
      <p style="font-size:14px;color:#1A1A2E;margin:0;line-height:1.5;">${data.topInsight}</p>
    </div>
    ` : ''}

    <!-- CTA: Ver informe -->
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${reportUrl}" style="display:inline-block;background:#1A4B8C;color:white;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">
        Ver informe completo
      </a>
    </div>

    <!-- CTA: Radar -->
    <div style="background:#0F1B35;border-radius:12px;padding:28px;text-align:center;margin-bottom:24px;">
      <p style="font-size:18px;font-weight:800;color:white;margin:0 0 8px;">Monitoriza estos KPIs semanalmente</p>
      <p style="font-size:13px;color:#94a3b8;margin:0 0 20px;line-height:1.5;">
        Activa AION Radar y ve como evolucionan tu SEO, visibilidad IA y competidores cada semana.
      </p>
      <a href="${radarUrl}" style="display:inline-block;background:#69ff87;color:#002108;padding:12px 28px;border-radius:9999px;font-size:14px;font-weight:700;text-decoration:none;">
        Activar AION Radar
      </a>
      <p style="font-size:11px;color:#64748b;margin:12px 0 0;">Desde 149€/mes · Sin permanencia</p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:24px 0;border-top:1px solid #e8e8e8;">
      <p style="font-size:11px;color:#aaa;margin:0;">
        Has recibido este email porque solicitaste un diagnostico en AION Growth Studio.
        <br />Si no fuiste tu, ignora este mensaje.
      </p>
    </div>

  </div>
</body>
</html>`;
}

export async function sendPostAuditEmail(data: PostAuditEmailData): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log('[email:post-audit] RESEND_API_KEY not configured — skipping');
    return false;
  }

  if (isTestEmail(data.to)) {
    console.log(`[email:post-audit] Skipped (test email): ${data.to}`);
    return false;
  }

  try {
    const resend = new Resend(RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: data.to,
      subject: `Tu Score de Presencia Digital: ${data.score}/100 — ${data.domain}`,
      html: buildEmailHtml(data),
    });

    if (error) {
      console.error('[email:post-audit] Resend error:', error);
      return false;
    }

    console.log(`[email:post-audit] Sent to ${data.to} — score ${data.score} for ${data.domain}`);
    return true;
  } catch (err) {
    console.error('[email:post-audit] Failed:', (err as Error).message);
    return false;
  }
}
