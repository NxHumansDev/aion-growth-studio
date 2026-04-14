/**
 * Semantic dedup for recommendations.
 *
 * Two recommendations count as "duplicate" when the Jaccard similarity of
 * their normalized token sets is >= SIMILARITY_THRESHOLD, restricted to
 * the same pillar. Normalization strips accents, lowercases, removes
 * stopwords and short tokens so that surface differences don't produce
 * distinct rows:
 *
 *   "Optimiza la velocidad móvil"  → {optimiza, velocidad, movil}
 *   "Mejora tu PageSpeed móvil"    → {mejora, pagespeed, movil}
 *
 * With stopwords removed the overlap is "movil" (1/5 tokens), Jaccard ≈ 0.20
 * — correctly treated as DIFFERENT. But:
 *
 *   "Optimiza la velocidad en móvil"
 *   "Optimizar velocidad móvil"
 *   → {optimiza[r], velocidad, movil} in both → Jaccard ≈ 1.0 → dedup.
 *
 * The goal is conservative: only kill obvious near-identical duplicates so
 * the CEO doesn't see 3 cards saying almost the same thing after weekly
 * regenerations. Real variants ("Mejora LCP" vs "Reduce JS no usado") stay.
 */

const STOPWORDS = new Set([
  // Spanish stopwords + filler verbs commonly used in action titles
  'a', 'al', 'algo', 'algunas', 'alguno', 'algunos', 'ante', 'aqui',
  'como', 'con', 'de', 'del', 'desde', 'donde', 'e', 'el', 'en', 'esa',
  'esas', 'ese', 'eso', 'esos', 'esta', 'estas', 'este', 'esto', 'estos',
  'hasta', 'la', 'las', 'lo', 'los', 'mas', 'mi', 'mis', 'muy', 'nos',
  'o', 'para', 'pero', 'por', 'que', 'se', 'si', 'sin', 'sobre', 'son',
  'su', 'sus', 'tan', 'te', 'ti', 'tu', 'tus', 'un', 'una', 'unas', 'uno',
  'unos', 'y', 'ya',
  // filler action verbs that don't differentiate ("mejora", "optimiza" say
  // nothing about WHAT is being improved — the noun is the signal)
  'mejora', 'mejorar', 'optimiza', 'optimizar', 'aumenta', 'aumentar',
  'crea', 'crear', 'haz', 'hacer', 'añade', 'añadir', 'agrega', 'agregar',
  'reduce', 'reducir', 'implementa', 'implementar', 'configura', 'configurar',
  'activa', 'activar', 'publica', 'publicar', 'genera', 'generar',
  'trabaja', 'trabajar', 'revisa', 'revisar', 'ajusta', 'ajustar',
]);

function normalize(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenize(s: string): Set<string> {
  const tokens = normalize(s)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export const SIMILARITY_THRESHOLD = 0.7;

export interface RecLike {
  id?: string;
  pillar?: string | null;
  title: string;
}

/**
 * Returns the existing recommendation that most closely matches `candidate`,
 * or null if no match clears the similarity threshold. Only compares within
 * the same pillar — cross-pillar matches are valid (e.g. "Publish weekly
 * content" can legitimately appear under both SEO and Reputation).
 */
export function findSimilarRecommendation<T extends RecLike>(
  candidate: RecLike,
  existing: T[],
): T | null {
  const candTokens = tokenize(candidate.title);
  const candPillar = candidate.pillar || null;
  let best: T | null = null;
  let bestScore = 0;

  for (const existingRec of existing) {
    const sameOrUnknownPillar = !existingRec.pillar || !candPillar || existingRec.pillar === candPillar;
    if (!sameOrUnknownPillar) continue;

    // Literal lowercase match always wins (preserves legacy behaviour of
    // the old run-radar.ts dedup).
    if (normalize(existingRec.title) === normalize(candidate.title)) return existingRec;

    const score = jaccard(candTokens, tokenize(existingRec.title));
    if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
      best = existingRec;
      bestScore = score;
    }
  }
  return best;
}
