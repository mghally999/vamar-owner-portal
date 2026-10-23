// HTTP load against the API with authenticated staff and owner traffic (autocannon).
//
//   node tooling/load/run.mjs <baseUrl> <tokens.json> [scenario] [connections] [seconds] [--max-p95 <ms>]
//
// Scenarios: mixed (1 staff request for every 3 owner requests, rotating owners; the default),
// overview (staff overview only), cheques, ownerhome, office (staff only, all from one IP).
// Prints one JSON line. With --max-p95 it exits 1 when any request failed or p95 is over budget,
// which is how CI runs it as a smoke test. Tokens come from tooling/load/tokens.mjs.
import autocannon from 'autocannon';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const budgetAt = args.indexOf('--max-p95');
const maxP95 = budgetAt >= 0 ? Number(args.splice(budgetAt, 2)[1]) : null;
const [base, tokensFile, scenario = 'mixed', conns = '10', secs = '20'] = args;
if (!base || !tokensFile) {
  console.error('usage: run.mjs <baseUrl> <tokens.json> [scenario] [connections] [seconds]');
  process.exit(2);
}
const tokens = JSON.parse(readFileSync(tokensFile, 'utf8'));
const month = new Date().toISOString().slice(0, 7);

const staffPaths = [
  '/api/staff/overview',
  `/api/staff/cheques?month=${month}`,
  '/api/staff/owners',
  '/api/staff/contracts?status=active',
  '/api/staff/audit',
  '/api/staff/disputes',
];
const ownerPaths = [
  '/api/owner/home',
  '/api/owner/cheques',
  '/api/owner/units',
  '/api/owner/disputes',
];
const owner = (n) => (n % 10 === 0 ? tokens.heavyOwner : tokens.owners[n % tokens.owners.length]);

function pick(n) {
  switch (scenario) {
    case 'overview':
      return { path: '/api/staff/overview', token: tokens.admin };
    case 'cheques':
      return { path: `/api/staff/cheques?month=${month}`, token: tokens.admin };
    case 'ownerhome':
      return { path: '/api/owner/home', token: owner(n) };
    case 'office':
      return {
        path: staffPaths[n % staffPaths.length],
        token: n % 2 ? tokens.admin : tokens.editor,
      };
    default:
      if (n % 4 === 0)
        return { path: staffPaths[(n / 4) % staffPaths.length], token: tokens.admin };
      return { path: ownerPaths[n % ownerPaths.length], token: owner(n) };
  }
}

const tally = {};
const requests = Array.from({ length: 400 }, (_, n) => {
  const r = pick(n);
  const key = r.path.split('?')[0];
  return {
    method: 'GET',
    path: r.path,
    headers: { authorization: `Bearer ${r.token}` },
    onResponse: (status) => {
      if (status >= 300) tally[`${key} ${status}`] = (tally[`${key} ${status}`] ?? 0) + 1;
    },
  };
});

const result = await autocannon({
  url: base,
  connections: Number(conns),
  duration: Number(secs),
  timeout: 30,
  requests,
});
const row = {
  scenario,
  connections: Number(conns),
  seconds: Number(secs),
  requests: result.requests.total,
  rps: Math.round(result.requests.average),
  p50_ms: result.latency.p50,
  p95_ms: result.latency.p97_5,
  p99_ms: result.latency.p99,
  max_ms: result.latency.max,
  non2xx: result.non2xx,
  errors: result.errors,
  timeouts: result.timeouts,
  failures: tally,
};
process.stdout.write(`${JSON.stringify(row)}
`);
if (maxP95 !== null) {
  const failed = result.non2xx + result.errors + result.timeouts;
  if (failed > 0 || result.latency.p97_5 > maxP95) {
    console.error(
      `load smoke failed: ${failed} failed requests, p95 ${result.latency.p97_5} ms (budget ${maxP95} ms)`,
    );
    process.exit(1);
  }
}
