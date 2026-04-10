export const prerender = false;

import type { APIRoute } from 'astro';

/**
 * GET /api/audit/pdf?id=xxx
 *
 * Renders the print-friendly audit page with Puppeteer and returns a real PDF.
 * Uses @sparticuz/chromium for Vercel serverless compatibility.
 */
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const auditId = url.searchParams.get('id');

  if (!auditId) {
    return new Response(JSON.stringify({ error: 'id parameter required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Dynamic imports — these are heavy and only loaded when PDF is requested
    const chromium = await import('@sparticuz/chromium');
    const puppeteer = await import('puppeteer-core');

    // Determine the print page URL
    const host = request.headers.get('host') || 'localhost:4321';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const printUrl = `${protocol}://${host}/es/audit/${auditId}/pdf`;

    // Launch headless browser
    const browser = await puppeteer.default.launch({
      args: chromium.default.args,
      defaultViewport: { width: 1200, height: 800 },
      executablePath: await chromium.default.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();

    // Set longer timeout for slow pages
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for any animations/fonts to settle
    await page.waitForTimeout(1000);

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width:100%;text-align:center;font-size:8px;color:#94a3b8;font-family:sans-serif;padding:0 20mm;">
          <span>AION Growth Studio — Diagnóstico de Presencia Digital</span>
          <span style="float:right;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
        </div>
      `,
    });

    await browser.close();

    // Extract domain from audit URL for filename
    let domain = 'audit';
    try {
      const { getAuditPage } = await import('../../../lib/audit/supabase-storage');
      const audit = await getAuditPage(auditId);
      domain = new URL(audit.url).hostname.replace(/^www\./, '');
    } catch { /* use default */ }

    const filename = `AION-Diagnostico-${domain}-${new Date().toISOString().slice(0, 10)}.pdf`;

    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err: any) {
    console.error('[pdf] Generation failed:', err.message);
    return new Response(JSON.stringify({ error: 'PDF generation failed', detail: err.message?.slice(0, 200) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
