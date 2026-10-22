#!/usr/bin/env node
/**
 * Fails when a dashboard chunk grows past its gzip budget. Run after `pnpm --filter @vamar/dashboard build`.
 * Budgets are generous versions of the measured sizes (AUDIT.md section 6.6) so a dependency that
 * doubles a chunk is caught, not every byte.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = join(process.cwd(), 'apps', 'dashboard', 'dist', 'assets');
/** gzip bytes */
const BUDGETS = [
  { match: /^react-/, limit: 110_000 },
  { match: /^tanstack-/, limit: 60_000 },
  { match: /^vendor-/, limit: 60_000 },
  { match: /^firebase-/, limit: 45_000 },
  { match: /^index-.*\.js$/, limit: 40_000 },
  { match: /^xlsx-/, limit: 180_000 },
  { match: /\.js$/, limit: 20_000 }, // every route chunk
];
const TOTAL_INITIAL_LIMIT = 260_000; // everything a cold login page downloads (no xlsx, no routes)

let failed = false;
let initial = 0;
for (const file of readdirSync(dist)) {
  if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
  const size = gzipSync(readFileSync(join(dist, file))).length;
  const budget = BUDGETS.find((b) => b.match.test(file));
  const over = budget && size > budget.limit;
  if (/^(react|tanstack|vendor|firebase|index)-/.test(file)) initial += size;
  console.log(
    `${String(size).padStart(8)} gz  ${file}${over ? `  OVER BUDGET (${budget.limit})` : ''}`,
  );
  if (over) failed = true;
}
console.log(`${String(initial).padStart(8)} gz  initial download (limit ${TOTAL_INITIAL_LIMIT})`);
if (initial > TOTAL_INITIAL_LIMIT) failed = true;
if (failed) {
  console.error('bundle budget exceeded');
  process.exit(1);
}
