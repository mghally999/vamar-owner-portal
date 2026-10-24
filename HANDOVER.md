# Handover

Everything someone taking over the Vamar Owner Platform needs on day one: where it runs, how a
change reaches owners, how to keep it healthy, and what is still open. Details live in the
documents linked from each section; this page is the map.

## What it is

- **Owner app** (Android APK and the same app as a web app at `/app` for iPhone): owners sign in
  with their phone number and see their cheques, units, disputes and statements, in Arabic or
  English, in the Default or White theme.
- **Staff dashboard** (`/`): Vamar staff manage owners, buildings, units, tenants, contracts,
  cheques and disputes, import from Excel, and see the audit log. Two-step login is required for
  every staff account. During the client trial the Worker variable `DEMO_TRIAL` is `"true"`, which
  lets only the two listed demo accounts (`admin@vamar.test`, `entry@vamar.test`, list in
  `apps/api/src/config.ts`) skip it; set it to `"false"` on go-live day (GOLIVE.md step 2).
- **API**: one Cloudflare Worker serves the API, the dashboard, the web app and `/download`.
  Data in Neon Postgres, files in R2, sign-in by Firebase Authentication.

## Where it runs

| What                    | Address                                                           | Notes                                    |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| Production              | https://vamar-owner-portal.vamar-api.workers.dev                  | Worker `vamar-owner-portal`, Neon `main` |
| Owner web app (iPhone)  | https://vamar-owner-portal.vamar-api.workers.dev/app/             | Add to Home Screen from Safari           |
| App download (one link) | https://vamar-owner-portal.vamar-api.workers.dev/download         | QR code: `demo/download-qr.png`          |
| Staging                 | https://vamar-owner-portal-staging.vamar-api.workers.dev          | Demo data lives here after go-live       |
| Health                  | `/healthz` (the Worker answers), `/readyz` (the database answers) | Point the uptime check at `/readyz`      |
| Repository              | https://github.com/mghally999/vamar-owner-portal                  | CI on every push, see below              |

Accounts that own pieces of the system: Cloudflare (Workers, R2), Neon (database), Firebase
project `vamar-owner-portal-c55c2` (sign-in), Expo/EAS (Android builds and over-the-air updates),
GitHub (code, CI, backups). Secrets are in the Worker (`wrangler secret`), GitHub Actions secrets
and the dev machine's `.local/` folder, never in the repository.

## Run it locally

`README.md` (quick start) and `PROJECT.md` "Local development" (Postgres on port 5433, Firebase
emulator, Android emulator). `docker compose up -d --build` runs the whole stack (Postgres, the
Auth emulator, migrations with demo data, and the app on http://localhost:8787) for anyone without
the toolchain; the CI job "Docker image" proves it on every push.

## How a change reaches people

1. **Push to `main`.** CI runs typecheck, lint, format, unit and integration tests with coverage
   floors, the dashboard build with its bundle budget, the Worker dry run, the app bundle, the
   secrets scan and dependency audit, Playwright end-to-end plus axe, a load smoke test and the
   Docker stack. Everything must be green.
2. **Staging.** The Deploy workflow deploys `main` to staging, smoke-tests it and runs the iPhone
   web-app test and the staging Playwright run (`pnpm e2e:staging`), but only once the Cloudflare
   token exists (BLOCKED.md item 6). Until then that workflow **fails (red) on every push to
   `main`, on purpose**: nothing has been deployed by CI so far, every deploy has been by hand.
   By hand: `pnpm build:web` (needs `apps/dashboard/.env.production`, the public Firebase web
   config), then `cd apps/api && npx wrangler deploy --env staging --var RELEASE:<sha>`, then
   the checks, from the repository root:

   ```sh
   node tooling/ci/smoke.mjs <staging url> staging
   PWA_URL=<staging url> pnpm --filter @vamar/dashboard e2e:pwa
   STAGING_URL=<staging url> pnpm --filter @vamar/dashboard e2e:staging
   ```

3. **Production** deploys from a version tag (`git tag -a v1.2.0 -m v1.2.0 && git push origin v1.2.0`),
   after staging, once the token exists. By hand: apply migrations first (`pnpm db:migrate` with
   the production owner URL), then `pnpm build:web` and `npx wrangler deploy --var RELEASE:<sha>`,
   then the smoke test. Rollback: `npx wrangler rollback <previous version id>`
   (`npx wrangler deployments list`).
4. **Owner app.** The APK is built for 64-bit ARM phones only (`arm64-v8a`, which keeps it near
   37 MB): it does not install on x86 emulators or Chromebooks; the download page says so. The
   `staging` build profile in `apps/mobile/eas.json` builds the same app against the staging API
   for testing. JavaScript-only fixes: `eas update --channel preview` reaches installed apps of
   the same version on their next launch. Native changes: raise `version` in
   `apps/mobile/app.config.ts`, `eas build --profile preview --platform android`, upload the APK
   (`npx wrangler r2 object put vamar-files/releases/vamar-owner-app.apk --file <apk> --remote`,
   same for `vamar-files-staging`), then set `APP_LATEST_VERSION` in `apps/api/wrangler.jsonc`
   and deploy: installed apps show an update banner. Raise `APP_MIN_VERSION` only when old apps
   must stop working (they then show a blocking "update required" screen). The web app updates
   itself on the next visit.

## Keeping it healthy

- **Logs**: `npx wrangler tail` (production) shows one JSON line per API request with a request
  id; the same id is in the `x-request-id` header and in any error the user reports.
- **Errors**: set the `SENTRY_DSN` Worker secret (BLOCKED.md item 3) and every server error goes
  to Sentry with personal data scrubbed; until then errors are in the logs only.
- **Backups**: **no backup has been taken yet.** The nightly workflow encrypts a database dump to
  R2 once its R2 key exists (BLOCKED.md item 1); until then it fails every night. Neon keeps 24
  hours of point-in-time history on the free plan. The restore drill script
  (`tooling/ops/restore-drill.mjs`) makes a dump the way the workflow does, decrypts it, restores
  it into a scratch database and compares all 19 tables. The only run so far (22 Oct 2026) dumped
  the **staging** branch on the dev machine; it has never restored a real nightly backup. Run it
  on the first nightly file, after any schema change and once a quarter. The decryption key is in
  `.local/` on the dev machine only: keep a copy in the password manager.
- **Load**: the "Load comparison" workflow (Actions > Load comparison > Run) measures any commit on
  the large synthetic dataset; AUDIT.md section 9 has the numbers before and after this round.
- **Secrets**: rotate at go-live (GOLIVE.md step 2) and when anyone with access leaves; the
  rotation record is the table at the end of GOLIVE.md.

## Go-live

GOLIVE.md is the runbook: decide the first admin, fill and rehearse the import template on
staging, take a Neon restore point, rotate secrets and set `DEMO_TRIAL` to `"false"`,
`pnpm golive:blank --confirm`, first sign-in, invite staff, import the seven sheets (owners,
buildings, units, tenants, shares, contracts, cheques), check, tell the owners. The blank start
was rehearsed on a scratch database on the staging Neon server on 23 Oct 2026 (log on the dev
machine only) and on a local scratch database during the independent check of 24 Oct 2026.

## Still open

- **BLOCKED.md**: six items that need a click or an account from the project owner (backup key,
  Firebase authorised domain for iPhone sign-in, Sentry and uptime accounts, keystore download,
  Cloudflare deploy token). Each lists the exact clicks.
- **FUTURE.md**: improvements deliberately left out of this round, each with the reason and size.
- **Client decisions** still to take: who the first admin is; whether owners may export their
  data and when a deletion request is carried out; whether to publish to the App Store and
  Google Play later (the app is ready for both, STORE.md).

## Where things are written down

| Document    | For                                                                 |
| ----------- | ------------------------------------------------------------------- |
| README.md   | What it is, live demo, screenshots, quick start                     |
| PROJECT.md  | Engineering notes: layout, data model, rules, decisions, operations |
| AUDIT.md    | The audit, the defect register, scores before and after             |
| GOLIVE.md   | The go-live runbook and the secret rotation record                  |
| DEMO.md     | Demo accounts and a five-minute click-through                       |
| BLOCKED.md  | What needs the project owner                                        |
| FUTURE.md   | The next round                                                      |
| PROGRESS.md | What was delivered, phase by phase, with the Arabic summaries       |
| STORE.md    | App Store and Google Play listing text, when the time comes         |
