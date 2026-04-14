-- ═══════════════════════════════════════════════════════════════════════
-- Editorial AI — P7 Schema (P7-S1)
-- ═══════════════════════════════════════════════════════════════════════
-- Stores brand voice, style rules, references, publication profiles,
-- articles (with DB-based queue status machine) and performance tracking.
--
-- Architecture notes:
-- - brand_voice and style_rules live at CLIENT level (shared by all team
--   members). Different users in the same client share the same voice.
-- - publication_profiles only define FORMAT (length, structure). Voice and
--   style come from the client-level rules.
-- - articles use a status machine for DB-based queueing (no Inngest).
-- - RLS policies mirror the pattern from 20260403_client_context.sql.
-- ═══════════════════════════════════════════════════════════════════════

-- Required extensions ───────────────────────────────────────────────────
create extension if not exists vector;      -- for rejected_topics similarity
create extension if not exists "pgcrypto";  -- for gen_random_uuid()

-- ═══════════════════════════════════════════════════════════════════════
-- 1. FEATURE FLAG on clients
-- ═══════════════════════════════════════════════════════════════════════
-- Editorial AI is gated independently of the base tier (radar/signals/agency)
-- via a feature flag. Signals tier clients get it enabled by default.

alter table clients add column if not exists features jsonb default '{}'::jsonb;

-- Example: { "editorial": true, "real_time_alerts": true }
comment on column clients.features is
  'Feature flags per client. Keys: editorial (bool), real_time_alerts (bool), etc.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. BRAND VOICE (1 per client)
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists brand_voice (
  client_id uuid primary key references clients(id) on delete cascade,
  company_description text,
  positioning text,
  expertise_areas text[],
  tone_descriptors text[],
  first_person_rules text,
  -- Multi-language: separate extractions per language
  -- Keys: 'es' | 'en'. Each value is { tone_descriptors, structural_patterns, vocabulary_fingerprint }
  brand_voice_by_language jsonb default '{}'::jsonb,
  supported_languages text[] default array['es']::text[],  -- which langs this client publishes in
  setup_completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. STYLE RULES (at client level)
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists editorial_style_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  rule_type text not null check (rule_type in (
    'tone', 'structure', 'vocabulary_avoid', 'vocabulary_prefer',
    'formula', 'length', 'formatting', 'structural'
  )),
  content text not null,
  priority int not null default 3 check (priority between 1 and 5),
  language text,  -- null = agnostic; 'es'/'en' = specific
  source text not null default 'manual' check (source in (
    'manual', 'wizard_extracted', 'learned_from_article', 'learned_from_rejection'
  )),
  learned_from_article_id uuid,  -- references articles(id), set deferred
  superseded_by uuid,  -- points to the rule that replaced this one (conflict resolution)
  archived_at timestamptz,  -- soft delete
  conflict_status text check (conflict_status in ('pending', 'resolved')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists editorial_style_rules_client_idx on editorial_style_rules(client_id) where archived_at is null;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. REFERENCE MEDIA (at client level)
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists editorial_reference_media (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  url text,
  why_reference text,
  notes text,
  language text,  -- null or 'es'/'en'
  created_at timestamptz default now()
);

create index if not exists editorial_reference_media_client_idx on editorial_reference_media(client_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. PUBLICATION PROFILES (format only)
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists publication_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  platform text not null check (platform in (
    'blog', 'linkedin_post', 'linkedin_article', 'newsletter', 'column', 'twitter'
  )),
  -- format_rules JSON shape:
  --   {
  --     "target_length_min": 800, "target_length_max": 1200,
  --     "structure": "hook+tesis+3args+cta",
  --     "allow_headings": false, "hashtags_count": 4,
  --     "require_meta": false, "require_schema": false,
  --     "tone_intensity": "conversational"
  --   }
  format_rules jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists publication_profiles_client_idx on publication_profiles(client_id) where active = true;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. ARTICLES (with status machine for DB-based queueing)
-- ═══════════════════════════════════════════════════════════════════════
-- Status flow:
--   queued_writer → processing_writer → queued_editor
--   queued_editor → processing_editor → ready_for_review (APPROVED)
--                                     → queued_rewrite (REQUIRES_CHANGES)
--                                     → queued_salvage (REJECTED)
--   queued_rewrite → processing_rewrite → ready_for_review OR queued_salvage
--   queued_salvage → processing_salvage → approved_salvaged OR needs_human
--   ready_for_review → published (user decides) OR rejected (user discards)
--
-- Terminal states: published, rejected, approved_salvaged, needs_human, error_*

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  profile_id uuid not null references publication_profiles(id) on delete restrict,

  -- Short unique id for UTMs: "ab12cd"
  tracking_id text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 6),

  -- Input brief
  topic text not null,
  brief text,
  language text not null default 'es' check (language in ('es', 'en')),
  primary_keyword text,
  secondary_keywords text[],
  funnel_stage text check (funnel_stage in ('TOFU', 'MOFU', 'BOFU')),
  target_length int,
  entities_to_cite text[],
  competitor_articles text[],  -- URLs for reference

  -- Generation outputs
  draft_content text,          -- writer output (markdown or plain text by platform)
  editor_verdict jsonb,        -- fact-check + SEO/GEO audit result
  revised_content text,        -- rewrite (iter 1) output
  final_user_content text,     -- what the user ended up with after their edits

  -- Decision & publication
  status text not null default 'queued_writer' check (status in (
    'queued_writer', 'processing_writer',
    'queued_editor', 'processing_editor',
    'queued_rewrite', 'processing_rewrite',
    'queued_salvage', 'processing_salvage',
    'ready_for_review',
    'published', 'rejected',
    'approved_salvaged', 'needs_human',
    'error_writer', 'error_editor', 'error_rewrite', 'error_salvage'
  )),
  iteration_count int not null default 0,
  salvage_metadata jsonb,      -- { removed_claims, original_length, final_length }
  publication_decision jsonb,  -- { decision, reason_category, reason_text, modifications_learned }
  published_url text,          -- canonical URL the user pasted
  published_urls jsonb,        -- [{platform, url, published_at}] if multi-channel
  published_at timestamptz,
  approved_by uuid,            -- references auth.users(id)
  approved_at timestamptz,

  -- Linkage to AION (closes the measurement loop)
  source_action_id uuid,       -- recommendations.id that triggered this
  tracking_keyword text,       -- keyword we're tracking in AION

  -- Cost tracking + state timestamps
  cost_usd numeric(10, 4) not null default 0,
  writer_started_at timestamptz,
  writer_finished_at timestamptz,
  editor_started_at timestamptz,
  editor_finished_at timestamptz,
  rewrite_started_at timestamptz,
  rewrite_finished_at timestamptz,
  salvage_started_at timestamptz,
  salvage_finished_at timestamptz,

  error_message text,
  performance_summary jsonb,   -- aggregated rollup (total_sessions, roi_score, trend)

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists articles_client_status_idx on articles(client_id, status);
create index if not exists articles_client_created_idx on articles(client_id, created_at desc);
create index if not exists articles_status_updated_idx on articles(status, updated_at)
  where status like 'processing_%';  -- for stuck-job detection

-- Deferred FK from style_rules to articles (now that articles exists)
alter table editorial_style_rules
  drop constraint if exists editorial_style_rules_learned_from_article_fkey;
alter table editorial_style_rules
  add constraint editorial_style_rules_learned_from_article_fkey
  foreign key (learned_from_article_id) references articles(id) on delete set null;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. ARTICLE PERFORMANCE (weekly rollups per source channel)
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists article_performance (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  week_of date not null,  -- monday of the week
  source text not null check (source in (
    'blog_organic', 'blog_social', 'linkedin', 'newsletter', 'twitter', 'other'
  )),

  -- From GA4 (blog_organic / blog_social / newsletter via UTM)
  sessions int default 0,
  users int default 0,
  bounce_rate numeric(5, 2),
  avg_session_duration int,  -- seconds
  conversions int default 0,
  conversion_rate numeric(5, 2),

  -- From Apify (LinkedIn / Twitter)
  impressions int,
  likes int,
  comments int,
  shares int,
  engagement_rate numeric(5, 2),

  -- From Resend (newsletter)
  opens int,
  clicks int,

  measured_at timestamptz default now(),
  unique (article_id, week_of, source)
);

create index if not exists article_performance_article_idx on article_performance(article_id);
create index if not exists article_performance_week_idx on article_performance(week_of desc);

-- ═══════════════════════════════════════════════════════════════════════
-- 8. REJECTED TOPICS (semantic filtering)
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists rejected_topics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  topic_text text not null,
  topic_embedding vector(1536),
  reason text,
  article_id uuid references articles(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists rejected_topics_client_idx on rejected_topics(client_id);
-- pgvector ivfflat index for fast similarity search
create index if not exists rejected_topics_embedding_idx
  on rejected_topics using ivfflat (topic_embedding vector_cosine_ops)
  with (lists = 100);

-- ═══════════════════════════════════════════════════════════════════════
-- 9. GENERATION LOG (auditing + cost analysis)
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists editorial_generation_log (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references articles(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  agent text not null check (agent in ('writer', 'editor', 'editor_rewrite', 'editor_salvage', 'voice_extractor', 'reference_analyzer', 'diff_extractor', 'whitelist_generator')),
  model text not null,
  tokens_in int,
  tokens_out int,
  web_searches int default 0,
  cost_usd numeric(10, 4),
  latency_ms int,
  success boolean not null,
  error_message text,
  created_at timestamptz default now()
);

create index if not exists editorial_gen_log_article_idx on editorial_generation_log(article_id);
create index if not exists editorial_gen_log_client_idx on editorial_generation_log(client_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════
-- 10. ARTICLE QUOTA (per client per month)
-- ═══════════════════════════════════════════════════════════════════════
-- Signals tier: 16 generated / 8 approved per month.
-- Agency tier: could be higher (configured via features.editorial_quota).

create table if not exists editorial_quota (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  month date not null,  -- first day of month
  generated_count int not null default 0,
  approved_count int not null default 0,
  max_generated int not null default 16,
  max_approved int not null default 8,
  updated_at timestamptz default now(),
  unique (client_id, month)
);

create index if not exists editorial_quota_client_month_idx on editorial_quota(client_id, month);

-- ═══════════════════════════════════════════════════════════════════════
-- 11. EDITORIAL WHITELIST (cached per client)
-- ═══════════════════════════════════════════════════════════════════════
-- Authoritative domains by industry, generated by Haiku at setup time.
-- Editor agent uses these as preferred sources for fact-checking.

create table if not exists editorial_sources_whitelist (
  client_id uuid primary key references clients(id) on delete cascade,
  domains text[] not null default array[]::text[],
  recency_months int not null default 24,  -- how fresh sources should be
  generated_at timestamptz default now(),
  sector_hash text  -- so we can invalidate if sector changes
);

-- ═══════════════════════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════════════════════

alter table brand_voice enable row level security;
alter table editorial_style_rules enable row level security;
alter table editorial_reference_media enable row level security;
alter table publication_profiles enable row level security;
alter table articles enable row level security;
alter table article_performance enable row level security;
alter table rejected_topics enable row level security;
alter table editorial_generation_log enable row level security;
alter table editorial_quota enable row level security;
alter table editorial_sources_whitelist enable row level security;

-- Helper: check if auth user belongs to client
-- (replicates the pattern from 20260403_client_context.sql)

-- brand_voice
create policy "editorial_brand_voice_access" on brand_voice
  for all using (
    client_id in (select client_id from client_users where user_id = auth.uid())
  );

-- style_rules
create policy "editorial_style_rules_access" on editorial_style_rules
  for all using (
    client_id in (select client_id from client_users where user_id = auth.uid())
  );

-- reference_media
create policy "editorial_reference_media_access" on editorial_reference_media
  for all using (
    client_id in (select client_id from client_users where user_id = auth.uid())
  );

-- publication_profiles
create policy "editorial_publication_profiles_access" on publication_profiles
  for all using (
    client_id in (select client_id from client_users where user_id = auth.uid())
  );

-- articles — any team member can read; only admins can write
create policy "editorial_articles_read" on articles
  for select using (
    client_id in (select client_id from client_users where user_id = auth.uid())
  );
create policy "editorial_articles_admin_write" on articles
  for all using (
    client_id in (
      select client_id from client_users
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- article_performance — read-only for team
create policy "editorial_article_performance_read" on article_performance
  for select using (
    article_id in (
      select a.id from articles a
      where a.client_id in (select client_id from client_users where user_id = auth.uid())
    )
  );

-- rejected_topics
create policy "editorial_rejected_topics_access" on rejected_topics
  for all using (
    client_id in (select client_id from client_users where user_id = auth.uid())
  );

-- generation_log — admins only (costs are sensitive)
create policy "editorial_generation_log_admin" on editorial_generation_log
  for select using (
    client_id in (
      select client_id from client_users
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- quota — readable by team, writable by system (service role bypasses RLS)
create policy "editorial_quota_read" on editorial_quota
  for select using (
    client_id in (select client_id from client_users where user_id = auth.uid())
  );

-- whitelist — readable by team (admins edit via UI; service role updates on setup)
create policy "editorial_whitelist_read" on editorial_sources_whitelist
  for select using (
    client_id in (select client_id from client_users where user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════════════
-- HELPER FUNCTION: stuck-job detection
-- ═══════════════════════════════════════════════════════════════════════
-- Resets articles stuck in processing_* state for >5 minutes back to
-- queued_*, so the next UI poll can retry. Called by cron or on UI load.

create or replace function reset_stuck_editorial_articles()
returns int language plpgsql as $$
declare
  reset_count int;
begin
  with updated as (
    update articles
    set status = case
      when status = 'processing_writer'  then 'queued_writer'
      when status = 'processing_editor'  then 'queued_editor'
      when status = 'processing_rewrite' then 'queued_rewrite'
      when status = 'processing_salvage' then 'queued_salvage'
    end,
    updated_at = now()
    where status like 'processing_%'
      and updated_at < now() - interval '5 minutes'
    returning id
  )
  select count(*) into reset_count from updated;
  return reset_count;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- RPC FUNCTION: find_similar_rejected_topics
-- ═══════════════════════════════════════════════════════════════════════
-- Returns rejected topics whose embedding is within max_distance (cosine)
-- of the candidate embedding. Used to filter recommendations that would
-- propose topics similar to ones the client already rejected.

-- ═══════════════════════════════════════════════════════════════════════
-- RPC FUNCTION: atomic quota increment
-- ═══════════════════════════════════════════════════════════════════════
-- Atomically increments generated_count or approved_count by 1 and returns
-- the updated row. Used from quota.ts helpers.

create or replace function increment_editorial_quota(
  p_client_id uuid,
  p_month date,
  p_field text  -- 'generated_count' | 'approved_count'
)
returns editorial_quota language plpgsql as $$
declare
  updated editorial_quota;
begin
  if p_field = 'generated_count' then
    update editorial_quota
    set generated_count = generated_count + 1, updated_at = now()
    where client_id = p_client_id and month = p_month
    returning * into updated;
  elsif p_field = 'approved_count' then
    update editorial_quota
    set approved_count = approved_count + 1, updated_at = now()
    where client_id = p_client_id and month = p_month
    returning * into updated;
  else
    raise exception 'Invalid field: %', p_field;
  end if;
  return updated;
end;
$$;

create or replace function find_similar_rejected_topics(
  p_client_id uuid,
  p_embedding text,  -- pgvector string form: "[0.01, 0.02, ...]"
  p_max_distance float default 0.15
)
returns table (
  id uuid,
  client_id uuid,
  topic_text text,
  reason text,
  article_id uuid,
  created_at timestamptz,
  similarity float
) language sql stable as $$
  select
    r.id, r.client_id, r.topic_text, r.reason, r.article_id, r.created_at,
    (1 - (r.topic_embedding <=> p_embedding::vector)) as similarity
  from rejected_topics r
  where r.client_id = p_client_id
    and r.topic_embedding is not null
    and (r.topic_embedding <=> p_embedding::vector) < p_max_distance
  order by r.topic_embedding <=> p_embedding::vector asc
  limit 10;
$$;
