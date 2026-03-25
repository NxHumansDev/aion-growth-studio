/**
 * scripts/run-quality-engine.ts
 * Entry point for GitHub Actions (daily 4am UTC).
 *
 * Usage:
 *   npx tsx scripts/run-quality-engine.ts             # 5 domains (default)
 *   npx tsx scripts/run-quality-engine.ts --count 10  # 10 domains
 *   npx tsx scripts/run-quality-engine.ts --domain andbank.com --sector banca_privada
 */

import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { runQualityEngine } from '../src/lib/qa-engine/quality-engine';
import { selectDomains } from '../src/lib/qa-engine/domain-pool';
import type { DomainSelection } from '../src/lib/qa-engine/types';

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI args
  const domainIdx = args.indexOf('--domain');
  const sectorIdx = args.indexOf('--sector');
  const countIdx  = args.indexOf('--count');

  let domains: DomainSelection[];

  if (domainIdx !== -1 && sectorIdx !== -1) {
    // Single domain mode
    domains = [{
      domain: args[domainIdx + 1],
      sector: args[sectorIdx + 1],
    }];
  } else {
    const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 5;
    domains = selectDomains(count);
  }

  console.log(`\n[QA] Starting quality engine — ${domains.length} domain(s)`);
  domains.forEach(d => console.log(`  • ${d.domain} (${d.sector})`));
  console.log('');

  const t0 = Date.now();
  const results = await runQualityEngine(domains);
  const elapsed = Math.round((Date.now() - t0) / 1000);

  const passed = results.filter(r => (r.scores?.overall ?? 0) >= 6).length;
  const withClaude = results.filter(r => r.prompt_for_claude_code).length;

  console.log(`\n[QA] ─── Summary ───────────────────────────────`);
  console.log(`  Evaluated:       ${results.length}/${domains.length}`);
  console.log(`  Score ≥ 6:       ${passed}/${results.length}`);
  console.log(`  With Claude fix: ${withClaude}`);
  console.log(`  Elapsed:         ${elapsed}s`);

  if (withClaude > 0) {
    console.log('\n[QA] Domains with proposed fixes:');
    results
      .filter(r => r.prompt_for_claude_code)
      .forEach(r => console.log(`  • ${r.domain} — overall ${r.scores?.overall?.toFixed(1)}/10`));
  }

  console.log('\n[QA] Done.\n');
}

main().catch(err => {
  console.error('[QA] Fatal error:', err);
  process.exit(1);
});
