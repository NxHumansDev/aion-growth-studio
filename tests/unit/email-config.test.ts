import { describe, it, expect } from 'vitest';
import { isTestEmail, isValidEmail } from '../../src/lib/email/config';

describe('Email Validation', () => {
  it('validates correct emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('name.surname@company.es')).toBe(true);
    expect(isValidEmail('user+tag@gmail.com')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('notanemail')).toBe(false);
    expect(isValidEmail('missing@')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
    expect(isValidEmail('kiko.gamezgmail.com')).toBe(false);
    expect(isValidEmail('spaces in@email.com')).toBe(false);
  });
});

describe('Test Email Detection', () => {
  it('detects exact match test emails', () => {
    expect(isTestEmail('test@aiongrowth.com')).toBe(true);
    expect(isTestEmail('demo@aiongrowth.com')).toBe(true);
    expect(isTestEmail('qa@aiongrowth.com')).toBe(true);
    expect(isTestEmail('test@test.com')).toBe(true);
  });

  it('detects pattern-based test emails', () => {
    expect(isTestEmail('test123@gmail.com')).toBe(true);
    expect(isTestEmail('demo5@company.es')).toBe(true);
    expect(isTestEmail('qa99@anything.com')).toBe(true);
    expect(isTestEmail('user@example.com')).toBe(true);
    expect(isTestEmail('user@example.org')).toBe(true);
    expect(isTestEmail('anything@test.dev')).toBe(true);
    expect(isTestEmail('kiko+test@gmail.com')).toBe(true);
  });

  it('does NOT flag real emails', () => {
    expect(isTestEmail('kiko@aiongrowth.studio')).toBe(false);
    expect(isTestEmail('maria@empresa.com')).toBe(false);
    expect(isTestEmail('ceo@startup.es')).toBe(false);
    expect(isTestEmail('testing.department@bigcorp.com')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isTestEmail('TEST@aiongrowth.com')).toBe(true);
    expect(isTestEmail('Demo@AIONGROWTH.COM')).toBe(true);
  });
});
