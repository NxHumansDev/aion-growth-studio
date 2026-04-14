-- ═══════════════════════════════════════════════════════════════════════════
-- Add business_profile column to client_onboarding.
--
-- The scoring system is moving from global hardcoded thresholds to
-- contextual benchmarks by business type + geographic scope. 8 profiles:
--   freelance, professional-services, saas, ecommerce,
--   local-single, local-chain, media-education, nonprofit-institutional
--
-- The geo_scope column already exists (added in 20260403_client_context.sql)
-- with values: 'local_city' | 'national' | 'multi_country' | 'global'.
--
-- Nullable: the column is only populated after the user confirms the
-- auto-inferred profile in onboarding. Until then, scoring falls back to
-- the sector.ts inference (stored in pipeline_output.sector.businessProfile).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  ALTER TABLE client_onboarding
    ADD COLUMN IF NOT EXISTS business_profile text;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

COMMENT ON COLUMN client_onboarding.business_profile IS
  'User-confirmed business profile (one of the 8 defined in src/lib/benchmarks/profiles.ts). '
  'Null until the user confirms the inferred profile during onboarding.';
