export type AuditStep =
  | 'crawl'
  | 'ssl'
  | 'pagespeed'
  | 'sector'
  | 'content'
  | 'geo'
  | 'instagram'
  | 'linkedin'
  | 'gbp'
  | 'traffic'
  | 'seo'
  | 'seo_pages'
  | 'competitors'
  | 'competitor_traffic'
  | 'keyword_gap'
  | 'techstack'
  | 'conversion'
  | 'score'
  | 'insights';

export type AuditStepOrDone = AuditStep | 'done';
export type AuditStatus = 'processing' | 'completed' | 'error';

export const STEP_ORDER: AuditStep[] = [
  'crawl', 'ssl', 'pagespeed', 'sector', 'content', 'geo',
  'gbp', 'traffic', 'seo', 'seo_pages', 'competitors', 'competitor_traffic', 'keyword_gap',
  'instagram', 'linkedin', 'techstack', 'conversion', 'score', 'insights',
];

export const STEP_PROGRESS: Record<AuditStep, number> = {
  crawl: 6,
  ssl: 12,
  pagespeed: 18,
  sector: 24,
  content: 30,
  geo: 36,
  gbp: 42,
  traffic: 47,
  seo: 50,
  seo_pages: 54,
  competitors: 57,
  competitor_traffic: 60,
  keyword_gap: 63,
  instagram: 66,
  linkedin: 69,
  techstack: 74,
  conversion: 80,
  score: 90,
  insights: 100,
};

export const NEXT_STEP: Record<AuditStep, AuditStepOrDone> = {
  crawl: 'ssl',
  ssl: 'pagespeed',
  pagespeed: 'sector',
  sector: 'content',
  content: 'geo',
  geo: 'gbp',
  gbp: 'traffic',
  traffic: 'seo',
  seo: 'seo_pages',
  seo_pages: 'competitors',
  competitors: 'competitor_traffic',
  competitor_traffic: 'keyword_gap',
  keyword_gap: 'instagram',
  instagram: 'linkedin',
  linkedin: 'techstack',
  techstack: 'conversion',
  conversion: 'score',
  score: 'insights',
  insights: 'done',
};

export interface ModuleResult {
  skipped?: boolean;
  error?: string;
  reason?: string;
  [key: string]: any;
}

export interface HreflangAlternate {
  hreflang: string;
  href: string;
  domain: string;
}

/** Detected digital business model — informs report framing and diagnostic copy */
export type BusinessType = 'ecommerce' | 'saas' | 'b2b' | 'local' | 'media' | 'unknown';

export interface CrawlResult extends ModuleResult {
  title?: string;
  description?: string;
  h1s?: string[];
  h2Count?: number;
  imageCount?: number;
  imagesWithAlt?: number;
  hasCanonical?: boolean;
  hasRobots?: boolean;
  hasSitemap?: boolean;
  hasSchemaMarkup?: boolean;
  schemaTypes?: string[];
  internalLinks?: number;
  wordCount?: number;
  loadedOk?: boolean;
  instagramHandle?: string;
  twitterHandle?: string;
  linkedinUrl?: string;
  hreflangAlternates?: HreflangAlternate[];
  businessType?: BusinessType;
}

export interface SSLResult extends ModuleResult {
  valid?: boolean;
  issuer?: string;
  expiresAt?: string;
  daysUntilExpiry?: number;
  protocol?: string;
}

export interface PageSpeedScore {
  performance: number;
  accessibility: number;
  seo: number;
  bestPractices: number;
  lcp?: number;
  cls?: number;
  fcp?: number;
  ttfb?: number;
}

export interface PageSpeedResult extends ModuleResult {
  mobile?: PageSpeedScore;
  desktop?: PageSpeedScore;
}

export interface SectorResult extends ModuleResult {
  sector?: string;
  confidence?: number;
  keywords?: string[];
  rationale?: string;
}

export interface ContentResult extends ModuleResult {
  clarity?: number;
  valueProposition?: string;
  audienceMatch?: string;
  cta?: string;
  weaknesses?: string[];
  strengths?: string[];
}

export interface GeoQuery {
  query: string;
  mentioned: boolean;
  isBrandQuery?: boolean;
  context?: string;     // First 180 chars of answer when mentioned
  answer?: string;      // First 150 chars of answer when NOT mentioned (for debugging)
  level?: number;        // 1=sector, 2=value prop, 3=keywords, 4=direct brand
  levelLabel?: string;  // Human-readable label for this funnel level
  pts?: number;         // Points awarded at this level
}

export interface GeoResult extends ModuleResult {
  queries?: GeoQuery[];
  overallScore?: number;
  brandScore?: number;
  sectorScore?: number;
}

export interface InstagramPost {
  likes: number;
  comments: number;
}

export interface InstagramCompetitor {
  handle: string;
  followers?: number;
  posts?: number;
  engagementRate?: number;
  url: string;
}

export interface InstagramResult extends ModuleResult {
  found?: boolean;
  handle?: string;
  url?: string;
  followers?: number;
  following?: number;
  posts?: number;
  bio?: string;
  isVerified?: boolean;
  isBusinessAccount?: boolean;
  businessCategory?: string;
  engagementRate?: number;
  avgLikes?: number;
  avgComments?: number;
  competitors?: InstagramCompetitor[];
}

export interface LinkedInCompetitor {
  name: string;
  url: string;
  followers?: number;
  employees?: string;
}

export interface LinkedInResult extends ModuleResult {
  found?: boolean;
  url?: string;
  name?: string;
  followers?: number;
  employees?: string;
  description?: string;
  industry?: string;
  headquarters?: string;
  competitors?: LinkedInCompetitor[];
}

export interface GBPResult extends ModuleResult {
  found?: boolean;
  name?: string;
  rating?: number;
  reviewCount?: number;
  address?: string;
  categories?: string[];
}

export interface Competitor {
  name: string;
  url: string;
  snippet: string;
}

export interface CompetitorsResult extends ModuleResult {
  competitors?: Competitor[];
}

export interface CompetitorTrafficItem {
  name: string;
  domain: string;
  url: string;
  domainRank?: number;
  organicTrafficEstimate?: number;
  estimatedAdsCost?: number;
  keywordsTop10?: number;
}

export interface CompetitorTrafficResult extends ModuleResult {
  items?: CompetitorTrafficItem[];
}

// ── 6-pillar score breakdown ──────────────────────────────────────
export interface ScoreBreakdown {
  technical: number;      // Pilar 1: Fundamentos técnicos (15%)
  seoVisibility: number;  // Pilar 2: Visibilidad orgánica (25%)
  content: number;        // Pilar 3: Contenido y propuesta de valor (20%)
  socialReputation: number; // Pilar 4: Presencia social y reputación (15%)
  conversion: number;     // Pilar 5: Capacidad de conversión (15%)
  measurement: number;    // Pilar 6: Datos y medición (10%)
}

export interface ScoreResult extends ModuleResult {
  total?: number;
  breakdown?: ScoreBreakdown;
}

export interface TrafficChannel {
  visits?: number;
  share?: number;
}

export interface TrafficCountry {
  code: string;
  name: string;
  share: number;
}

export interface TrafficResult extends ModuleResult {
  visits?: number;
  visitsGrowth?: number;
  bounceRate?: number;
  pagesPerVisit?: number;
  avgSessionDuration?: number;
  channels?: {
    organic?: TrafficChannel;
    direct?: TrafficChannel;
    social?: TrafficChannel;
    referral?: TrafficChannel;
    paid?: TrafficChannel;
    email?: TrafficChannel;
  };
  topCountries?: TrafficCountry[];
}

export interface InsightsInitiative {
  title: string;
  description: string;
}

export interface InsightsResult extends ModuleResult {
  bullets?: string[];
  initiatives?: InsightsInitiative[];
}

// ── New: Pilar 6 — Tech Stack & Measurement ──────────────────────
export interface TechStackResult extends ModuleResult {
  analytics?: string[];
  tagManager?: string[];
  conversionPixels?: string[];
  crmAutomation?: string[];
  chatSupport?: string[];
  heatmaps?: string[];
  cms?: string;
  maturityScore?: number; // 0-100
  allTools?: string[];
}

// ── New: Pilar 5 — Conversion ─────────────────────────────────────
export interface ConversionResult extends ModuleResult {
  hasContactForm?: boolean;
  formCount?: number;
  formFieldCount?: number;
  hasCTA?: boolean;
  ctaCount?: number;
  hasLeadMagnet?: boolean;
  hasTestimonials?: boolean;
  hasPricing?: boolean;
  hasVideo?: boolean;
  hasChatWidget?: boolean;
  funnelScore?: number;   // 0-100
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
}

// ── New: Pilar 2 enrichment — DataForSEO ─────────────────────────
export interface SEOResult extends ModuleResult {
  organicKeywordsTotal?: number;    // total keywords ranking
  keywordsTop3?: number;            // positions 1-3
  keywordsPos4to10?: number;        // positions 4-10 (quick wins)
  keywordsTop10?: number;           // positions 1-10
  keywordsTop30?: number;           // positions 1-30
  organicTrafficEstimate?: number;  // estimated monthly organic visits
  estimatedAdsCost?: number;        // Google Ads equivalent cost of organic traffic (€/mo)
  trendUp?: number;                 // keywords gaining positions recently
  trendDown?: number;               // keywords losing positions recently
  trendLost?: number;               // keywords lost from top 100 recently
  topKeywords?: Array<{ keyword: string; position: number; volume: number }>; // top non-branded keywords
}

// ── New: SEO top pages ─────────────────────────────────────────────
export interface SeoPageItem {
  pageAddress: string;
  trafficEstimate?: number;
  keywords?: number;
  topPosition?: number;
}

export interface SeoPagesResult extends ModuleResult {
  pages?: SeoPageItem[];
}

// ── New: Keyword gap vs competitors ───────────────────────────────
export interface KeywordGapItem {
  keyword: string;
  searchVolume?: number;
  competitorPosition?: number;
}

export interface KeywordGapResult extends ModuleResult {
  competitor?: string;
  items?: KeywordGapItem[];
}

export interface AuditPageData {
  notionPageId: string;
  url: string;
  email: string;
  status: AuditStatus;
  currentStep: AuditStepOrDone;
  score?: number;
  sector?: string;
  userInstagram?: string;
  userLinkedin?: string;
  userCompetitors?: string[];
  results: Record<string, ModuleResult>;
}
