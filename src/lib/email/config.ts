/**
 * Email configuration and test email management.
 *
 * Test emails skip real sending (Resend) but the audit runs normally.
 * This prevents spam during development and QA.
 *
 * HOW TO ADD TEST EMAILS:
 * 1. Add the email to TEST_EMAILS array below
 * 2. Or add a pattern to TEST_PATTERNS (regex)
 * 3. Commit and deploy
 *
 * Any email matching these patterns will:
 * - ✅ Run the full audit pipeline
 * - ✅ Save the lead in Supabase
 * - ❌ NOT send any email via Resend
 * - Console log: "[email] Skipped (test email): xxx@xxx"
 */

// Exact test emails (lowercase)
const TEST_EMAILS: string[] = [
  'test@aiongrowth.com',
  'test@test.com',
  'demo@aiongrowth.com',
  'qa@aiongrowth.com',
];

// Patterns that match test emails
const TEST_PATTERNS: RegExp[] = [
  /^test[\d]*@/i,           // test@, test1@, test123@
  /^demo[\d]*@/i,           // demo@, demo1@
  /^qa[\d]*@/i,             // qa@, qa1@
  /@example\.(com|org|net)$/i,  // RFC 2606 reserved domains
  /@test\./i,               // anything @test.xxx
  /\+test@/i,               // user+test@gmail.com
];

export function isTestEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (TEST_EMAILS.includes(normalized)) return true;
  return TEST_PATTERNS.some(p => p.test(normalized));
}

export function isValidEmail(email: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim());
}
