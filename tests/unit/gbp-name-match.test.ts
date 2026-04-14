import { describe, it, expect } from 'vitest';

const { nameLooksLikeBrand } = await import('../../src/lib/audit/modules/gbp');

describe('GBP name-similarity filter (nameLooksLikeBrand)', () => {
  describe('rejects unrelated places that share only common short words', () => {
    it('rejects KIKO Milano (cosmetics) for query "Kiko Gámez" (person)', () => {
      // Real-world false positive caught in production. "Kiko" alone (4 chars)
      // is too common — must require the surname "Gámez" (5+ chars).
      expect(nameLooksLikeBrand('KIKO Milano', 'Kiko Gámez')).toBe(false);
      expect(nameLooksLikeBrand('Kiko', 'Kiko Gámez')).toBe(false);
    });

    it('rejects an unrelated 4-char-name shop for a personal brand', () => {
      expect(nameLooksLikeBrand('John\'s Coffee', 'John Smith')).toBe(false);
    });

    it('rejects place names that share zero distinctive words', () => {
      expect(nameLooksLikeBrand('Random Restaurant', 'Acme Consulting')).toBe(false);
    });
  });

  describe('accepts real matches', () => {
    it('accepts when full query is substring of place name', () => {
      expect(nameLooksLikeBrand('Hercesa Promotora Inmobiliaria', 'Hercesa')).toBe(true);
    });

    it('accepts spacing-insensitive match (concatenated brand vs spaced)', () => {
      // Real-world case: clients.name = "Laeuropea", Places returns "La Europea".
      expect(nameLooksLikeBrand('La Europea', 'Laeuropea')).toBe(true);
      expect(nameLooksLikeBrand('Laeuropea', 'La Europea')).toBe(true);
    });

    it('accepts when the surname (≥5 chars) appears as whole word', () => {
      expect(nameLooksLikeBrand('Gámez Consulting Madrid', 'Kiko Gámez')).toBe(true);
    });

    it('accepts case- and accent-insensitive matches', () => {
      expect(nameLooksLikeBrand('ANDBANK ESPAÑA', 'Andbank')).toBe(true);
      expect(nameLooksLikeBrand('Banco Sabadell', 'banco sabadell')).toBe(true);
    });

    it('accepts when concatenated brand splits match a spaced place name', () => {
      // "kikogamez" → splits include "kiko" + "gamez" (each ≥4 chars).
      // Place "Kiko Gámez Studio" contains "gamez" → match.
      expect(nameLooksLikeBrand('Kiko Gámez Studio', 'Kikogamez')).toBe(true);
    });

    it('accepts short names when nothing ≥5 chars exists in query', () => {
      // Fallback to ≥3 chars when no longer distinctive word: "Apple Inc"
      expect(nameLooksLikeBrand('Apple Store Madrid', 'Apple Inc')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns true when query is empty (no filtering)', () => {
      expect(nameLooksLikeBrand('Anything', '')).toBe(true);
    });

    it('returns false when place name is empty', () => {
      expect(nameLooksLikeBrand('', 'Andbank')).toBe(false);
    });

    it('does NOT match a 3-char split of a concatenated brand', () => {
      // "kikogamez" splits at i=4..length-4 → "kiko"+"gamez", "kikog"+"amez",
      // "kikoga"+"mez". None of length 3, so we never produce "kik".
      // Therefore "KIK Records" is NOT a match for "Kikogamez".
      expect(nameLooksLikeBrand('KIK Records', 'Kikogamez')).toBe(false);
    });
  });
});
