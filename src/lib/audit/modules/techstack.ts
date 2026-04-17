import axios from 'axios';
import type { TechStackResult } from '../types';

type Category = 'analytics' | 'tagManager' | 'conversionPixels' | 'crmAutomation' | 'chatSupport' | 'heatmaps';

const TOOLS: Array<{ name: string; category: Category; patterns: string[] }> = [
  // Analytics
  { name: 'Google Analytics 4', category: 'analytics',
    patterns: ['gtag/js', 'googletagmanager.com/gtag', '"G-', "'G-", '/gtag/js?id=', 'measurementId":"G-', '"measurement_id":"G-',
      'data-ga="G-', 'data-analytics-id="G-', 'data-measurement-id="G-', 'ga_measurement_id'] },
  { name: 'Universal Analytics', category: 'analytics',
    patterns: ['analytics.js', "'UA-", '"UA-'] },
  { name: 'Plausible', category: 'analytics',
    patterns: ['plausible.io'] },
  { name: 'Matomo', category: 'analytics',
    patterns: ['matomo.js', 'piwik.js'] },
  { name: 'Mixpanel', category: 'analytics',
    patterns: ['cdn.mxpnl.com', 'mixpanel.com/lib'] },
  { name: 'Amplitude', category: 'analytics',
    patterns: ['cdn.amplitude.com'] },
  { name: 'Heap', category: 'analytics',
    patterns: ['heapanalytics.com'] },
  { name: 'Adobe Analytics', category: 'analytics',
    patterns: ['omniture', 'AppMeasurement.js', 'sc.js'] },

  // Tag Manager
  { name: 'Google Tag Manager', category: 'tagManager',
    patterns: ['googletagmanager.com/gtm.js', "'GTM-", '"GTM-'] },
  { name: 'Tealium', category: 'tagManager',
    patterns: ['tags.tiqcdn.com'] },
  { name: 'Segment', category: 'tagManager',
    patterns: ['cdn.segment.com', 'cdn.segment.io'] },

  // Conversion pixels
  { name: 'Meta Pixel', category: 'conversionPixels',
    patterns: ['connect.facebook.net', 'fbevents.js'] },
  { name: 'Google Ads', category: 'conversionPixels',
    patterns: ['googleadservices.com/pagead', "'AW-", '"AW-'] },
  { name: 'LinkedIn Insight', category: 'conversionPixels',
    patterns: ['snap.licdn.com', 'linkedin.com/px'] },
  { name: 'TikTok Pixel', category: 'conversionPixels',
    patterns: ['analytics.tiktok.com'] },
  { name: 'Twitter/X Pixel', category: 'conversionPixels',
    patterns: ['static.ads-twitter.com', 'ads.twitter.com/uwt.js'] },
  { name: 'Pinterest Tag', category: 'conversionPixels',
    patterns: ['s.pinimg.com/ct', 'pintrk('] },

  // CRM / Marketing Automation
  { name: 'HubSpot', category: 'crmAutomation',
    patterns: ['js.hs-scripts.com', 'hs-analytics.net', 'hubspot.com/embed'] },
  { name: 'Salesforce / Pardot', category: 'crmAutomation',
    patterns: ['pi.pardot.com', 'pardot.com/pd.js'] },
  { name: 'Marketo', category: 'crmAutomation',
    patterns: ['mktoweb.com', 'marketo.com/js/forms2'] },
  { name: 'ActiveCampaign', category: 'crmAutomation',
    patterns: ['trackcmp.net'] },
  { name: 'Mailchimp', category: 'crmAutomation',
    patterns: ['chimpstatic.com', 'list-manage.com'] },
  { name: 'Klaviyo', category: 'crmAutomation',
    patterns: ['static.klaviyo.com'] },
  { name: 'Brevo', category: 'crmAutomation',
    patterns: ['sibautomation.com', 'sendinblue.com'] },
  { name: 'Mailerlite', category: 'crmAutomation',
    patterns: ['ml-attr.com', 'mailerlite.com/js'] },

  // Chat / Support
  { name: 'Intercom', category: 'chatSupport',
    patterns: ['widget.intercom.io', 'js.intercomcdn.com'] },
  { name: 'Drift', category: 'chatSupport',
    patterns: ['js.driftt.com'] },
  { name: 'Crisp', category: 'chatSupport',
    patterns: ['client.crisp.chat'] },
  { name: 'Zendesk', category: 'chatSupport',
    patterns: ['static.zdassets.com', 'ekr.zdassets.com'] },
  { name: 'LiveChat', category: 'chatSupport',
    patterns: ['cdn.livechatinc.com'] },
  { name: 'Tidio', category: 'chatSupport',
    patterns: ['code.tidio.co'] },
  { name: 'Freshchat', category: 'chatSupport',
    patterns: ['wchat.freshchat.com'] },
  { name: 'Tawk.to', category: 'chatSupport',
    patterns: ['embed.tawk.to'] },

  // Heatmaps / UX tools
  { name: 'Hotjar', category: 'heatmaps',
    patterns: ['static.hotjar.com', 'script.hotjar.com'] },
  { name: 'Microsoft Clarity', category: 'heatmaps',
    patterns: ['clarity.ms'] },
  { name: 'FullStory', category: 'heatmaps',
    patterns: ['fullstory.com/s/fs.js'] },
  { name: 'Crazy Egg', category: 'heatmaps',
    patterns: ['cetrk.com', 'crazyfed.com'] },
  { name: 'Lucky Orange', category: 'heatmaps',
    patterns: ['luckyorange.com/v7/'] },
];

const CMS_SIGNATURES: Array<{ name: string; patterns: string[] }> = [
  { name: 'WordPress',    patterns: ['wp-content/', 'wp-includes/'] },
  { name: 'Shopify',      patterns: ['cdn.shopify.com', 'Shopify.theme'] },
  { name: 'Webflow',      patterns: ['assets.website-files.com', 'webflow.com/'] },
  { name: 'Wix',          patterns: ['static.wixstatic.com'] },
  { name: 'Squarespace',  patterns: ['squarespace-cdn.com', 'squarespace.com/s/static'] },
  { name: 'Framer',       patterns: ['framerusercontent.com'] },
  { name: 'HubSpot CMS',  patterns: ['hs-sites.com', 'hubspotpagebuilder.com'] },
  { name: 'PrestaShop',   patterns: ['/modules/blockcart/', 'prestashop'] },
  { name: 'Magento',      patterns: ['Mage.Cookies', 'magento'] },
  { name: 'Drupal',       patterns: ['sites/default/files', 'Drupal.settings'] },
  { name: 'Joomla',       patterns: ['/media/jui/', 'joomla'] },
];

export async function runTechStack(url: string, crawlData?: any): Promise<TechStackResult> {
  // If the crawler was blocked, we cannot detect tools from the HTML.
  // Return "not measurable" with a clear reason.
  if (crawlData?.crawlerBlocked) {
    return {
      skipped: false,
      crawlerBlocked: true,
      analytics: [],
      tagManager: [],
      conversionPixels: [],
      crmAutomation: [],
      chatSupport: [],
      heatmaps: [],
      maturityScore: undefined,
      _log: `blocked: ${crawlData.crawlerBlockedReason || 'crawler blocked'}`,
    } as any;
  }

  try {
    let res;
    const axiosCfg = {
      timeout: 90_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIONAuditBot/1.0)' },
      maxRedirects: 5,
      validateStatus: (s: number) => s < 500,
    };
    try {
      res = await axios.get(url, axiosCfg);
    } catch (sslErr: any) {
      if (sslErr.message?.includes('certificate') || sslErr.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        const https = await import('https');
        res = await axios.get(url, { ...axiosCfg, httpsAgent: new https.Agent({ rejectUnauthorized: false }) });
      } else throw sslErr;
    }

    const html = String(res.data);

    const result: TechStackResult = {
      analytics: [],
      tagManager: [],
      conversionPixels: [],
      crmAutomation: [],
      chatSupport: [],
      heatmaps: [],
      allTools: [],
    };

    for (const tool of TOOLS) {
      if (tool.patterns.some((p) => html.includes(p))) {
        result[tool.category]!.push(tool.name);
        result.allTools!.push(tool.name);
      }
    }

    // CMS detection (first match wins)
    for (const cms of CMS_SIGNATURES) {
      if (cms.patterns.some((p) => html.includes(p))) {
        result.cms = cms.name;
        break;
      }
    }

    // GTM inference: if GTM is detected but no analytics tool found in static HTML,
    // mark analytics as present via GTM. Tag managers load tracking scripts dynamically —
    // they never appear in the raw HTML fetch. Virtually all GTM deployments include GA4.
    if (result.tagManager!.length > 0 && result.analytics!.length === 0) {
      result.analytics!.push('Google Analytics (vía GTM)');
      result.allTools!.push('Google Analytics (vía GTM)');
    }

    // CMP inference: Consent Management Platforms (OneTrust, Cookiebot, CookieYes,
    // Didomi, Iubenda, Complianz) often hold GA4 measurement IDs in their config
    // blocks even when the actual gtag script is gated behind consent and doesn't
    // appear as a standard <script> tag. Extract "G-XXXXXXX" from the full HTML.
    const CMP_PATTERNS = ['onetrust.com', 'cookiebot.com', 'cookieyes.com', 'didomi.io', 'iubenda.com', 'complianz'];
    const hasCMP = CMP_PATTERNS.some(p => html.includes(p));
    if (hasCMP && result.analytics!.length === 0) {
      const ga4IdMatch = html.match(/\bG-[A-Z0-9]{6,12}\b/);
      if (ga4IdMatch) {
        result.analytics!.push('Google Analytics 4 (vía CMP)');
        result.allTools!.push('Google Analytics 4 (vía CMP)');
      }
    }

    // Shopify inference: Shopify injects its own analytics + pixel infrastructure
    if (result.cms === 'Shopify') {
      if (result.analytics!.length === 0) {
        result.analytics!.push('Shopify Analytics (nativo)');
        result.allTools!.push('Shopify Analytics (nativo)');
      }
      if (result.conversionPixels!.length === 0 && html.includes('shopify.com/checkouts')) {
        result.conversionPixels!.push('Shopify Conversion Tracking');
        result.allTools!.push('Shopify Conversion Tracking');
      }
    }

    // Detection method: tells downstream consumers (report, dashboard) how
    // reliable the "no analytics" verdict is.
    //   'direct'  — found standard gtag/GA4 patterns in raw HTML (high confidence)
    //   'inferred'— deduced from GTM/CMP/Shopify presence (medium-high confidence)
    //   'none'    — nothing found in static HTML (could still exist via JS/sGTM)
    const analyticsDetection: 'direct' | 'inferred' | 'none' =
      TOOLS.filter(t => t.category === 'analytics').some(t => t.patterns.some(p => html.includes(p)))
        ? 'direct'
        : result.analytics!.length > 0 ? 'inferred' : 'none';
    (result as any).analyticsDetection = analyticsDetection;

    // Maturity score:
    // Analytics (25) + TagManager (20) + Conversion pixels (20) + CRM/Automation (25) + Chat (10)
    // Heatmaps are a bonus (+5) but don't increase base score beyond 100
    let score = 0;
    if (result.analytics!.length > 0) score += 25;
    if (result.tagManager!.length > 0) score += 20;
    if (result.conversionPixels!.length > 0) score += 20;
    if (result.crmAutomation!.length > 0) score += 25;
    if (result.chatSupport!.length > 0) score += 10;
    result.maturityScore = Math.min(100, score);

    return result;
  } catch (err: any) {
    return { skipped: true, reason: err.message?.slice(0, 100) };
  }
}
