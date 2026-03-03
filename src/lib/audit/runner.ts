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
import { runTechStack } from './modules/techstack';
import { runConversion } from './modules/conversion';
import { runScore } from './modules/score';
import { runInsights } from './modules/insights';
import { NEXT_STEP } from './types';
import type { AuditStep, AuditStepOrDone, ModuleResult, AuditPageData } from './types';

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

      case 'instagram': {
        const competitorUrls = (results.competitors as any)?.competitors?.map((c: any) => c.url) || [];
        result = await runInstagram(results.crawl || {}, competitorUrls, audit.userInstagram);
        break;
      }

      case 'linkedin': {
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
