-- Marketing automation workflows
-- Each workflow is a named sequence of steps (trigger + emails + waits)
CREATE TABLE IF NOT EXISTS marketing_workflows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,          -- 'audit_completed', 'subscription', 'inactivity_14d', 'manual', 'cron'
  trigger_config JSONB DEFAULT '{}',   -- trigger-specific config (e.g., { days: 14 } for inactivity)
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft | active | paused
  steps       JSONB NOT NULL DEFAULT '[]',    -- ordered array of step objects
  -- Step schema: { type: 'email'|'wait'|'condition', delay?: string, subject?: string, template?: string, body?: string }
  enrolled    INT DEFAULT 0,
  stats       JSONB DEFAULT '{}',     -- { sent: 0, opened: 0, clicked: 0, converted: 0 }
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_status ON marketing_workflows(status);

-- Seed with AION's 4 core nurturing sequences
INSERT INTO marketing_workflows (name, description, trigger_type, status, steps) VALUES
(
  'Post-Auditoria',
  'Secuencia de nurturing despues del diagnostico gratuito. Objetivo: convertir lead en suscriptor Radar.',
  'audit_completed',
  'draft',
  '[
    {"type":"email","delay":"0h","subject":"Tu diagnostico de {domain} esta listo","template":"post_audit_immediate","body":"Resumen de hallazgos + link al informe"},
    {"type":"wait","delay":"24h"},
    {"type":"email","delay":"24h","subject":"Un dato sobre tu web que puede sorprenderte","template":"post_audit_insight","body":"Insight SEO/GEO destacado del audit"},
    {"type":"wait","delay":"3d"},
    {"type":"email","delay":"3d","subject":"Lo que hacen tus competidores esta semana","template":"post_audit_competitors","body":"Benchmark competitivo personalizado"},
    {"type":"wait","delay":"7d"},
    {"type":"email","delay":"7d","subject":"{domain}: oportunidades que se estan escapando","template":"post_audit_cta","body":"CTA a Radar con urgencia"}
  ]'::jsonb
),
(
  'Onboarding Radar',
  'Bienvenida y activacion de clientes que acaban de contratar Radar.',
  'subscription',
  'draft',
  '[
    {"type":"email","delay":"0h","subject":"Bienvenido a Radar — tu primer informe esta listo","template":"onboarding_welcome","body":"Link al dashboard + primeros pasos"},
    {"type":"wait","delay":"2d"},
    {"type":"email","delay":"2d","subject":"Tu advisor IA ya te conoce — preguntale lo que quieras","template":"onboarding_advisor","body":"Intro al chat advisor con ejemplos"},
    {"type":"wait","delay":"7d"},
    {"type":"email","delay":"7d","subject":"Tu primer informe semanal de {domain}","template":"onboarding_first_report","body":"Resumen del primer Radar semanal"}
  ]'::jsonb
),
(
  'Prevencion de churn',
  'Reactivacion de clientes que llevan 14+ dias sin entrar al dashboard.',
  'inactivity_14d',
  'draft',
  '[
    {"type":"wait","delay":"14d"},
    {"type":"email","delay":"14d","subject":"Han cambiado cosas en tu sector esta semana","template":"churn_reengagement","body":"Datos de cambios detectados por Radar"},
    {"type":"wait","delay":"7d"},
    {"type":"email","delay":"21d","subject":"Tu competencia ha mejorado — mira los datos","template":"churn_urgency","body":"Benchmark competitivo con alertas"},
    {"type":"wait","delay":"7d"},
    {"type":"email","delay":"28d","subject":"Nos echamos de menos? Tu score ha bajado","template":"churn_winback","body":"Ultimo intento con descuento o valor extra"}
  ]'::jsonb
),
(
  'Newsletter mensual',
  'Contenido de valor mensual para toda la base de leads y clientes.',
  'cron',
  'draft',
  '[
    {"type":"email","delay":"—","subject":"Tendencias de visibilidad digital — {month} 2026","template":"newsletter_monthly","body":"Tendencias del sector + tips + novedades AION"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;
