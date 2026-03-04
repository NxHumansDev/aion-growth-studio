import { runCrawl } from './modules/crawl';
import { runSSL } from './modules/ssl';
import { runPageSpeed } from './modules/pagespeed';
import { runSector } from './modules/sector';
import { runContent } from './modules/content';
import { runGEO } from './modules/geo';
import { runInstagram } from './modules/instagram';
import { runLinkedIn } from './modules/linkedin';
import { runGBP } from './modules/gbp';
import { runTraffic } from './modules/traffic';
import { runSEO } from './modules/seo';
import { runCompetitors } from './modules/competitors';
import { runCompetitorTraffic } from './modules/competitor-traffic';
import { runTechStack } from './modules/techstack';
import { runConversion } from './modules/conversion';
import { runScore } from './modules/score';
import { runInsights } from './modules/insights';
import { NEXT_STEP } from './types';
import type { AuditStep, AuditStepOrDone, ModuleResult, AuditPageData, CrawlResult } from './types';

const APPS_SCRIPT_SOCIAL_WEBHOOK =
  import.meta.env.APPS_SCRIPT_SOCIAL_WEBHOOK || process.env.APPS_SCRIPT_SOCIAL_WEBHOOK;

/**
 * Fire-and-forget: asks Google Apps Script (residential Google IP) to scrape
 * Instagram and LinkedIn and write results directly to the Notion audit page.
 * By the time the audit reaches the instagram/linkedin steps (~3 min later),
 * the data is already in Notion and the steps just read it.
 */
function triggerSocialPrefetch(pageId: string, crawl: CrawlResult): void {
  if (!APPS_SCRIPT_SOCIAL_WEBHOOK) return;
  if (!crawl.instagramHandle && !crawl.linkedinUrl) return;

  fetch(APPS_SCRIPT_SOCIAL_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pageId,
      instagramHandle: crawl.instagramHandle || null,
      linkedinUrl: crawl.linkedinUrl || null,
    }),
  }).catch(() => { /* intentionally ignored — Apps Script runs independently */ });
}

export interface StepExecution {
  result: ModuleResult;
  moduleKey: string;
  nextStep: AuditStepOrDone;
}

export async function executeStep(step: AuditStep, audit: AuditPageData): Promise<StepExecution> {
  const { url, results } = audit;
  const nextStep = NEXT_STEP[step];

  let result: ModuleResult;

  try {
    switch (step) {
      case 'crawl':
        result = await runCrawl(url);
        triggerSocialPrefetch(audit.notionPageId, result as CrawlResult);
        break;

      case 'ssl':
        result = await runSSL(url);
        break;

      case 'pagespeed':
        result = await runPageSpeed(url);
        break;

      case 'sector':
        result = await runSector(url, results.crawl || {});
        break;

      case 'content':
        result = await runContent(url, results.crawl || {});
        break;

      case 'geo': {
        const sector = (results.sector as any)?.sector || 'business services';
        result = await runGEO(url, sector, results.crawl || {});
        break;
      }

      case 'gbp':
        result = await runGBP(url, results.crawl || {});
        break;

      case 'traffic':
        result = await runTraffic(url);
        break;

      case 'seo':
        result = await runSEO(url);
        break;

      case 'competitors': {
        const sector = (results.sector as any)?.sector || 'business services';
        result = await runCompetitors(url, sector, results.crawl || {}, audit.userCompetitors);
        break;
      }

      case 'competitor_traffic': {
        const comps: Array<{ name: string; url: string }> =
          (results.competitors as any)?.competitors || [];
        result = await runCompetitorTraffic(comps);
        break;
      }

      case 'instagram': {
        // If Apps Script already wrote the result to Notion, use it directly
        if (results.instagram) { result = results.instagram; break; }
        const competitorUrls = (results.competitors as any)?.competitors?.map((c: any) => c.url) || [];
        result = await runInstagram(results.crawl || {}, competitorUrls, audit.userInstagram);
        break;
      }

      case 'linkedin': {
        // If Apps Script already wrote the result to Notion, use it directly
        if (results.linkedin) { result = results.linkedin; break; }
        const competitorUrls = (results.competitors as any)?.competitors?.map((c: any) => c.url) || [];
        result = await runLinkedIn(results.crawl || {}, competitorUrls, audit.userLinkedin);
        break;
      }

      case 'techstack':
        result = await runTechStack(url);
        break;

      case 'conversion':
        result = await runConversion(url, results.crawl || {});
        break;

      case 'score':
        result = await runScore(results);
        break;

      case 'insights':
        result = await runInsights(url, results);
        break;

      default:
        result = { skipped: true, reason: `Unknown step: ${step}` };
    }
  } catch (err: any) {
    result = {
      error: err.message?.slice(0, 150) || 'Module failed unexpectedly',
    };
  }

  return { result, moduleKey: step, nextStep };
}
