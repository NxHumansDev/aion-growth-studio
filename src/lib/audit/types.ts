export type AuditStep =
  | 'crawl'
  | 'ssl'
  | 'pagespeed'
  | 'sector'
  | 'content'
  | 'gbp'
  | 'reputation'
  | 'traffic'
  | 'seo'
  | 'seo_pages'
  | 'content_cadence'
  | 'competitors'
  | 'competitor_traffic'
  | 'keyword_gap'
  | 'geo'
  | 'competitor_pagespeed'
  | 'instagram'
  | 'linkedin'
  | 'techstack'
  | 'conversion'
  | 'score'
  | 'insights'
  | 'meta_ads'
  | 'qa';

export type AuditStepOrDone = AuditStep | 'done';
export type AuditStatus = 'processing' | 'completed' | 'error';

export const STEP_ORDER: AuditStep[] = [
  'crawl', 'ssl', 'pagespeed', 'sector', 'content',
  'gbp', 'reputation', 'traffic', 'seo', 'seo_pages', 'content_cadence',
  'competitors', 'competitor_traffic', 'keyword_gap',
  'geo', 'competitor_pagespeed',
  'instagram', 'linkedin', 'techstack', 'conversion', 'score', 'insights',
  'meta_ads', 'qa',
];

export const STEP_PROGRESS: Record<AuditStep, number> = {
  crawl: 5,
  ssl: 10,
  pagespeed: 15,
  sector: 20,
  content: 25,
  gbp: 29,
  reputation: 33,
  traffic: 37,
  seo: 42,
  seo_pages: 46,
  content_cadence: 50,
  competitors: 53,
  competitor_traffic: 57,
  keyword_gap: 61,
  geo: 64,
  competitor_pagespeed: 67,
  instagram: 70,
  linkedin: 73,
  techstack: 77,
  conversion: 83,
  score: 90,
  insights: 95,
  meta_ads: 97,
  qa: 100,
};

export const NEXT_STEP: Record<AuditStep, AuditStepOrDone> = {
  crawl: 'ssl',
  ssl: 'pagespeed',
  pagespeed: 'sector',
  sector: 'content',
  content: 'gbp',
  gbp: 'reputation',
  reputation: 'traffic',
  traffic: 'seo',
  seo: 'seo_pages',
  seo_pages: 'content_cadence',
  content_cadence: 'competitors',
  competitors: 'competitor_traffic',
  competitor_traffic: 'keyword_gap',
  keyword_gap: 'geo',
  geo: 'competitor_pagespeed',
  competitor_pagespeed: 'instagram',
  instagram: 'linkedin',
  linkedin: 'techstack',
  techstack: 'conversion',
  conversion: 'score',
  score: 'insights',
  insights: 'meta_ads',
  meta_ads: 'qa',
  qa: 'done',
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
  hasRobots?: boolean;       // <meta name="robots"> tag detected in HTML
  hasRobotsTxt?: boolean;    // /robots.txt file exists (direct HTTP check)
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
  companyName?: string;     // Cleaned brand name (not generic titles like "Inicio")
  locationHint?: string;    // City/region extracted from schema/HTML/domain
  hasBlog?: boolean;        // Blog section detected in nav/links
  blogUrl?: string;         // URL of the blog section root
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

export interface SectorBenchmarks {
  keywordsTop10: { low: number; median: number; high: number };
  organicTrafficMonthly: { low: number; median: number; high: number };
  domainRank: { low: number; median: number; high: number };
  instagramFollowers?: { low: number; median: number; high: number };
  linkedinFollowers?: { low: number; median: number; high: number };
}

export interface SectorResult extends ModuleResult {
  sector?: string;
  confidence?: number;
  keywords?: string[];
  rationale?: string;
  benchmarks?: SectorBenchmarks;
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
  stage?: 'tofu' | 'mofu' | 'bofu';  // Funnel stage
  isBrandQuery?: boolean;
  context?: string;     // First 200 chars of answer when mentioned
  answer?: string;      // First 150 chars of answer when NOT mentioned (for debugging)
  level?: number;        // Legacy: 1=sector, 2=value prop, 3=keywords, 4=direct brand
  levelLabel?: string;  // Legacy: Human-readable label for this funnel level
  pts?: number;         // Legacy: Points awarded at this level
  engines?: Array<{ name: string; mentioned: boolean; context?: string }>; // Per-engine results
}

export interface GeoCompetitorMention {
  name: string;
  domain: string;
  mentions: number;   // out of total queries
  total: number;
  mentionRate: number; // 0-100
}

export interface GeoResult extends ModuleResult {
  queries?: GeoQuery[];
  overallScore?: number;
  brandScore?: number;
  sectorScore?: number;
  mentionRate?: number;   // 0-100: % of all queries where brand was mentioned
  funnelBreakdown?: {
    tofu: { mentioned: number; total: number };
    mofu: { mentioned: number; total: number };
    bofu: { mentioned: number; total: number };
  };
  crossModel?: Array<{ name: string; mentioned: number; total: number }>;
  competitorMentions?: GeoCompetitorMention[];
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
  paidKeywordsTotal?: number;
  paidTrafficEstimate?: number;
  paidTrafficValue?: number;
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
  summary?: string;
  visibilitySummary?: string;
  benchmarkSummary?: string;
  experienceSummary?: string;
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
  // Organic
  organicKeywordsTotal?: number;
  keywordsTop3?: number;
  keywordsPos4to10?: number;
  keywordsTop10?: number;
  keywordsTop30?: number;
  organicTrafficEstimate?: number;
  estimatedAdsCost?: number;
  trendUp?: number;
  trendDown?: number;
  trendLost?: number;
  topKeywords?: Array<{ keyword: string; position: number; volume: number }>;
  // Paid (Google Ads)
  paidKeywordsTotal?: number;
  paidTrafficEstimate?: number;
  paidTrafficValue?: number;
  paidTop3Keywords?: number;
  isInvestingPaid?: boolean;
  paidTopKeywords?: Array<{ keyword: string; position: number; volume: number }>;
  // Backlinks / Domain Authority (DataForSEO Backlinks API)
  referringDomains?: number;
  backlinksTotal?: number;
  domainRank?: number;   // 0-100: DataForSEO domain authority score
  spamScore?: number;    // 0-100: link profile spam risk
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

// ── New: Meta Ads Library ─────────────────────────────────────────
export interface MetaAdsResult extends ModuleResult {
  hasMetaAds?: boolean;
  metaPageName?: string;
  competitorsWithMetaAds?: number;
  competitorDetails?: Array<{ name: string; url: string; hasMetaAds: boolean }>;
}

// ── New: Competitor PageSpeed ──────────────────────────────────────
export interface CompetitorPageSpeedItem {
  name: string;
  domain: string;
  mobileScore: number; // 0-100
}

export interface CompetitorPageSpeedResult extends ModuleResult {
  items: CompetitorPageSpeedItem[];
}

// ── New: QA Agent ─────────────────────────────────────────────────
export interface QAIssue {
  section: string;
  current_text: string;
  corrected_text: string;
  reason: string;
}

export interface QAResult extends ModuleResult {
  approved?: boolean;
  issues?: QAIssue[];
  suppressedSections?: string[];  // section keys to hide in the report
  overallAssessment?: string;
  qaTimestamp?: string;
  qaBypassed?: boolean;
  correctedInsights?: { bullets?: string[]; initiatives?: Array<{ title: string; description: string }> };
}

// ── New: Content cadence ──────────────────────────────────────────
export type ContentCadenceLevel = 'active' | 'irregular' | 'inactive';

export interface ContentCadenceResult extends ModuleResult {
  totalPosts?: number;
  lastPostDate?: string;        // ISO date "YYYY-MM-DD"
  daysSinceLastPost?: number;
  avgDaysBetweenPosts?: number;
  postsLast90Days?: number;
  cadenceLevel?: ContentCadenceLevel;
  blogUrl?: string;             // Root URL of the blog (e.g. https://example.com/blog)
}

// ── New: Online reputation ────────────────────────────────────────
export type ReputationLevel = 'strong' | 'moderate' | 'weak' | 'no_data';

export interface NewsHeadline {
  title: string;
  source: string;
  date?: string;
}

export interface ReputationResult extends ModuleResult {
  gbpRating?: number | null;
  gbpReviews?: number | null;
  gbpFound?: boolean;
  trustpilotRating?: number | null;
  trustpilotReviews?: number | null;
  trustpilotFound?: boolean;
  combinedRating?: number | null;
  totalReviews?: number;
  reputationLevel?: ReputationLevel;
  newsCount?: number;           // Articles found in Google News for brand name
  newsHeadlines?: NewsHeadline[]; // Top 5 headlines
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
