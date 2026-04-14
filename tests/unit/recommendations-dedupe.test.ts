import { describe, it, expect } from 'vitest';

const { findSimilarRecommendation, SIMILARITY_THRESHOLD } = await import(
  '../../src/lib/recommendations/dedupe'
);

describe('Recommendations dedup (findSimilarRecommendation)', () => {
  describe('accepts distinct recommendations', () => {
    it('returns null when no meaningful token overlap', () => {
      const existing = [
        { id: '1', pillar: 'seo', title: 'Publica 4 posts de autoridad al mes' },
        { id: '2', pillar: 'seo', title: 'Añade Schema Article a los posts del blog' },
      ];
      const result = findSimilarRecommendation(
        { pillar: 'seo', title: 'Optimiza los title tags de las páginas pilares' },
        existing,
      );
      expect(result).toBeNull();
    });

    it('does not dedupe across pillars even if titles are similar', () => {
      const existing = [
        { id: '1', pillar: 'reputation', title: 'Publica contenido semanal' },
      ];
      const result = findSimilarRecommendation(
        { pillar: 'seo', title: 'Publica contenido semanal' },
        existing,
      );
      expect(result).toBeNull();
    });
  });

  describe('catches near-duplicates in the same pillar', () => {
    it('literal match (case + accent insensitive)', () => {
      const existing = [
        { id: 'A', pillar: 'web', title: 'Reduce el JavaScript no usado' },
      ];
      const result = findSimilarRecommendation(
        { pillar: 'web', title: 'Reduce el JAVASCRIPT no usado' },
        existing,
      );
      expect(result?.id).toBe('A');
    });

    it('same noun, different verb (filler verbs are stopwords)', () => {
      const existing = [
        { id: 'A', pillar: 'web', title: 'Optimiza velocidad móvil' },
      ];
      const result = findSimilarRecommendation(
        { pillar: 'web', title: 'Mejora la velocidad móvil' },
        existing,
      );
      // Both normalize to {velocidad, movil} — identical → dedup.
      expect(result?.id).toBe('A');
    });

    it('word order / conjugation does not matter', () => {
      const existing = [
        { id: 'A', pillar: 'content', title: 'Publica artículo pilar sobre growth marketing' },
      ];
      const result = findSimilarRecommendation(
        { pillar: 'content', title: 'Artículo pilar de growth marketing publicar' },
        existing,
      );
      expect(result?.id).toBe('A');
    });
  });

  describe('edge cases', () => {
    it('returns null on empty existing list', () => {
      expect(findSimilarRecommendation({ title: 'anything' }, [])).toBeNull();
    });

    it('chooses the highest similarity when multiple exceed the threshold', () => {
      const existing = [
        { id: 'low', pillar: 'seo', title: 'Crea contenido pilar con schema markup' },
        { id: 'high', pillar: 'seo', title: 'Reduce tiempo de carga de imágenes' },
      ];
      const result = findSimilarRecommendation(
        { pillar: 'seo', title: 'Reducir tiempo carga imagenes' },
        existing,
      );
      expect(result?.id).toBe('high');
    });

    it('respects the SIMILARITY_THRESHOLD constant for borderline cases', () => {
      // Partial overlap below threshold should not dedup.
      // "keyword" in both but everything else is different
      const existing = [{ id: 'A', pillar: 'seo', title: 'Atacar keyword gap con contenido pilar' }];
      const result = findSimilarRecommendation(
        { pillar: 'seo', title: 'Mejorar keyword density' },
        existing,
      );
      expect(result).toBeNull();
      expect(SIMILARITY_THRESHOLD).toBe(0.7);
    });
  });
});
