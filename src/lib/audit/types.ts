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
  | 'meta_ads'
  | 'google_shopping'
  | 'growth_agent';

export type AuditStepOrDone = AuditStep | 'done';
export type AuditStatus = 'processing' | 'completed' | 'error';

export const STEP_ORDER: AuditStep[] = [
  'crawl', 'ssl', 'pagespeed', 'sector', 'content',
  'gbp', 'reputation', 'traffic', 'seo', 'seo_pages', 'content_cadence',
  'competitors', 'competitor_traffic', 'keyword_gap',
  'geo', 'competitor_pagespeed',
  'instagram', 'linkedin', 'techstack', 'conversion', 'score',
  'meta_ads', 'google_shopping', 'growth_agent',
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
  score: 88,
  meta_ads: 92,
  google_shopping: 94,
  growth_agent: 100,
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
  // Growth Agent replaces old insights + qa steps. Internally it does
  // Sonnet draft → structural validation → Opus QA → surgical corrections.
  score: 'growth_agent',
  meta_ads: 'google_shopping',  // kept for reference but not reached in normal flow
  google_shopping: 'growth_agent',
  growth_agent: 'done',
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
  finalUrl?: string;  // Set when domain redirects to a different hostname
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
  /** True when the site returned 403/401/Access Denied or a WAF challenge page.
   *  Downstream modules that depend on HTML content (conversion, techstack, on-page
   *  audit) must treat their results as "no medible" when this is true. Modules
   *  that use external APIs (PageSpeed, DataForSEO, GEO) are NOT affected. */
  crawlerBlocked?: boolean;
  crawlerBlockedReason?: string;  // e.g. "HTTP 403", "Access Denied page", "Cloudflare challenge"
  instagramHandle?: string;
  twitterHandle?: string;
  linkedinUrl?: string;
  hreflangAlternates?: HreflangAlternate[];
  businessType?: BusinessType;
  companyName?: string;     // Cleaned brand name (not generic titles like "Inicio")
  companyNameConfidence?: number;
  companyNameSource?: string;
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
  instagramFollowers?: { low: number; median: number; high: number };
  linkedinFollowers?: { low: number; median: number; high: number };
}

export interface SectorResult extends ModuleResult {
  sector?: string;
  confidence?: number;
  keywords?: string[];
  rationale?: string;
  benchmarks?: SectorBenchmarks;
  // Business profile inference — used by the benchmark scoring system.
  // One of the 8 profiles defined in src/lib/benchmarks/profiles.ts.
  businessProfile?: string;
  // Geo scope inference — normalizes to the values used by
  // src/lib/benchmarks/geo-multipliers.ts ('local' | 'national' | 'regional-multi' | 'global').
  geoScope?: string;
  // Short justification from the classifier — useful for the onboarding UI
  // when we ask the user to confirm or change the inferred profile.
  profileRationale?: string;
}

export interface ContentResult extends ModuleResult {
  clarity?: number;
  valueProposition?: string;
  audienceMatch?: string;
  cta?: string;
  weaknesses?: string[];
  strengths?: string[];
}

export type GeoCategory = 'sector' | 'problema' | 'comparativa' | 'decision' | 'recomendacion' | 'marca';

export interface GeoQuery {
  query: string;
  mentioned: boolean;
  stage?: 'tofu' | 'mofu' | 'bofu';  // Funnel stage
  category?: GeoCategory;              // Intent category (new)
  isBrandQuery?: boolean;
  context?: string;
  answer?: string;
  level?: number;
  levelLabel?: string;
  pts?: number;
  engines?: Array<{ name: string; mentioned: boolean; context?: string; snippet?: string; sentiment?: 'positive' | 'neutral' | 'negative' }>;
  // Multi-sampling fields (Radar only — audit uses samples=1)
  stabilityRate?: number;       // 0-100: % of samples where brand was mentioned (majority vote)
  samplesRun?: number;          // how many samples were taken per engine
}

export interface GeoCompetitorMention {
  name: string;
  domain: string;
  mentions: number;   // out of total queries
  total: number;
  mentionRate: number; // 0-100
  // Per-category breakdown for competitor
  byCategory?: { [key: string]: { mentioned: number; total: number } };
}

export interface GeoResult extends ModuleResult {
  queries?: GeoQuery[];
  overallScore?: number;
  brandScore?: number;
  sectorScore?: number;
  mentionRate?: number;       // 0-100
  mentionRangeLow?: number;   // confidence interval low
  mentionRangeHigh?: number;  // confidence interval high
  funnelBreakdown?: {
    tofu: { mentioned: number; total: number };
    mofu: { mentioned: number; total: number };
    bofu: { mentioned: number; total: number };
  };
  categoryBreakdown?: { [key: string]: { mentioned: number; total: number } };
  crossModel?: Array<{ name: string; mentioned: number; total: number }>;
  competitorMentions?: GeoCompetitorMention[];
  executiveNarrative?: string;
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
  employees?: string | number;
  description?: string;
  industry?: string;
  specialties?: string;
  headquarters?: string;
  website?: string;
  yearFounded?: number;
  // Post activity (from harvestapi Actor)
  postsLast90Days?: number;
  avgLikes?: number;
  avgComments?: number;
  engagementRate?: number; // (likes+comments) / (posts * followers)
  lastPostDate?: string;
  // Personal profile fields (from harvestapi~linkedin-profile-scraper)
  isPersonal?: boolean;
  isVerified?: boolean;
  isPremium?: boolean;
  experienceCount?: number;
  educationHighlight?: string;
  skillsCount?: number;
  publicationsCount?: number;
  publications?: Array<{ title: string; publishedAt?: string; link?: string }>;
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
  type?: 'direct' | 'aspirational'; // aspirational = reference only, excluded from benchmark score
}

export interface CompetitorsResult extends ModuleResult {
  competitors?: Competitor[];
}

export interface CompetitorTrafficItem {
  name: string;
  domain: string;
  url: string;
  organicTrafficEstimate?: number;
  estimatedAdsCost?: number;
  keywordsTop10?: number;
  paidKeywordsTotal?: number;
  paidTrafficEstimate?: number;
  paidTrafficValue?: number;
  type?: 'direct' | 'aspirational'; // aspirational = too large for benchmark score, reference only
  apiError?: string;
}

export interface CompetitorTrafficResult extends ModuleResult {
  items?: CompetitorTrafficItem[];
}

// ── 5-pillar score breakdown ──────────────────────────────────────
export interface ScoreBreakdown {
  seo: number;         // Pilar 1: SEO orgánico — escala log (35%)
  geo: number;         // Pilar 2: Visibilidad IA / GEO (25%)
  web: number;         // Pilar 3: Web & técnico — PageSpeed + fundamentos (15%)
  conversion: number;  // Pilar 4: Conversión — funnel score (15%)
  reputation: number;  // Pilar 5: Reputación — prensa + reviews + blog (10%)
}

/**
 * Full computation trace of how each pillar score was calculated.
 * Exposed so the Growth Agent can explain the score to the client with
 * real component values instead of inventing formulas.
 */
export interface ScoreComputation {
  seo?: {
    kwCount: number;          // raw: seo.keywordsTop10
    kwScore: number;          // logScore(kw, 2000)
    traffic: number;          // raw: seo.organicTrafficEstimate
    trafficScore: number;     // logScore(etv, 5_000_000)
    top3: number;             // raw: seo.keywordsTop3
    top3Bonus: number;        // bonus added from strong positions
    formula: string;          // human-readable equation
    final: number;
  };
  geo?: {
    mentionRate: number | null;
    overallScore: number | null;
    source: 'mentionRate' | 'overallScore';
    final: number;
  };
  web?: {
    pagespeedMobile: number;  // raw: pagespeed.mobile.performance
    techChecks: Array<{ label: string; points: number; applied: boolean }>;
    techChecksTotal: number;
    formula: string;          // e.g. "68 × 0.7 + 75 × 0.3"
    final: number;
  };
  conversion?: {
    funnelScore: number;
    final: number;
  };
  reputation?: {
    components: Array<{ label: string; value: number; weight: number }>;
    totalWeight: number;
    formula: string;
    final: number;
  };
  weights: {
    base: Record<string, number>;         // resolved profile weights (was BASE_WEIGHTS)
    effective: Record<string, number>;    // normalized after dropping inactive pillars
    inactivePillars: string[];            // pillars that had no data → dropped
  };
  totalFormula: string;                   // e.g. "(seo 72 × 0.35 + geo 45 × 0.25 + ...) / 1.00"
  profile?: {
    profile: string;                      // BusinessProfile key used for this score
    geoScope: string;                     // GeoScope key used for this score
    source: 'onboarding' | 'sector-inference' | 'fallback';
    confidence: number;                   // 0-1 (1 if user-confirmed)
  };
}

export interface ScoreResult extends ModuleResult {
  total?: number;
  breakdown?: ScoreBreakdown;
  computation?: ScoreComputation;         // how the numbers above were derived
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
  // Lead-gen signals (B2B / services)
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
  // Commerce signals (ecommerce / retail)
  hasCart?: boolean;
  hasAddToCart?: boolean;
  hasCheckout?: boolean;
  hasProductPrices?: boolean;
  hasNewsletter?: boolean;
  hasWishlist?: boolean;
  hasProductFilters?: boolean;
  productCount?: number;
  // Aggregated
  funnelScore?: number;   // 0-100
  detectedModel?: 'ecommerce' | 'lead_gen' | 'hybrid' | 'informational';
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  // GA4 cross-signals (enriched post-pipeline by run-radar.ts)
  ga4Diagnostics?: ConversionGA4Diagnostic[];
}

export interface ConversionGA4Diagnostic {
  id: 'blind_spot' | 'bounce_vs_cta' | 'mobile_friction';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  icon: string;
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
  paidDetectionMethod?: string; // 'labs' | 'google_ads_competition'
  paidTopKeywords?: Array<{ keyword: string; position?: number; volume: number; cpc?: number; competition?: string }>;
  // Historical organic trend (12 months)
  organicHistory?: Array<{ month: string; etv: number; keywords: number }>;
  organicTrend?: 'up' | 'down' | 'stable';
  organicTrendPct?: number; // % change last 6 months vs previous 6
  // Brand vs non-brand split
  brandTrafficEtv?: number;
  nonBrandTrafficEtv?: number;
  brandTrafficPct?: number;  // 0-100
  brandKeywords?: number;
  // Indexation
  indexedPages?: number;     // from site: search
  sitemapPages?: number;     // from sitemap.xml count
  indexationRatio?: number;  // 0-100
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
  gbpRating?: number;  // 1-5 stars
  gbpReviews?: number;
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
  url?: string;        // Full article URL (DataForSEO returns this)
  snippet?: string;    // First 200 chars of description
  /** True if the article links back to the client's domain.
   *  false = mention without backlink → link-building opportunity.
   *  undefined = not checked. */
  linksBack?: boolean;
  /** Set to true if the fetch to verify backlink failed (paywall, 403, etc.). */
  linkCheckFailed?: boolean;
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
  id: string;
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
  /** Radar sets this to 3 for multi-sampling GEO queries (audit uses 1) */
  geoSamples?: number;
  /** Confirmed onboarding fields (business_profile + geo_scope) when available.
   *  Lets runScore prefer user-confirmed values over sector.ts inference. */
  clientOnboarding?: {
    business_profile?: string | null;
    geo_scope?: string | null;
  } | null;
}
