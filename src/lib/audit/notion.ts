import { Client } from '@notionhq/client';
import type { AuditStatus, AuditStepOrDone, ModuleResult, AuditPageData } from './types';

const notion = new Client({ auth: import.meta.env.NOTION_TOKEN || process.env.NOTION_TOKEN });
const AUDITS_DB_ID = import.meta.env.NOTION_AUDITS_DB_ID || process.env.NOTION_AUDITS_DB_ID;

export async function createAuditPage(
  url: string,
  email: string,
  opts?: { instagram?: string; linkedin?: string; competitors?: string[] },
): Promise<string> {
  const hostname = new URL(url).hostname.replace(/^www\./, '');

  const properties: any = {
    Name: { title: [{ text: { content: hostname } }] },
    Email: { email },
    Status: { select: { name: 'processing' } },
    'Current Step': { select: { name: 'crawl' } },
    URL: { url },
    Created: { date: { start: new Date().toISOString() } },
  };

  if (opts?.instagram) {
    properties['Instagram'] = { rich_text: [{ text: { content: opts.instagram.slice(0, 100) } }] };
  }
  if (opts?.linkedin) {
    properties['LinkedIn'] = { url: opts.linkedin };
  }
  if (opts?.competitors?.length) {
    properties['Competitors Input'] = {
      rich_text: [{ text: { content: JSON.stringify(opts.competitors).slice(0, 2000) } }],
    };
  }

  const page = await notion.pages.create({
    parent: { database_id: AUDITS_DB_ID },
    properties,
  } as any);

  return page.id;
}

export async function getAuditPage(pageId: string): Promise<AuditPageData> {
  const [page, blocksResponse] = await Promise.all([
    notion.pages.retrieve({ page_id: pageId }),
    notion.blocks.children.list({ block_id: pageId }),
  ]);

  const props = (page as any).properties;
  const status: AuditStatus = props['Status']?.select?.name || 'processing';
  const currentStep: AuditStepOrDone = props['Current Step']?.select?.name || 'crawl';
  const score: number | undefined = props['Score']?.number ?? undefined;
  const sector: string | undefined = props['Sector']?.rich_text?.[0]?.plain_text ?? undefined;
  const url: string = props['URL']?.url || '';
  const email: string = props['Email']?.email || '';
  const userInstagram: string | undefined = props['Instagram']?.rich_text?.[0]?.plain_text || undefined;
  const userLinkedin: string | undefined = props['LinkedIn']?.url || undefined;
  const competitorsRaw: string | undefined = props['Competitors Input']?.rich_text?.[0]?.plain_text || undefined;
  let userCompetitors: string[] | undefined;
  if (competitorsRaw) {
    try { userCompetitors = JSON.parse(competitorsRaw); } catch { /* ignore */ }
  }

  // Parse results from code blocks (each block = {"m": "module", "d": {...}})
  const results: Record<string, ModuleResult> = {};
  for (const block of blocksResponse.results as any[]) {
    if (block.type === 'code') {
      const text: string = block.code?.rich_text?.map((t: any) => t.plain_text).join('') || '';
      try {
        const parsed = JSON.parse(text);
        if (parsed.m && parsed.d !== undefined) {
          results[parsed.m] = parsed.d;
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  return { notionPageId: pageId, url, email, status, currentStep, score, sector, userInstagram, userLinkedin, userCompetitors, results };
}

export async function saveModuleResult(
  pageId: string,
  moduleKey: string,
  moduleResult: ModuleResult,
  nextStep: AuditStepOrDone,
  extraProps?: { score?: number; sector?: string },
): Promise<void> {
  const content = prepareBlockContent(moduleKey, moduleResult);

  // Append result block to page
  await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content } }],
          language: 'json',
        },
      },
    ] as any[],
  });

  // Update page properties
  const properties: any = {
    'Current Step': { select: { name: nextStep } },
  };

  if (nextStep === 'done') {
    properties['Status'] = { select: { name: 'completed' } };
    properties['Completed'] = { date: { start: new Date().toISOString() } };
  }

  if (extraProps?.score !== undefined) {
    properties['Score'] = { number: extraProps.score };
  }

  if (extraProps?.sector) {
    properties['Sector'] = {
      rich_text: [{ text: { content: extraProps.sector.slice(0, 2000) } }],
    };
  }

  await notion.pages.update({ page_id: pageId, properties });
}

/** Save multiple module results from a parallel phase in one Notion operation */
export async function savePhaseResults(
  pageId: string,
  moduleResults: Array<{ moduleKey: string; result: ModuleResult }>,
  nextStep: AuditStepOrDone,
  extraProps?: { score?: number; sector?: string },
): Promise<void> {
  // Batch-append all result blocks in a single Notion call (max 100 blocks — always safe here)
  const children = moduleResults.map(({ moduleKey, result }) => ({
    object: 'block',
    type: 'code',
    code: {
      rich_text: [{ type: 'text', text: { content: prepareBlockContent(moduleKey, result) } }],
      language: 'json',
    },
  }));

  await notion.blocks.children.append({ block_id: pageId, children: children as any[] });

  const properties: any = { 'Current Step': { select: { name: nextStep } } };
  if (nextStep === 'done') {
    properties['Status'] = { select: { name: 'completed' } };
    properties['Completed'] = { date: { start: new Date().toISOString() } };
  }
  if (extraProps?.score !== undefined) properties['Score'] = { number: extraProps.score };
  if (extraProps?.sector) {
    properties['Sector'] = { rich_text: [{ text: { content: extraProps.sector.slice(0, 2000) } }] };
  }

  await notion.pages.update({ page_id: pageId, properties });
}

export async function markAuditError(pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: { Status: { select: { name: 'error' } } },
  });
}

function prepareBlockContent(module: string, data: ModuleResult): string {
  const str = JSON.stringify({ m: module, d: data });
  if (str.length <= 1990) return str;

  // GEO module: use stage-aware truncation to preserve all funnel stages
  if (module === 'geo') {
    const geoTruncated = truncateGeo(data);
    const candidate = JSON.stringify({ m: module, d: geoTruncated });
    if (candidate.length <= 1990) return candidate;
  }

  // Progressive truncation — each pass more aggressive than the last
  // Always produces valid JSON (never bare slice)
  for (const maxStr of [120, 80, 40]) {
    const truncated = truncateData(data, maxStr);
    const candidate = JSON.stringify({ m: module, d: truncated });
    if (candidate.length <= 1990) return candidate;
  }

  // Nuclear: just flag it as truncated so parsing doesn't fail silently
  return JSON.stringify({ m: module, d: { _truncated: true } });
}

/**
 * GEO-specific truncation: preserve at least 1 query per funnel stage so the
 * report always has TOFU, MOFU and BOFU data — even when Notion's 2000-char
 * limit forces a cut. Generic truncateData() simply takes the first N items,
 * which always cuts BOFU (positions 9-12) completely.
 */
function truncateGeo(data: any): any {
  const result: any = { ...data };

  if (Array.isArray(data.queries)) {
    // Keep 2 per stage + brand query — always prioritize mentioned:true entries
    // so the stored queries correctly reflect which ones were actually mentioned.
    // (Without this, truncation can drop all positive matches while mentionRate
    // still reflects the pre-truncation count → visual inconsistency in report.)
    const mFirst = (arr: any[]) => [
      ...arr.filter((q: any) => q.mentioned),
      ...arr.filter((q: any) => !q.mentioned),
    ];
    const tofu  = mFirst(data.queries.filter((q: any) => q.stage === 'tofu')).slice(0, 2);
    const mofu  = mFirst(data.queries.filter((q: any) => q.stage === 'mofu')).slice(0, 2);
    const bofu  = mFirst(data.queries.filter((q: any) => q.stage === 'bofu' && !q.isBrandQuery)).slice(0, 2);
    const brand = data.queries.filter((q: any) => q.isBrandQuery).slice(0, 1);
    result.queries = [...tofu, ...mofu, ...bofu, ...brand];
  }

  // Drop heavy/debug fields
  delete result._log;
  if (Array.isArray(result.crossModel)) {
    result.crossModel = result.crossModel.map((e: any) => ({ name: e.name, mentioned: e.mentioned, total: e.total }));
  }
  if (Array.isArray(result.competitorMentions)) {
    result.competitorMentions = result.competitorMentions.slice(0, 3).map((c: any) => ({
      name: c.name, domain: c.domain, mentions: c.mentions, total: c.total, mentionRate: c.mentionRate,
    }));
  }

  return result;
}

function truncateData(data: any, maxStr = 150): any {
  if (typeof data !== 'object' || data === null) return data;
  if (Array.isArray(data)) return data.slice(0, 5).map((v) => truncateData(v, maxStr));
  const result: any = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.length > maxStr) {
      result[key] = value.slice(0, maxStr) + '…';
    } else if (Array.isArray(value)) {
      result[key] = value.slice(0, 5).map((v) => truncateData(v, maxStr));
    } else if (typeof value === 'object' && value !== null) {
      result[key] = truncateData(value, maxStr);
    } else {
      result[key] = value;
    }
  }
  return result;
}
