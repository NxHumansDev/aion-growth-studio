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
  | 'competitors'
  | 'score'
  | 'insights';

export type AuditStepOrDone = AuditStep | 'done';
export type AuditStatus = 'processing' | 'completed' | 'error';

export const STEP_ORDER: AuditStep[] = [
  'crawl', 'ssl', 'pagespeed', 'sector', 'content', 'geo',
  'instagram', 'linkedin', 'gbp', 'traffic', 'competitors', 'score', 'insights',
];

export const STEP_PROGRESS: Record<AuditStep, number> = {
  crawl: 8,
  ssl: 15,
  pagespeed: 23,
  sector: 31,
  content: 38,
  geo: 46,
  instagram: 54,
  linkedin: 62,
  gbp: 69,
  traffic: 77,
  competitors: 84,
  score: 92,
  insights: 100,
};

export const NEXT_STEP: Record<AuditStep, AuditStepOrDone> = {
  crawl: 'ssl',
  ssl: 'pagespeed',
  pagespeed: 'sector',
  sector: 'content',
  content: 'geo',
  geo: 'instagram',
  instagram: 'linkedin',
  linkedin: 'gbp',
  gbp: 'traffic',
  traffic: 'competitors',
  competitors: 'score',
  score: 'insights',
  insights: 'done',
};

export interface ModuleResult {
  skipped?: boolean;
  error?: string;
  reason?: string;
  [key: string]: any;
}

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
  internalLinks?: number;
  wordCount?: number;
  loadedOk?: boolean;
  instagramHandle?: string;
  twitterHandle?: string;
  linkedinUrl?: string;
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
  context?: string;
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

export interface ScoreBreakdown {
  technical: number;
  performance: number;
  content: number;
  visibility: number;
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
