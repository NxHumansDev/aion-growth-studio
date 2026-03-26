/**
 * LLM utility: structured JSON calls with validation + retry.
 * No external dependencies — manual schema validation.
 */

const ANTHROPIC_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

// ── Schema validators ─────────────────────────────────────────────

export interface CompetitorsSchema {
  competitors: Array<{ name: string; url: string; snippet: string }>;
}

export interface SectorSchema {
  sector: string;
  confidence: number;
  keywords?: string[];
  rationale?: string;
  subsector?: string;
}

export interface ContentAnalysisSchema {
  clarity: number;
  valueProposition: string;
  audienceMatch?: string;
  cta?: string;
  strengths?: string[];
  weaknesses?: string[];
}

export interface ConversionSchema {
  funnelScore: number;
  hasContactForm: boolean;
  formCount?: number;
  formFieldCount?: number;
  hasCTA: boolean;
  ctaCount?: number;
  hasLeadMagnet?: boolean;
  hasTestimonials?: boolean;
  hasPricing?: boolean;
  hasVideo?: boolean;
  hasChatWidget?: boolean;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
}

function validateCompetitors(obj: any): obj is CompetitorsSchema {
  return (
    obj &&
    Array.isArray(obj.competitors) &&
    obj.competitors.length >= 1 &&
    obj.competitors.every(
      (c: any) =>
        typeof c.name === 'string' &&
        typeof c.url === 'string' &&
        c.url.length > 4,
    )
  );
}

function validateSector(obj: any): obj is SectorSchema {
  return (
    obj &&
    typeof obj.sector === 'string' &&
    obj.sector.length > 0 &&
    typeof obj.confidence === 'number'
  );
}

function validateContentAnalysis(obj: any): obj is ContentAnalysisSchema {
  return (
    obj &&
    typeof obj.clarity === 'number' &&
    obj.clarity >= 0 &&
    obj.clarity <= 100 &&
    typeof obj.valueProposition === 'string'
  );
}

function validateConversion(obj: any): obj is ConversionSchema {
  return (
    obj &&
    typeof obj.funnelScore === 'number' &&
    obj.funnelScore >= 0 &&
    obj.funnelScore <= 100
  );
}

const VALIDATORS = {
  competitors: validateCompetitors,
  sector: validateSector,
  content: validateContentAnalysis,
  conversion: validateConversion,
} as const;

type SchemaName = keyof typeof VALIDATORS;
type SchemaMap = {
  competitors: CompetitorsSchema;
  sector: SectorSchema;
  content: ContentAnalysisSchema;
  conversion: ConversionSchema;
};

// ── LLM caller ───────────────────────────────────────────────────

function cleanJson(raw: string): string {
  return raw
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();
}

/**
 * Call Claude Haiku with a prompt and validate the JSON output against a named schema.
 * Retries up to maxRetries times with progressively stricter prompts.
 */
export async function callHaikuWithValidation<T extends SchemaName>(
  schemaName: T,
  userPrompt: string,
  timeoutMs = 15000,
  maxRetries = 1,
): Promise<SchemaMap[T] | null> {
  if (!ANTHROPIC_KEY) return null;

  const validator = VALIDATORS[schemaName] as (obj: any) => boolean;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 700,
          system: 'Respond ONLY with valid JSON. No markdown, no backticks, no explanation. Just the JSON object.',
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!res.ok) {
        console.warn(`[llm-utils] ${schemaName} attempt ${attempt + 1}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const raw: string = data?.content?.[0]?.text || '';
      const cleaned = cleanJson(raw);

      // Try object match first, then array
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/) || cleaned.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn(`[llm-utils] ${schemaName} attempt ${attempt + 1}: no JSON in response`);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (validator(parsed)) {
        return parsed as SchemaMap[T];
      }

      console.warn(`[llm-utils] ${schemaName} attempt ${attempt + 1}: schema validation failed`, JSON.stringify(parsed).slice(0, 100));
    } catch (err: any) {
      console.warn(`[llm-utils] ${schemaName} attempt ${attempt + 1} error: ${err.message?.slice(0, 80)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}
