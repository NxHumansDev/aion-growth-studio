/**
 * scripts/send-qa-email.ts
 * Send daily QA summary email (runs at 8am UTC via GitHub Actions).
 *
 * Usage:
 *   npx tsx scripts/send-qa-email.ts
 */

import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { sendDailyReport } from '../src/lib/qa-engine/send-daily-report';

async function main() {
  console.log('[QA:email] Sending daily report...');
  await sendDailyReport();
}

main().catch(err => {
  console.error('[QA:email] Fatal error:', err);
  process.exit(1);
});
