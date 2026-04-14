/**
 * Editorial AI — TypeScript types mirroring the Supabase schema.
 * See supabase/migrations/20260414_editorial_ai.sql
 */

// ─── Enums ──────────────────────────────────────────────────────────────

export type EditorialLanguage = 'es' | 'en';

export type ArticleStatus =
  | 'queued_writer'       | 'processing_writer'
  | 'queued_editor'       | 'processing_editor'
  | 'queued_rewrite'      | 'processing_rewrite'
  | 'queued_salvage'      | 'processing_salvage'
  | 'ready_for_review'
  | 'published'
  | 'rejected'
  | 'approved_salvaged'
  | 'needs_human'
  | 'error_writer' | 'error_editor' | 'error_rewrite' | 'error_salvage';

export type PublicationPlatform =
  | 'blog' | 'linkedin_post' | 'linkedin_article'
  | 'newsletter' | 'column' | 'twitter';

export type StyleRuleType =
  | 'tone' | 'structure' | 'vocabulary_avoid' | 'vocabulary_prefer'
  | 'formula' | 'length' | 'formatting' | 'structural';

export type StyleRuleSource =
  | 'manual' | 'wizard_extracted'
  | 'learned_from_article' | 'learned_from_rejection';

export type FunnelStage = 'TOFU' | 'MOFU' | 'BOFU';

export type ContentType =
  | 'article_blog' | 'linkedin_post' | 'linkedin_article' | 'newsletter';

export type PerformanceSource =
  | 'blog_organic' | 'blog_social' | 'linkedin'
  | 'newsletter' | 'twitter' | 'other';

export type GenerationAgent =
  | 'writer' | 'editor' | 'editor_rewrite' | 'editor_salvage'
  | 'voice_extractor' | 'reference_analyzer'
  | 'diff_extractor' | 'whitelist_generator';

// ─── Entities ───────────────────────────────────────────────────────────

export interface BrandVoice {
  client_id: string;
  company_description?: string;
  positioning?: string;
  expertise_areas?: string[];
  tone_descriptors?: string[];
  first_person_rules?: string;
  brand_voice_by_language: Record<EditorialLanguage, BrandVoicePerLanguage>;
  supported_languages: EditorialLanguage[];
  setup_completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface BrandVoicePerLanguage {
  tone_descriptors?: string[];
  structural_patterns?: string[];
  vocabulary_fingerprint?: string[];
}

export interface StyleRule {
  id: string;
  client_id: string;
  rule_type: StyleRuleType;
  content: string;
  priority: 1 | 2 | 3 | 4 | 5;
  language?: EditorialLanguage | null;
  source: StyleRuleSource;
  learned_from_article_id?: string | null;
  superseded_by?: string | null;
  archived_at?: string | null;
  conflict_status?: 'pending' | 'resolved' | null;
  created_at: string;
  updated_at: string;
}

export interface ReferenceMedia {
  id: string;
  client_id: string;
  name: string;
  url?: string;
  why_reference?: string;
  notes?: string;
  language?: EditorialLanguage | null;
  created_at: string;
}

export interface PublicationProfileFormat {
  target_length_min?: number;
  target_length_max?: number;
  structure?: string;           // "hook+tesis+3args+cta" | "H2-driven" | etc.
  allow_headings?: boolean;
  hashtags_count?: number;
  require_meta?: boolean;
  require_schema?: boolean;
  tone_intensity?: 'conversational' | 'editorial' | 'technical';
  [key: string]: any;
}

export interface PublicationProfile {
  id: string;
  client_id: string;
  name: string;
  platform: PublicationPlatform;
  format_rules: PublicationProfileFormat;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Article {
  id: string;
  client_id: string;
  profile_id: string;
  tracking_id: string;

  // Brief
  topic: string;
  brief?: string;
  language: EditorialLanguage;
  primary_keyword?: string;
  secondary_keywords?: string[];
  funnel_stage?: FunnelStage;
  target_length?: number;
  entities_to_cite?: string[];
  competitor_articles?: string[];

  // Outputs
  draft_content?: string;
  editor_verdict?: EditorVerdict;
  revised_content?: string;
  final_user_content?: string;

  // Status & decision
  status: ArticleStatus;
  iteration_count: number;
  salvage_metadata?: SalvageMetadata;
  publication_decision?: PublicationDecision;
  published_url?: string;
  published_urls?: Array<{ platform: string; url: string; published_at: string }>;
  published_at?: string;
  approved_by?: string;
  approved_at?: string;

  // AION linkage
  source_action_id?: string;
  tracking_keyword?: string;

  // Cost & timestamps
  cost_usd: number;
  writer_started_at?: string;
  writer_finished_at?: string;
  editor_started_at?: string;
  editor_finished_at?: string;
  rewrite_started_at?: string;
  rewrite_finished_at?: string;
  salvage_started_at?: string;
  salvage_finished_at?: string;

  error_message?: string;
  performance_summary?: PerformanceSummary;

  created_at: string;
  updated_at: string;
}

export interface EditorVerdict {
  status: 'APPROVED' | 'REQUIRES_CHANGES' | 'REJECTED';
  verified_claims: Array<{ claim: string; source_url: string; confidence: number }>;
  incorrect_claims: Array<{ claim: string; reason: string; suggested_fix?: string }>;
  unsourced_claims: Array<{ claim: string; action: 'remove' | 'find_source' }>;
  plagiarism_warnings?: Array<{ excerpt: string; source_url: string; similarity: number }>;
  seo_audit: SeoAudit;
  geo_audit: GeoAudit;
  style_review: {
    matches_rules: string[];
    violations: string[];
  };
  recommendations: Array<{ issue: string; suggested_text?: string }>;
  seo_score: number;   // 0-100
  geo_score: number;   // 0-100
  overall_score: number;
  iteration: number;   // 0 = first fact-check, 1 = after rewrite, 2 = after salvage
}

export interface SeoAudit {
  primary_keyword_in_h1?: boolean;
  primary_keyword_in_first_100_words?: boolean;
  primary_keyword_density?: number;
  secondary_keywords_present?: string[];
  secondary_keywords_missing?: string[];
  meta_title_length?: number;
  meta_description_length?: number;
  url_slug?: string;
  internal_links_count?: number;
  external_authoritative_links_count?: number;
  featured_snippet_ready?: boolean;
  schema_suggestion?: string;
  issues: string[];
}

export interface GeoAudit {
  atomic_claims_ratio: number;    // % of sentences that are atomic (1 claim)
  sourced_claims_ratio: number;
  definitions_for_technical_terms: boolean;
  faq_section_present: boolean;
  entities_mentioned: string[];
  citable_structures_count: number;
  ambiguity_warnings: string[];
  issues: string[];
}

export interface SalvageMetadata {
  removed_claims: string[];
  original_length: number;
  final_length: number;
  survival_ratio: number;  // final/original
}

export interface PublicationDecision {
  decision: 'publish_as_is' | 'publish_with_changes' | 'discard';
  reason_category?: 'tone_not_my_voice' | 'factual_errors' | 'topic_not_relevant' | 'structure' | 'other';
  reason_text?: string;
  modifications_learned?: string[];  // style_rule IDs created from this article
}

export interface PerformanceSummary {
  total_sessions: number;
  total_users?: number;
  total_engagement: number;   // likes + comments + shares
  total_conversions: number;
  primary_channel: PerformanceSource;
  roi_score: number;          // 0-100
  trend: 'growing' | 'stable' | 'declining';
  weeks_measured: number;
}

export interface ArticlePerformance {
  id: string;
  article_id: string;
  week_of: string;             // YYYY-MM-DD (monday)
  source: PerformanceSource;

  // GA4
  sessions?: number;
  users?: number;
  bounce_rate?: number;
  avg_session_duration?: number;
  conversions?: number;
  conversion_rate?: number;

  // Apify
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  engagement_rate?: number;

  // Resend
  opens?: number;
  clicks?: number;

  measured_at: string;
}

export interface RejectedTopic {
  id: string;
  client_id: string;
  topic_text: string;
  topic_embedding?: number[];   // vector(1536)
  reason?: string;
  article_id?: string;
  created_at: string;
}

export interface EditorialQuota {
  id: string;
  client_id: string;
  month: string;                // YYYY-MM-01
  generated_count: number;
  approved_count: number;
  max_generated: number;
  max_approved: number;
  updated_at: string;
}

export interface EditorialSourcesWhitelist {
  client_id: string;
  domains: string[];
  recency_months: number;
  generated_at: string;
  sector_hash?: string;
}

export interface GenerationLog {
  id: string;
  article_id?: string;
  client_id?: string;
  agent: GenerationAgent;
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  web_searches: number;
  cost_usd?: number;
  latency_ms?: number;
  success: boolean;
  error_message?: string;
  created_at: string;
}

// ─── Feature flag helper ───────────────────────────────────────────────

export interface ClientFeatures {
  editorial?: boolean;
  real_time_alerts?: boolean;
  editorial_quota_override?: {
    max_generated?: number;
    max_approved?: number;
  };
  [key: string]: any;
}

// ─── Inputs ─────────────────────────────────────────────────────────────

export interface ArticleBrief {
  topic: string;
  brief?: string;
  profile_id: string;
  language: EditorialLanguage;
  primary_keyword?: string;
  secondary_keywords?: string[];
  funnel_stage?: FunnelStage;
  source_action_id?: string;
  tracking_keyword?: string;
}

export interface BriefResolutionResult extends ArticleBrief {
  resolved_primary_keyword: string;
  resolved_secondary_keywords: string[];
  search_intent: 'informational' | 'transactional' | 'navigational' | 'comparative';
  target_length: number;
  entities_to_cite: string[];
  competitor_articles: string[];
  warnings: string[];  // e.g. "Topic not in priority_keywords strategy"
}
