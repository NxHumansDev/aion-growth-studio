/**
 * Headless browser fallback for sites that block axios (Cloudflare JS challenge, etc.).
 *
 * Uses puppeteer-core + @sparticuz/chromium (same stack as the PDF endpoint).
 * Only invoked when the primary axios crawl detects a WAF block.
 *
 * Returns the fully-rendered HTML after JS execution, which is then parsed
 * by the same cheerio pipeline as the normal crawl.
 */

const BROWSER_TIMEOUT = 30_000; // 30s max for page load
const NAVIGATION_TIMEOUT = 25_000;

/**
 * Fetch a URL using a real headless Chrome browser.
 * Returns { html, finalUrl } or null if it fails.
 */
export async function browserCrawl(url: string): Promise<{ html: string; finalUrl: string } | null> {
  let browser: any = null;
  try {
    const chromium = await import('@sparticuz/chromium');
    const puppeteer = await import('puppeteer-core');

    browser = await puppeteer.default.launch({
      args: [
        ...chromium.default.args,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.default.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();

    // Realistic browser fingerprint
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    // Navigate and wait for network to settle (resolves JS challenges)
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: NAVIGATION_TIMEOUT,
    });

    // Small pause for any late-firing scripts
    await new Promise(r => setTimeout(r, 2000));

    const finalUrl = page.url();
    const html = await page.content();

    console.log(`[browser-crawl] OK: ${url} → ${html.length} chars, final=${finalUrl}`);
    return { html, finalUrl };
  } catch (err) {
    console.error(`[browser-crawl] Failed for ${url}: ${(err as Error).message}`);
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
