-- ═══════════════════════════════════════════════════════════════════════
-- Business Impact KPIs — extends onboarding + manual inputs table
-- ═══════════════════════════════════════════════════════════════════════
-- Adds the economic inputs needed to translate technical signals into
-- business-impact metrics (pipeline value, CPA, ROAS), plus a table for
-- monthly manual counts of leads/sales that clients without GA4 can use
-- as a fallback data source.

-- ─── 1. Economic inputs on client_onboarding ─────────────────────────
-- These three numbers power the pipeline/ROAS math. All optional —
-- the resolver handles "missing" gracefully by hiding derived KPIs.

alter table client_onboarding
  add column if not exists avg_deal_value numeric,          -- EUR per closed customer (or AOV for ecommerce)
  add column if not exists close_rate numeric check (close_rate is null or (close_rate >= 0 and close_rate <= 100)),
  add column if not exists monthly_ad_spend numeric,        -- EUR/month in paid media, for CPA/ROAS
  add column if not exists business_impact_kpis jsonb;      -- user's custom KPI picks (array of kpi_key)

comment on column client_onboarding.avg_deal_value is
  'Average revenue per closed customer (lead_gen) or AOV (ecommerce). Used to translate leads → pipeline €.';
comment on column client_onboarding.close_rate is
  'Typical lead → customer conversion rate in percentage (0-100). Default 20% if null.';
comment on column client_onboarding.monthly_ad_spend is
  'Monthly paid media budget in EUR. Enables CPA and ROAS calculations.';
comment on column client_onboarding.business_impact_kpis is
  'Array of kpi_key strings in display order. Overrides profile-based defaults when set.';

-- ─── 2. Manual business inputs (fallback without GA4) ────────────────
-- Monthly counts the user reports manually: leads, sales count, revenue.
-- Stored per month so we can compute deltas and trends.

create table if not exists manual_business_inputs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  month date not null,                                      -- first day of month (YYYY-MM-01)
  metric_key text not null check (metric_key in (
    'leads', 'sales_count', 'revenue', 'activations', 'bookings'
  )),
  value numeric not null check (value >= 0),
  notes text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (client_id, month, metric_key)
);

create index if not exists manual_business_inputs_client_month_idx
  on manual_business_inputs(client_id, month desc);

-- RLS: same tenant-scoped pattern as other client data
alter table manual_business_inputs enable row level security;

create policy "manual_business_inputs_access" on manual_business_inputs
  for all using (
    client_id in (select client_id from client_users where user_id = auth.uid())
  );
