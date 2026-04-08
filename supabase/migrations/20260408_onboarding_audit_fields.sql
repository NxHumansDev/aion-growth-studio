-- Add audit-discovered fields to client_onboarding
-- Pre-filled from audit results, editable by client, used by Radar as fixed inputs
ALTER TABLE client_onboarding
  ADD COLUMN IF NOT EXISTS sector text,
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS linkedin_url text;

COMMENT ON COLUMN client_onboarding.sector IS 'Business sector (auto-detected from audit, editable)';
COMMENT ON COLUMN client_onboarding.instagram_handle IS 'Instagram handle without @ (auto-detected from audit, editable)';
COMMENT ON COLUMN client_onboarding.linkedin_url IS 'LinkedIn company page URL (auto-detected from audit, editable)';
