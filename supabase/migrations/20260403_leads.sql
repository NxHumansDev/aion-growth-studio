-- Leads table: captures every audit request as a lead
-- One row per email+url combination (upsert on repeat visits)

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  url text not null,
  name text,
  company text,
  audit_id uuid,                      -- linked audit if completed
  status text not null default 'new' check (status in ('new', 'audit_started', 'audit_completed', 'registered', 'paying', 'churned')),
  source text default 'diagnostic',   -- 'diagnostic', 'dashboard', 'api'
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(email, url)
);

-- Index for CRM queries
create index if not exists idx_leads_status on leads(status);
create index if not exists idx_leads_email on leads(email);
create index if not exists idx_leads_created on leads(created_at desc);
