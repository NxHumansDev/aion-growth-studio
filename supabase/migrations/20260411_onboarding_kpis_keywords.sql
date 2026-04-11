-- Add KPI + keyword config columns to client_onboarding.
-- These fields are already declared in src/lib/db.ts (ClientOnboarding type)
-- and written by /api/dashboard/save-onboarding + /api/dashboard/save-keywords,
-- but the base schema (20260403_client_context.sql) never included them.
--
-- primary_kpis: client-picked KPIs with optional 6-month targets
-- priority_keywords: strategic keyword list (from SEO opportunities)
-- keyword_strategy: demand type + focus + growth service metadata

ALTER TABLE client_onboarding
  ADD COLUMN IF NOT EXISTS primary_kpis jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority_keywords jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS keyword_strategy jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN client_onboarding.primary_kpis IS
  'Client-selected KPIs for the dashboard, max 3. Array of {key, label, target?}.';
COMMENT ON COLUMN client_onboarding.priority_keywords IS
  'Strategic priority keywords chosen by the client from SEO opportunities.';
COMMENT ON COLUMN client_onboarding.keyword_strategy IS
  'Keyword strategy metadata: demandType, focus, growthService, updatedAt.';
