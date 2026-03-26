import { createClient } from '@supabase/supabase-js';
import { runAuditForQA } from './run-audit';
import { renderReportText } from './render-report-text';
import type { QualityEvaluation, DomainSelection } from './types';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;

const QUALITY_EVAL_PROMPT = `
Eres Marta, Directora de Marketing de una empresa mediana española.
Tienes 47 años, gestionas 120.000€/año de presupuesto digital, reportas a un CEO
que quiere "resultados con números". No eres técnica — sabes de marketing pero no de SEO técnico.

CONTEXTO DEL SISTEMA QUE GENERÓ ESTE INFORME:
AION Growth Studio es una plataforma que analiza la presencia digital de empresas con IA.
El informe gratuito es un lead magnet: debe demostrar valor en 2 minutos de lectura para
que el Dir. Marketing quiera contratar la monitorización mensual (149-699€/mes).
El informe DEBE: ser claro sin jerga, citar datos concretos, dar recomendaciones accionables,
y crear urgencia basada en datos reales (no en miedo genérico).

ACABAS DE RECIBIR ESTE INFORME. LÉELO COMPLETO.

EVALÚA en dos ejes:

EJE 1 — PUNTUACIÓN (0-10):
1. CLARIDAD: ¿Lo entiendo sin buscar en Google? ¿Hay jerga sin explicar?
2. CREDIBILIDAD: ¿Me fío de los números? ¿Los competidores son realmente los míos?
3. ACCIONABILIDAD: ¿Sé qué hacer después de leerlo? ¿Puedo llevarlo a mi CEO?
4. URGENCIA: ¿Siento que necesito actuar? ¿Me enseñó algo que no sabía?
5. DISPOSICIÓN A PAGAR: ¿Pagaría 149-349€/mes por esto cada mes?

EJE 2 — PROBLEMAS (separa SIEMPRE entre erróneo y no interesa):

ERRÓNEO = datos incorrectos, contradictorios o inverosímiles. Son bugs del sistema.
Ejemplos:
- "Dice 0 gaps pero luego recomienda atacar gaps" → contradictorio
- "Mis competidores son Santander y BBVA pero soy un banco privado boutique" → dato incorrecto
- "Score 0/100 pero luego dice que mi SEO es sólido" → contradictorio
- "Dice que tengo 1 keyword en posición 4-10 pero la tabla muestra 37" → dato incorrecto
- "Menciona backlinks pero no tiene datos de backlinks" → referencia sin base

NO INTERESA = datos correctos pero que no me aportan valor como Dir. Marketing.
Ejemplos:
- "Me dice el LCP en segundos pero no sé qué es LCP" → jerga técnica sin contexto
- "Lista noticias de prensa que no tienen que ver con la empresa" → ruido
- "El schema markup es un concepto que no me importa en una primera lectura" → demasiado técnico
- "El veredicto es tan genérico que podría ser de cualquier empresa" → no personalizado

RESPONDE EN JSON (y SOLO JSON, sin explicación adicional):
{
  "scores": {
    "clarity": N,
    "credibility": N,
    "actionability": N,
    "urgency": N,
    "willingness_to_pay": N,
    "overall": N
  },
  "errors": [
    { "section": "...", "issue": "...", "severity": "critical|warning", "what_should_change": "..." }
  ],
  "not_interesting": [
    { "section": "...", "issue": "...", "suggestion": "cómo hacerlo más útil" }
  ],
  "would_send_to_ceo": true,
  "ceo_reason": "...",
  "would_subscribe": true,
  "subscribe_reason": "...",
  "best_part": "la parte que más valor me aportó",
  "worst_part": "la parte que más me confundió o me hizo desconfiar",
  "prompt_for_claude_code": "Si hay errores críticos, genera un prompt completo y concreto que pueda copiar directamente a Claude Code para corregir los problemas. Si no hay errores graves, pon null."
}
`.trim();

async function evaluateWithOpus(
  domain: string,
  sector: string,
  reportText: string,
): Promise<Omit<QualityEvaluation, 'domain' | 'sector' | 'audit_score'>> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 3000,
      temperature: 0,
      system: QUALITY_EVAL_PROMPT,
      messages: [
        {
          role: 'user',
          content: `DOMINIO: ${domain}\nSECTOR: ${sector}\n\nINFORME COMPLETO:\n\n${reportText}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Opus API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text: string = data?.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Opus returned non-JSON response');

  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    // Try to fix common JSON issues: trailing commas, unescaped quotes
    let fixed = match[0]
      .replace(/,\s*([\]}])/g, '$1')           // trailing commas
      .replace(/\n/g, ' ')                       // collapse newlines
      .replace(/([{,]\s*)"?(\w+)"?\s*:/g, '$1"$2":'); // unquoted keys
    try {
      parsed = JSON.parse(fixed);
    } catch (e2) {
      console.error('[QA:quality] JSON repair failed, raw length:', match[0].length);
      throw new Error(`Opus JSON parse error: ${(e2 as Error).message}`);
    }
  }
  return {
    scores: parsed.scores,
    errors: parsed.errors || [],
    not_interesting: parsed.not_interesting || [],
    would_send_to_ceo: parsed.would_send_to_ceo ?? false,
    ceo_reason: parsed.ceo_reason || '',
    would_subscribe: parsed.would_subscribe ?? false,
    subscribe_reason: parsed.subscribe_reason || '',
    best_part: parsed.best_part || '',
    worst_part: parsed.worst_part || '',
    prompt_for_claude_code: parsed.prompt_for_claude_code || null,
  };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Run quality evaluation for a list of domains and save results to Supabase */
export async function runQualityEngine(domains: DomainSelection[]): Promise<QualityEvaluation[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env vars missing');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const evaluations: QualityEvaluation[] = [];

  for (const { domain, sector } of domains) {
    console.log(`\n[QA:quality] ──── ${domain} (${sector}) ────`);

    try {
      // 1. Run full audit pipeline
      const auditResults = await runAuditForQA(domain);

      // 2. Render report as evaluable text
      const reportText = renderReportText(auditResults, domain);

      // 3. Evaluate with Opus as Marta
      console.log(`[QA:quality] Evaluating with Opus...`);
      const evalResult = await evaluateWithOpus(domain, sector, reportText);

      const evaluation: QualityEvaluation = {
        domain,
        sector,
        audit_score: (auditResults.score as any)?.total ?? null,
        ...evalResult,
        raw_audit: auditResults,
        raw_report_text: reportText,
      };

      // 4. Persist to Supabase
      const { error } = await supabase.from('qa_quality_evaluations').insert({
        domain,
        sector,
        audit_score: evaluation.audit_score,
        clarity:             evalResult.scores.clarity,
        credibility:         evalResult.scores.credibility,
        actionability:       evalResult.scores.actionability,
        urgency:             evalResult.scores.urgency,
        willingness_to_pay:  evalResult.scores.willingness_to_pay,
        overall:             evalResult.scores.overall,
        would_send_to_ceo:   evalResult.would_send_to_ceo,
        would_subscribe:     evalResult.would_subscribe,
        ceo_reason:          evalResult.ceo_reason,
        subscribe_reason:    evalResult.subscribe_reason,
        errors:              evalResult.errors,
        not_interesting:     evalResult.not_interesting,
        best_part:           evalResult.best_part,
        worst_part:          evalResult.worst_part,
        prompt_for_claude_code: evalResult.prompt_for_claude_code,
        raw_audit:           auditResults,
        raw_report_text:     reportText,
      });

      if (error) {
        console.error(`[QA:quality] Supabase insert error: ${error.message}`);
      } else {
        console.log(`[QA:quality] ✓ Saved — overall ${evalResult.scores.overall}/10`);
      }

      evaluations.push(evaluation);
    } catch (err: any) {
      console.error(`[QA:quality] ✗ ${domain}: ${err.message}`);
    }

    // Rate-limit between domains (LLM APIs)
    if (domains.indexOf({ domain, sector }) < domains.length - 1) {
      await sleep(15_000);
    }
  }

  return evaluations;
}
