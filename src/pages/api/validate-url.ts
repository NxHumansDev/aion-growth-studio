export const prerender = false;

import type { APIRoute } from 'astro';

/**
 * GET /api/validate-url?url=https://example.com
 *
 * Checks if a URL is reachable. Order of attempts:
 *   1. HEAD with a real browser User-Agent (10s timeout)
 *   2. If HEAD returns 4xx/405 OR network-level error, fall back to GET
 *      with the same UA (some WAF/CDN setups refuse HEAD).
 *
 * Rationale: the previous version used 'Mozilla/5.0 (compatible;
 * AIONBot/1.0)' + 5s timeout and marked valid sites as unreachable when
 * served via Cloudflare — the "Bot" substring in the UA triggers bot
 * detection on Vercel's egress IPs, but works fine locally. Real browser
 * UA bypasses that heuristic.
 */

// Real Chrome UA — gets through Cloudflare/Akamai bot gates without
// pretending to be someone's specific browser.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TIMEOUT_MS = 10_000;

async function probe(url: string, method: 'HEAD' | 'GET'): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
    });
    // Drain the body only for GET so the socket closes cleanly.
    if (method === 'GET') await res.arrayBuffer().catch(() => null);
    return { ok: res.status < 500 && res.status !== 404, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

export const GET: APIRoute = async ({ url: reqUrl }) => {
  const target = reqUrl.searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const normalized = target.startsWith('http') ? target : `https://${target}`;
  try { new URL(normalized); }
  catch {
    return new Response(JSON.stringify({ reachable: false, error: 'Invalid URL format', url: target }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Attempt 1: HEAD. Some servers return 405 Method Not Allowed for HEAD even
  // when the domain is healthy — we treat those as "retry with GET".
  try {
    const head = await probe(normalized, 'HEAD');
    if (head.ok && head.status !== 405 && head.status !== 403) {
      return new Response(JSON.stringify({ reachable: true, status: head.status, url: normalized }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    // Fall through to GET for 403/405/other odd responses
  } catch { /* fall through to GET */ }

  try {
    const get = await probe(normalized, 'GET');
    return new Response(JSON.stringify({ reachable: get.ok, status: get.status, url: normalized }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      reachable: false,
      error: err.name === 'AbortError' ? 'Timeout' : 'Unreachable',
      url: normalized,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};
