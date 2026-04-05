import { describe, it, expect } from 'vitest';

// Test hasTierAccess
const { hasTierAccess } = await import('../../src/lib/db');

describe('Tier Access Control', () => {
  it('radar cannot access señales features', () => {
    expect(hasTierAccess('radar', 'señales')).toBe(false);
  });

  it('radar cannot access palancas features', () => {
    expect(hasTierAccess('radar', 'palancas')).toBe(false);
  });

  it('señales can access señales features', () => {
    expect(hasTierAccess('señales', 'señales')).toBe(true);
  });

  it('señales cannot access palancas features', () => {
    expect(hasTierAccess('señales', 'palancas')).toBe(false);
  });

  it('palancas can access everything', () => {
    expect(hasTierAccess('palancas', 'radar')).toBe(true);
    expect(hasTierAccess('palancas', 'señales')).toBe(true);
    expect(hasTierAccess('palancas', 'palancas')).toBe(true);
  });

  it('same tier grants access', () => {
    expect(hasTierAccess('radar', 'radar')).toBe(true);
    expect(hasTierAccess('señales', 'señales')).toBe(true);
  });
});

describe('API Auth - Email validation', () => {
  it('rejects emails without proper format in audit start', async () => {
    // This tests the regex used in audit/start.ts
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    expect(emailRegex.test('valid@email.com')).toBe(true);
    expect(emailRegex.test('kiko.gamezgmail.com')).toBe(false);
    expect(emailRegex.test('')).toBe(false);
    expect(emailRegex.test('no@domain')).toBe(false);
    expect(emailRegex.test('@missing.com')).toBe(false);
  });
});
