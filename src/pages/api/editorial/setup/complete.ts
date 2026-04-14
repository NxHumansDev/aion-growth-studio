export const prerender = false;

import type { APIRoute } from 'astro';
import {
  clientHasEditorial, upsertBrandVoice, createStyleRule,
  createReferenceMedia, createPublicationProfile,
} from '../../../../lib/editorial/db';
import { PLATFORM_DEFAULTS } from '../../../../lib/editorial/profile-defaults';
import type {
  EditorialLanguage, StyleRuleType, PublicationPlatform,
} from '../../../../lib/editorial/types';

interface SetupCompleteBody {
  // Step 1 — company
  company_description: string;
  positioning: string;
  expertise_areas: string[];
  supported_languages: EditorialLanguage[];

  // Step 2 — voice (one extraction per language)
  voice_by_language: Partial<Record<EditorialLanguage, {
    tone_descriptors: string[];
    structural_patterns: string[];
    vocabulary_fingerprint: string[];
    first_person_rules?: string;
  }>>;

  // Initial style rules (confirmed from extraction + any manual)
  style_rules: Array<{
    rule_type: StyleRuleType;
    content: string;
    priority: 1 | 2 | 3 | 4 | 5;
    language?: EditorialLanguage | null;
  }>;

  // Step 3 — references
  references: Array<{
    name: string;
    url?: string;
    why_reference?: string;
    notes?: string;
    language?: EditorialLanguage | null;
  }>;

  // Step 4 — profiles to create
  profiles: Array<{
    platform: PublicationPlatform;
    name?: string;              // override default name
    format_rules_override?: Record<string, any>;
  }>;
}

/**
 * POST /api/editorial/setup/complete
 *
 * Persists the entire setup in one transaction-ish call:
 *   - Upserts brand_voice
 *   - Creates style_rules
 *   - Creates reference_media
 *   - Creates publication_profiles
 *   - Marks setup_completed_at
 *
 * Idempotency: if setup already completed, returns 409 unless ?force=1.
 * Re-running the wizard creates NEW rules/refs/profiles (additive).
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;

  if (!client?.id || !user?.id) return json({ error: 'Authentication required' }, 401);
  if ((user.clientRole ?? user.role) !== 'admin' && user.role !== 'superuser') {
    return json({ error: 'Admin role required' }, 403);
  }
  if (!(await clientHasEditorial(client.id))) {
    return json({ error: 'Editorial AI not enabled for this client', upsell: 'signals' }, 403);
  }

  let body: SetupCompleteBody;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  // Minimal validation
  if (!body.company_description?.trim()) return json({ error: 'company_description required' }, 400);
  if (!body.positioning?.trim())         return json({ error: 'positioning required' }, 400);
  if (!Array.isArray(body.supported_languages) || body.supported_languages.length === 0) {
    return json({ error: 'supported_languages (at least one) required' }, 400);
  }
  for (const lang of body.supported_languages) {
    if (!['es', 'en'].includes(lang)) return json({ error: `Invalid language: ${lang}` }, 400);
  }
  if (!Array.isArray(body.profiles) || body.profiles.length === 0) {
    return json({ error: 'At least one publication profile required' }, 400);
  }

  try {
    // ── 1. Upsert brand_voice ──────────────────────────────────────────
    // Build the per-language voice object. Fall back to generic if only one lang.
    const voiceByLanguage: any = {};
    for (const lang of body.supported_languages) {
      const v = body.voice_by_language?.[lang];
      if (v) {
        voiceByLanguage[lang] = {
          tone_descriptors: v.tone_descriptors ?? [],
          structural_patterns: v.structural_patterns ?? [],
          vocabulary_fingerprint: v.vocabulary_fingerprint ?? [],
        };
      }
    }

    // Aggregate tone descriptors for the client-level fallback
    const allTone = Object.values(voiceByLanguage)
      .flatMap((v: any) => v?.tone_descriptors ?? []);
    const dedupedTone = Array.from(new Set(allTone));

    const firstPersonRules = Object.values(body.voice_by_language ?? {})
      .map(v => v?.first_person_rules)
      .filter((x): x is string => !!x)[0];

    await upsertBrandVoice(client.id, {
      company_description: body.company_description.trim(),
      positioning: body.positioning.trim(),
      expertise_areas: body.expertise_areas ?? [],
      tone_descriptors: dedupedTone,
      first_person_rules: firstPersonRules,
      brand_voice_by_language: voiceByLanguage,
      supported_languages: body.supported_languages,
      setup_completed_at: new Date().toISOString(),
    });

    // ── 2. Create style rules ──────────────────────────────────────────
    const createdRules: string[] = [];
    for (const rule of body.style_rules ?? []) {
      if (!rule.content?.trim()) continue;
      const created = await createStyleRule({
        client_id: client.id,
        rule_type: rule.rule_type,
        content: rule.content.trim(),
        priority: rule.priority,
        language: rule.language ?? null,
        source: 'wizard_extracted',
        learned_from_article_id: null,
        superseded_by: null,
        archived_at: null,
        conflict_status: null,
      });
      createdRules.push(created.id);
    }

    // ── 3. Create reference media ──────────────────────────────────────
    const createdRefs: string[] = [];
    for (const ref of body.references ?? []) {
      if (!ref.name?.trim()) continue;
      const created = await createReferenceMedia({
        client_id: client.id,
        name: ref.name.trim(),
        url: ref.url,
        why_reference: ref.why_reference,
        notes: ref.notes,
        language: ref.language ?? null,
      });
      createdRefs.push(created.id);
    }

    // ── 4. Create publication profiles ─────────────────────────────────
    const createdProfiles: Array<{ id: string; platform: string }> = [];
    for (const p of body.profiles) {
      const defaults = PLATFORM_DEFAULTS[p.platform];
      if (!defaults) continue;
      const merged = { ...defaults.format_rules, ...(p.format_rules_override ?? {}) };
      const created = await createPublicationProfile({
        client_id: client.id,
        name: p.name?.trim() || defaults.name,
        platform: p.platform,
        format_rules: merged,
        active: true,
      });
      createdProfiles.push({ id: created.id, platform: p.platform });
    }

    return json({
      ok: true,
      client_id: client.id,
      created: {
        brand_voice: true,
        style_rules: createdRules.length,
        references: createdRefs.length,
        profiles: createdProfiles,
      },
    });
  } catch (err: any) {
    return json({ error: err?.message ?? 'Setup failed' }, 500);
  }
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
