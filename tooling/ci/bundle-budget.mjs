#!/usr/bin/env node
/**
 * Fails when a dashboard chunk grows past its gzip budget. Run after `pnpm --filter @vamar/dashboard build`.
 * Budgets are generous versions of the measured sizes (AUDIT.md section 6.6) so a dependency that
 * doubles a chunk is caught, not every byte.
 *
 * The initial download is what dist/index.html itself asks for (the entry script, every
 * modulepreload and stylesheet), so a chunk the build starts preloading counts whatever its name.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const distRoot = join(process.cwd(), 'apps', 'dashboard', 'dist');
const dist = join(distRoot, 'assets');
/** gzip bytes */
const BUDGETS = [
  { match: /^react-/, limit: 110_000 },
  { match: /^tanstack-/, limit: 60_000 },
  // lucide-react and Radix's slot: the shell's own small libraries.
  { match: /^vendor-/, limit: 20_000 },
  // zod, react-hook-form and the resolvers: lazy, with the pages that have forms.
  { match: /^forms-/, limit: 45_000 },
  // Firebase Auth: lazy, loaded by the login form only.
  { match: /^firebase-/, limit: 45_000 },
  { match: /^index-.*\.js$/, limit: 40_000 },
  { match: /^xlsx-/, limit: 180_000 },
  // FullCalendar v6 (core and the dayGrid, timeGrid, multiMonth, list and interaction plugins the
  // calendar page needs), loaded only by /calendar, never at start; measured at 79,865 bytes.
  { match: /^fullcalendar-/, limit: 90_000 },
  { match: /\.js$/, limit: 20_000 }, // every route chunk
];
// Everything a cold visit downloads before any route chunk: 157,377 bytes on 21 Nov 2026
// (236,541 before Firebase, the QR encoder, the form libraries and the virtualiser were made lazy).
const TOTAL_INITIAL_LIMIT = 175_000;
/** Chunks that must never be part of the initial download. */
const NEVER_INITIAL = /^(firebase|forms|xlsx|fullcalendar|datepicker)-/;

const html = readFileSync(join(distRoot, 'index.html'), 'utf8');
const initialFiles = new Set(
  [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((m) => m[1]),
);

let failed = false;
let initial = 0;
for (const file of readdirSync(dist)) {
  if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
  const size = gzipSync(readFileSync(join(dist, file))).length;
  const budget = BUDGETS.find((b) => b.match.test(file));
  const over = budget && size > budget.limit;
  const isInitial = initialFiles.has(file);
  if (isInitial) initial += size;
  const eager = isInitial && NEVER_INITIAL.test(file);
  console.log(
    `${String(size).padStart(8)} gz ${isInitial ? '*' : ' '} ${file}${
      over ? `  OVER BUDGET (${budget.limit})` : ''
    }${eager ? '  LOADED AT START (must stay lazy)' : ''}`,
  );
  if (over || eager) failed = true;
}
console.log(
  `${String(initial).padStart(8)} gz   initial download: the ${initialFiles.size} files marked * (limit ${TOTAL_INITIAL_LIMIT})`,
);
if (initialFiles.size === 0) {
  console.error('no assets referenced from dist/index.html');
  failed = true;
}
if (initial > TOTAL_INITIAL_LIMIT) failed = true;
if (failed) {
  console.error('bundle budget exceeded');
  process.exit(1);
}
