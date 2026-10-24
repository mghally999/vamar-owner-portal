# Vamar Owner Portal, engineering notes

Owner mobile app (Expo), staff dashboard (React + Vite) and one API (Hono on Cloudflare Workers)
for Vamar Real Estate. Owners see their cheques, units, occupancy and disputes; Vamar staff enter
the data and update cheque statuses by hand. No bank, Ejari or government integrations.

## Repository layout

```
apps/
  api/          Hono Worker; also serves the built dashboard as static assets
  dashboard/    React + Vite SPA, TanStack Router/Query/Virtual, Tailwind v4
  mobile/       Expo app, Expo Router, EAS builds
packages/
  shared/       Pure business rules: dates, money, cheque schedule, state machine, shares,
                occupancy, alerts, i18n labels, zod schemas. Fully unit tested.
  db/           Drizzle schema, SQL migrations, seed script, Node/Neon clients.
  tokens/       Design tokens (colours, type scale, spacing, radii, logo) + generated CSS.
tooling/
  postgres/     init SQL for the optional Docker database (roles)
  firebase/     Firebase Auth emulator config (used natively by tooling/dev/start.mjs and by Docker)
  dev/          start.mjs (one-command local stack), demo and staff helper scripts
.github/workflows/ci.yml   typecheck, lint, format check, tests on every push
```

Internal packages (`@vamar/shared`, `@vamar/db`, `@vamar/tokens`) export TypeScript source
directly. Every consumer is a bundler (wrangler, Vite, Metro, Vitest, tsx), so there is no build
step and no stale `dist` to chase. `@vamar/tokens` has one build step that writes `dist/tokens.css`
for the dashboard.

## Local development

Prerequisites: Node 24 (`.nvmrc`), pnpm 12 (`npm i -g pnpm`). Docker is optional: without it,
install PostgreSQL 17 and a JDK (`winget install PostgreSQL.PostgreSQL.17 Microsoft.OpenJDK.21`)
plus `npm i -g firebase-tools`; `pnpm dev` then starts Postgres, the Firebase Auth emulator, the
API and the dashboard itself (`tooling/dev/start.mjs`). With Docker, `pnpm dev:docker` uses
`docker-compose.yml` instead.

On this machine the EDB installer's service occupies port 5432, so a user-level cluster lives at
`C:\dev\pgdata` on **5433** (`.env` points there). Local secrets for the API live in
`apps/api/.dev.vars` (copy `.dev.vars.example`).

```
cp .env.example .env
pnpm install
pnpm infra:up          # local Postgres 17 cluster + native Firebase Auth emulator (Docker: pnpm dev:docker)
pnpm db:migrate        # apply SQL migrations
pnpm db:seed           # realistic demo data (see "Demo accounts")
pnpm check             # typecheck + lint + tests for every package
pnpm dev               # infra + API + dashboard in watch mode (pnpm demo:android adds the emulator)
```

- Postgres: `postgres://vamar:vamar@localhost:5433/vamar` (5432 with Docker). The local cluster logs
  every statement (`C:\dev\pgdata\*.log`), so N+1s are visible. API integration tests and the db
  package tests run on PGlite in-process; no database service is needed for `pnpm test`.
- Firebase Auth emulator: http://localhost:9099, UI at http://localhost:4000, project `demo-vamar`.
  OTP codes are printed in the emulator UI; no SMS is ever sent.
- `pnpm db:reset` drops, migrates and reseeds the local database (refuses non-local hosts).
- `pnpm db:generate` writes a new migration after a schema change; review the SQL before committing.
- `pnpm db:studio` opens Drizzle Studio.
- `pnpm dev` also recreates the two demo staff accounts in the Auth emulator on every start
  (the emulator forgets them when it is killed without exporting), with fixed uids that match
  the seed's `firebase_uid` values.

### Android emulator (owner app demo without a phone)

The app is a dev build (native Firebase), so it needs the Android SDK, not Expo Go. The SDK is
installed per user, no admin rights needed, and nothing in the repo depends on its path:

1. Command-line tools from https://developer.android.com/studio#command-line-tools-only unzipped
   to `%LOCALAPPDATA%AndroidSdkcmdline-toolslatest`, then
   `sdkmanager --licenses` and
   `sdkmanager "platform-tools" "emulator" "platforms;android-36" "build-tools;36.0.0" "system-images;android-36;google_apis_playstore;x86_64"`.
2. `ANDROID_HOME` user variable = that `Sdk` folder; `platform-tools`, `emulator` and
   `cmdline-toolslatestin` on PATH. JDK 17 or 21 (`JAVA_HOME`); the Microsoft OpenJDK 21
   used by the Firebase emulator works.
3. **Windows Hypervisor Platform** must be enabled (Settings > Optional features > More Windows
   features, or `Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform` as admin)
   and the machine restarted; with Hyper-V / WSL present, the emulator cannot use any other
   accelerator.
4. AVD: `avdmanager create avd -n Vamar_Demo -k "system-images;android-36;google_apis_playstore;x86_64" -d pixel_7`,
   then in `~/.android/avd/Vamar_Demo.avd/config.ini` set `hw.lcd.width = 720`, `hw.lcd.height = 1600`,
   `hw.lcd.density = 320`, `hw.ramSize = 2048`. On this laptop the AMD driver gives a black window
   with `-gpu host`, so the emulator runs with `swiftshader_indirect` (software rendering); the
   smaller screen keeps it responsive. Never run a Gradle build while the emulator is open.
5. First install of the dev build: `pnpm --filter @vamar/mobile android` (runs `expo run:android`,
   several minutes the first time). After that `pnpm demo:android` starts Postgres, the Auth
   emulator, the API, the AVD and Metro, and opens the app.

Inside the emulator the app reaches the host through `10.0.2.2` (`apps/mobile/.env.development`).
The placeholder `apps/mobile/firebase/google-services.json` (copied from the example) is enough
for the Auth emulator; real files are only needed for a real Firebase project.

The seed and migration test in `packages/db` runs against PGlite (in-process Postgres), so
`pnpm test` works with no Docker and CI needs no database service for it.

## Demo accounts

Owners sign in with phone + SMS code. These numbers must be registered as Firebase **test phone
numbers** (Authentication > Sign-in method > Phone > Phone numbers for testing) so no SMS is sent.
In the emulator the code is shown in the UI, but only these seeded UAE numbers can sign in: the API
refuses numbers outside `ALLOWED_PHONE_COUNTRIES` and numbers that are not in `owners`.

| Owner              | Phone         | Code   | Language | Notes                                    |
| ------------------ | ------------- | ------ | -------- | ---------------------------------------- |
| Khalid Al Mansoori | +971500000001 | 123456 | ar       | 8 apartments, 30 % of 4 villas           |
| Fatima Al Suwaidi  | +971500000002 | 123456 | ar       | 4 apartments + 60 % of 2 shared ones     |
| Omar Haddad        | +971500000003 | 123456 | en       | offices and warehouses, shares in others |
| Mariam Al Qasimi   | +971500000004 | 123456 | ar       | Sharjah building incl. 2 shops           |
| Rashid Bin Touq    | +971500000005 | 123456 | en       | 50 % of 4 villas                         |

Use **+971500000001** as the App Store reviewer demo account.

Staff (dashboard, Firebase email + password, then TOTP): `admin@vamar.test` (Admin) and
`entry@vamar.test` (Data entry). The client has two dashboard users, so the UI shows only these two
roles; the read-only `viewer` role stays in the API and tests. Emulator passwords are in `DEMO.md`;
real passwords are set in the Firebase console, never in this repo. During the client trial the two
demo accounts have 2-step login switched off (`totp_required = false`, see "Decisions"). The sign-in
exchange lets an account skip the authenticator only when its row says so, the Worker variable
`DEMO_TRIAL` is `"true"` and its e-mail is in `DEMO_TRIAL_EMAILS` (`apps/api/src/config.ts`);
every other account, admins included, gets the TOTP step whatever its row says. The dashboard
refuses to switch 2-step off for admins and outside the trial, and `pnpm staff:reset-totp --off`
follows the same rules. TOTP codes are single use: a code that signed in once is refused until the next 30 s step.

## Data model notes

- `uuid` primary keys, **v7** generated in application code (`uuid` package). Postgres 17 on Neon
  has no native `uuidv7()`; generating in code keeps dev and prod identical and keeps inserts
  index-friendly.
- Money is **bigint fils** in Postgres (1 AED = 100 fils) and a plain JS `number` of fils in code
  and over the wire. Safe integers reach 2^53 fils (about 90 trillion AED). Every money helper
  rejects non-integers; share maths uses BigInt internally.
- Business dates are Postgres `date` columns handled as `YYYY-MM-DD` strings (`PlainDate`) in
  Asia/Dubai. No JS `Date` is used for a calendar date anywhere.
- Enums are real Postgres enums mirroring the constants in `@vamar/shared`.
- `audit_log` and `cheque_events` are append-only: the runtime role `vamar_app` has no UPDATE or
  DELETE on them (migration `0001_app_role_grants`). The role is created by
  `tooling/postgres/init/01-roles.sql` locally and by hand on Neon; the grants migration is a
  no-op until the role exists, then re-running `pnpm db:migrate` is not needed because the grant
  block is idempotent and can be re-run with `psql -f`.

### Indexes and why

| Index                                                                          | Why                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cheques (due_date)`                                                           | Month switchers and the daily "due in 3 days" selection.                                                                                                   |
| `cheques (contract_id)`                                                        | Cheque grid per contract, contract detail, unit detail.                                                                                                    |
| `cheques (due_date) WHERE status IN ('upcoming','deposited')`                  | Owner home "this month expected / pending" and the dashboard overview only look at money still in flight; the partial index is a fraction of the full one. |
| `cheques (contract_id, seq) UNIQUE`                                            | One row per position in the schedule.                                                                                                                      |
| `contracts (unit_id, status)`                                                  | Occupancy ("active contract for this unit?") and unit detail.                                                                                              |
| `contracts (end_date) WHERE status='active'`                                   | Daily 60/30-day ending alerts and the expiry job scan only active rows.                                                                                    |
| `unit_ownerships (owner_id)`                                                   | Every owner query starts from "units this owner has a share in".                                                                                           |
| `unit_ownerships (unit_id)`                                                    | Share validation and "who to notify" on a bounce.                                                                                                          |
| `disputes (unit_id, status)`                                                   | Open disputes count on the owner home, dispute list per unit.                                                                                              |
| `notification_log (dedupe_key) UNIQUE`                                         | Makes the cron idempotent: a re-run cannot send twice.                                                                                                     |
| `sessions (token_hash) UNIQUE`                                                 | Refresh lookup; `(expires_at)` for cleanup.                                                                                                                |
| `audit_log (entity_type, entity_id, at)`, `(actor_type, actor_id, at)`, `(at)` | Audit viewer filters by entity, actor and date.                                                                                                            |

Lists use keyset pagination on `(due_date, id)` or `(created_at, id)`; never OFFSET.

## Business rules (all in `packages/shared`, all unit tested)

- **Cheque schedule** (`schedule.ts`): if 12 is divisible by n, due dates are
  `start + k * 12/n months` from the original anchor, clamped to month end (31 Jan, 28 Feb,
  31 Mar...). Otherwise dates are spread evenly by days, rounded. Rows start with empty amounts.
  `validateChequeGrid` gives the live total vs annual rent, missing rows and duplicate numbers.
- **State machine** (`cheques.ts`): upcoming -> deposited | cancelled; deposited -> cleared |
  bounced; bounced -> deposited | replaced; cleared/replaced/cancelled terminal. Admin override
  of a terminal status needs a reason. `transitionCheque` returns the side effects (stamp column,
  needs replacement cheque, notify owners) that the API applies in one transaction.
- **Shares** (`shares.ts`): floor each share, give leftover fils one by one to the largest shares,
  ties by owner id; parts always sum to the cheque. 500 randomised cases in the tests.
- **Occupancy** (`occupancy.ts`): occupied on d if an active contract has start <= d <= end.
  Vacant since = end of the latest non-draft contract that ended before d, else never rented.
- **Alerts** (`alerts.ts`): due in exactly 3 days, ending in exactly 60/30 days, expire
  yesterday's contracts, `dedupeKey = type:entityId:date`, Expo batches of 100.
- **Money and dates** (`money.ts`, `dates.ts`): `12,500 درهم` / `AED 12,500`,
  `15 أكتوبر 2026` / `15 Oct 2026`, Western digits always, month names fixed (not ICU dependent).

## Design tokens and brand

The official logo (sent by Hanan, PULSE Media, 14 Sep 2026; confirmed by Eng. Sultan) lives in
`packages/tokens/assets/brand` with its README. Navy `#162842` is the primary colour, silver
`#C4C6BE` is used only for the logo and small accents on navy, the background is the warm
off-white `#F5F4EF`. The V monogram that vamar.ae shows is not the official logo and is not used
anywhere. The dashboard renders the single-colour SVGs through a CSS mask so they take the text
colour; the app uses the PNG variants, the 1024 px icon, the Android adaptive icon and the splash
logo on a navy background. A unit test asserts WCAG AA contrast for text and status chips in both
themes. `pnpm --filter @vamar/tokens build` writes `dist/tokens.css` for Tailwind v4.

## Free-tier constraints designed for

- Workers Free: 10 ms CPU per request. Handlers are I/O bound: no hashing (Firebase does it),
  no PDF (expo-print on the phone), no Excel parsing (SheetJS in the browser). Measured CPU on the
  live Worker (AUDIT.md section 6.2): 1 ms for `/healthz`, 8 ms for the database probe; the wall
  clock is dominated by Neon round trips (~100 ms each from the edge), which is why the overview
  runs its queries together and every list is paged.
- Neon Free suspends after ~5 min idle; first request ~1 s. Every screen shows skeletons.
- Exactly one cron trigger (daily alerts at 04:00 UTC = 08:00 Dubai).
- Reads use the Neon HTTP driver; multi-statement writes open a per-request `Pool` (10 s connect
  deadline) closed with `ctx.waitUntil(pool.end())`. Outbound calls (Expo push, R2) go through
  `util/outbound.ts` with deadlines and jittered retries.

## Security notes

- Owner isolation: owner id comes only from the verified session; every owner query is scoped
  through `unit_ownerships` by one helper, with an integration suite proving owner A gets 404 on
  owner B's data. Access tokens are also checked against the session row (60 s per-isolate cache),
  so "sign out other devices", "disable owner" and "deactivate staff" bite within a minute.
- Firebase project must have **SMS region policy restricted to the UAE** and a **billing budget
  alert**, to limit SMS abuse. Use test phone numbers for development and the reviewer account.
- TOTP lockout: 5 failures lock for 15 minutes (`staff_users.totp_failures`, `totp_locked_until`).
- Rate limits live in `rate_limits` (fixed windows per IP and per phone/email).
- Never log tokens, OTPs, full phone numbers (mask to the last 3 digits) or file contents.
- **Backups**: `.github/workflows/backup.yml` runs nightly at 00:30 UTC: `pg_dump`, gzip,
  `age` encryption to a public key, upload to a private R2 bucket through its S3 API, delete
  objects older than 30 days. Secrets: `BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`,
  `R2_ACCOUNT_ID`, `R2_BACKUP_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The age
  private key is kept offline by Vamar's admin; restore =
  `age -d -i key.txt file.sql.gz.age | gunzip | psql "$DATABASE_URL"`.

## Decisions

- **Roles in the UI: Admin and Data entry only** (client has one admin and one data-entry
  employee). `viewer` remains in the API for a future read-only user.
- **No Docker required for development.** `tooling/dev/start.mjs` starts a local Postgres cluster,
  the Firebase emulator (native JDK) and both dev servers; `docker-compose.yml` stays for people
  who have Docker.
- **Database drivers per environment.** Neon HTTP for reads and a per-request Neon Pool for
  transactions in deployed Workers (locked decision); plain `pg` when `DATABASE_URL` points at
  localhost because the Neon drivers only speak to Neon's proxy; tests inject a PGlite database.
- **Rate limits, TOTP failure counters and refresh-token replay detection run on an autocommit
  connection before the transaction**, otherwise the failing request would roll back the very
  record that is supposed to count against it.
- **Owner-isolation helper.** Every owner query is scoped through `owner-scope.ts`
  (`unit_ownerships` with `to_date IS NULL`); the isolation test suite proves 404s across owners.
- **Dashboard uses `request<T>()` with explicit response interfaces** on top of the Hono `hc`
  client; the route tree's inferred types are kept for the client but query strings and multipart
  uploads are easier to type explicitly.
- **TanStack Router with code-based routes** (no generated route tree) so typecheck and CI need no
  generation step.
- **Logo via CSS mask** in the dashboard so one SVG serves navy and silver without duplicating
  files; PNGs in the app.
- **Allowed owner phone countries** are a config value (`ALLOWED_PHONE_COUNTRIES`, default `AE`)
  checked at exchange time, so adding a country is a Worker var change.

- **Dashboard form controls are full width unless the caller passes a width class** (`w-40`,
  `flex-1`...), implemented in one `widthClass` helper; `cx` does not merge Tailwind classes, so
  a fixed `w-full` in the base class used to win over the caller's width.
- **Playwright runs with one worker and a global setup** that clears rate-limit rows and resets
  the demo staff's authenticator in the local database, so the first login of every run enrols
  TOTP and the helper reads the secret from the screen. The setup refuses non-local hosts.
- **2-step login (TOTP) is mandatory but can be switched off per staff account** (`staff_users.totp_required`,
  admin checkbox on Staff users, or `pnpm staff:reset-totp <email> --live --off`). **Trial decision
  (14 Oct 2026):** switched off for the two demo accounts `admin@vamar.test` and `entry@vamar.test`
  while Vamar tries the live dashboard, so Mr Abdallah signs in with email and password only. It
  stays on by default for every real staff account. The trial ends with `DEMO_TRIAL = "false"` in
  `apps/api/wrangler.jsonc` (GOLIVE.md): from then on the two demo accounts need the authenticator
  too, and `--on` restores their rows. A wrong code returns 403 `totp_invalid` (never 401, which the dashboard reserves
  for an expired session and answers with a redirect to `/login?reason=expired`). A separate
  account `tester@vamar.test` (role editor, 2-step on) exists in the live Firebase Auth and
  database for Playwright checks of the TOTP flow; it is kept deactivated between runs.
- **Neon runtime role created by SQL, never from the console/CLI**, so that it is a plain role
  without `neon_superuser` and the append-only audit grants hold (see "Setup I must do").
- **Android SDK via command-line tools, not Android Studio**, so no admin install is needed and
  the setup is reproducible from PROJECT.md; Android Studio can be added later for its GUI.
- **Owner app on the emulator, lessons that are now code or config.** Hermes has no global
  WebCrypto, so the device id comes from `expo-application` (Android ID / iOS vendor id) instead of
  `crypto.getRandomValues`. Android cannot load `.woff2` fonts natively, so the app and the PDF
  statement embed the TTF files. The dev build must carry the demo `google-services.json`
  (project `demo-vamar`) to talk to the Auth emulator; the real file is an EAS secret file
  (`GOOGLE_SERVICES_JSON`) used only by cloud builds. Android 12+ masks the splash image in a
  circle, so Android gets the square mark-only `splash-android.png`. Expo writes the iOS locale
  keys into Android `strings.xml` and lint fails the release build; `plugins/withAndroidLocales.js`
  keeps only the localised `app_name`. Android measures shaped Arabic slightly narrower than it
  draws it and clips the last glyphs; the `Text` primitive sets `includeFontPadding: false` plus a
  2 px end padding. Metro resolves the shared packages' `./x.js` specifiers back to `.ts`
  (`metro.config.js`) and ignores the native build folders. `tooling/dev/emu.sh` drives the
  emulator from scripts (dump, tap by text, type, wait, screenshot, Auth-emulator OTP).
- **Internal packages export source, not `dist`.** All consumers bundle; removes a build step
  and stale-output bugs. Turborepo calls this "just-in-time packages".
- **Money as `number` fils in code, `bigint` in Postgres.** Safe to 2^53 fils; avoids BigInt JSON
  pain in two apps. Share maths uses BigInt to avoid intermediate overflow.
- **UUID v7 generated in code**, not in the database (no native `uuidv7()` on Postgres 17).
- **PGlite for the db package tests and the API integration tests** so migrations, the seed and
  every endpoint are verified in-process, without Docker or a database service in CI.
- **Node `pg` driver locally, Neon drivers in the Worker.** Same Drizzle schema and types; the
  service layer never sees the driver.
- **Firebase emulator runs natively** (`firebase-tools` + a JDK) from `tooling/dev/start.mjs`;
  the Docker compose file remains for machines that prefer it.
- **Dispute case numbers** `D-YYYY-NNNN` from a per-year counter table, assigned in the service.
- **Attachments** also carry `file_name` (not in the brief) so downloads keep their original name.
- **`rate_limits` and `dispute_counters` tables** added beyond the brief's list; both are needed
  by rules the brief does specify (rate limiting, case numbers).
- **Fixed Arabic/English month names** instead of `Intl.DateTimeFormat` so dates render
  identically on every phone and browser.

## Operations

### Environments

| Environment | URL                                                      | Database              | Files                    | Deployed by                               |
| ----------- | -------------------------------------------------------- | --------------------- | ------------------------ | ----------------------------------------- |
| Production  | https://vamar-owner-portal.vamar-api.workers.dev         | Neon branch `main`    | R2 `vamar-files`         | tag `v*` (Deploy workflow, after staging) |
| Staging     | https://vamar-owner-portal-staging.vamar-api.workers.dev | Neon branch `staging` | R2 `vamar-files-staging` | every green CI run on `main`              |
| Local       | http://localhost:5173 (dashboard), :8787 (API)           | Postgres 17 on 5433   | `apps/api/.dev-files`    | `pnpm dev`                                |
| Docker      | http://localhost:8787                                    | compose `postgres`    | container folder         | `docker compose up -d --build`            |

Staging has its own Worker secrets (`JWT_SECRET`, `TOTP_ENC_KEY`, `DATABASE_URL` for
`vamar_app` on the staging branch), so a token or authenticator from one environment never works
in the other. It uses the same Firebase project (test phone numbers, demo staff accounts) and has
no cron; run the daily jobs there with `POST /api/staff/jobs/daily` as an admin. Connection
strings live in `.local/neon-staging.env` on the dev machine and in the GitHub secrets
`STAGING_DATABASE_URL_OWNER` and `PROD_DATABASE_URL_OWNER` (owner roles, migrations only).

Release: merge to `main`, wait for CI and the staging deploy, check staging, then
`git tag v1.x.y && git push origin v1.x.y`. The production job migrates Neon `main`, deploys and
runs `tooling/ci/smoke.mjs`; the Worker reports the tag as its release. Both deploy jobs need the
`CLOUDFLARE_API_TOKEN` secret (BLOCKED.md item 6) and fail without it; until it exists every
deploy is by hand (HANDOVER.md "How a change reaches people").

### Health, logs, errors

- `/healthz` is liveness (no database); `/readyz` runs `select 1` and returns 503 when the database
  does not answer. Uptime checks point at `/readyz` (BLOCKED.md item 3).
- Every response has `x-request-id` (the Cloudflare ray id). Every API call writes one JSON line
  `{"event":"http","requestId","method","route","status","ms","release"}`; route is the pattern,
  never the query string. Read them with `npx wrangler tail [--env staging] --format json` or in
  the Cloudflare dashboard (Workers > Logs, observability is on).
- Unexpected errors and cron failures go through `apps/api/src/util/report.ts`: always a JSON
  log line, and a Sentry event when the `SENTRY_DSN` Worker secret is set
  (`npx wrangler secret put SENTRY_DSN [--env staging]`). Phone numbers and e-mail addresses are
  masked; no body, header or query string is sent. A 500 response shows the request id so a
  support call can be matched to the log line.

### Backups and restore

Nightly at 00:30 UTC, `.github/workflows/backup.yml` dumps Neon `main`, compresses it, encrypts
it with `age` to the public key in `BACKUP_AGE_RECIPIENT` and uploads it to R2 `vamar-backups`,
keeping 30 days. Neon also keeps 24 hours of point-in-time history on the free plan.

**Restore drill, 22 Oct 2026** (`node tooling/ops/restore-drill.mjs <url> .local/backup-age-key.txt`,
the same pg_dump/gzip/age commands as the workflow, against the staging branch): 127 KB of SQL,
21 KB encrypted; decrypt 3 s, restore into an empty database 6 s, 0 errors; all 19 tables match
the source row for row. That drill restored a fresh dump of staging, not a nightly backup: the
workflow itself has not run yet (R2 key, BLOCKED.md item 1), so no backup exists to restore.

To restore production from a nightly file:

1. Download it: R2 > `vamar-backups` > `postgres/` > the file, or `aws s3 cp` with the R2 key.
2. `age --decrypt --identity backup-age-key.txt vamar-<stamp>.sql.gz.age | gunzip > restore.sql`.
3. Create a new Neon branch (console: Branches > New branch, from an empty point or `main`),
   load the file with `psql "<owner url of the new branch>" -f restore.sql`, check it with the
   drill script's row counts.
4. Point the Worker at it: `npx wrangler secret put DATABASE_URL` with the `vamar_app` URL of the
   new branch, then `node tooling/ci/smoke.mjs https://vamar-owner-portal.vamar-api.workers.dev production`.

For a mistake within the last 24 hours, Neon's point-in-time restore (console: Restore) is
faster than a file.

### Load and capacity

`tooling/load` holds the load runner (`run.mjs`, autocannon), a token script that creates real
sessions (`tokens.mjs`) and the large synthetic dataset of the audit (`large-dataset.sql`). CI runs
a 15-second smoke (20 users, p95 under 1.5 s, no failures) on every push; the manual "Load
comparison" workflow measures any commit on the large dataset. Numbers before and after the
hardening are in AUDIT.md section 9.2.

### Releases and go-live

How a change reaches staging, production and the owner app (APK, over-the-air update, web app) is
in HANDOVER.md; moving production from demo data to Vamar's real data is in GOLIVE.md.

## Setup I must do

Nothing here blocks local development; all of it is for deployed environments or for pushing.

1. **GitHub**: done on 9 Oct 2026, private repo `mghally999/vamar-owner-portal`, CI runs on
   every push. Still to add: the backup secrets listed under "Security notes".
2. **Neon**: done on 9 Oct 2026: project `vamar-owner-portal` (`shy-feather-42564852`, Postgres 17,
   aws-eu-central-1 Frankfurt, the closest Neon region to the UAE), migrated and seeded. The runtime
   role `vamar_app` was created **with plain SQL as `neondb_owner`**, not from the Neon console or
   CLI: roles created through Neon's console/CLI are members of `neon_superuser` and ignore the
   append-only grants on `audit_log` and `cheque_events` (verified: the console role could delete
   audit rows, the SQL role gets "permission denied"). Connection strings live only in
   `.local/neon.env` on the dev machine and in the Worker secret `DATABASE_URL`.
3. **Firebase**: done (project `vamar-owner-portal-c55c2`): Phone and Email/Password sign-in,
   the test phone numbers from "Demo accounts" with code 123456, SMS region policy restricted to
   the UAE, self sign-up disabled, the Android app and the web app registered. Still to do in the
   console (BLOCKED.md): restrict the web API key to the Worker host and add that host to the
   authorised domains before the owner web app at `/app` ships. The Android config file is an EAS
   secret (`GOOGLE_SERVICES_JSON`); a demo copy serves the emulator build.
4. **Cloudflare**: done on 9 Oct 2026. Worker `vamar-owner-portal` (account
   `d79f7d201117913b244dfa7dad50ba26`) serves the dashboard and the API at
   https://vamar-owner-portal.vamar-api.workers.dev with the daily cron; R2 buckets `vamar-files`
   (attachments) and `vamar-backups` (nightly dumps). Secrets set: `DATABASE_URL` (the
   `vamar_app` Neon URL), `JWT_SECRET`, `TOTP_ENC_KEY`. Deploy with
   `pnpm build:web && cd apps/api && npx wrangler deploy --var RELEASE:<tag>` (`pnpm build:web`
   builds the dashboard and exports the owner web app into its `dist/app`; `APP_ENV` is
   `production` in `wrangler.jsonc`; the Worker refuses to serve when a secret is missing or a
   development placeholder is set).
   Static files get their security headers from `apps/dashboard/public/_headers` (the asset layer
   does not run the Worker). Still to set: `FIREBASE_PROJECT_ID` once the real Firebase project
   exists (`--var` or wrangler.jsonc).
   **Backups**: GitHub secrets `BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`, `R2_ACCOUNT_ID`,
   `R2_BACKUP_BUCKET` are set. The age private key is in `.local/backup-age-key.txt` on the dev
   machine (gitignored); copy it to a password manager. Missing: `R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY` from Cloudflare > R2 > Manage R2 API tokens > Create API token
   (Object Read & Write, bucket `vamar-backups`), then `gh secret set R2_ACCESS_KEY_ID` and
   `gh secret set R2_SECRET_ACCESS_KEY`, then run the workflow once by hand (Actions > Nightly
   database backup > Run workflow).
5. **Expo/EAS**: done on 10 Oct 2026: project `@best-coder-alive/vamar-owner-portal`
   (id `7e929192-4d31-4476-a3ef-49e0eeb78760`), Android keystore kept by EAS, preview APK built
   against the live API (link in MEETING.md and `.local/apk-url.txt`). Production profile builds
   an AAB; `eas submit` needs the store accounts listed in STORE.md.
6. **Firebase (real project `vamar-owner-portal-c55c2`)**: done, see item 3. Android app
   `ae.vamar.owner` and web app registered, dashboard production config in
   `apps/dashboard/.env.production`, Worker var `FIREBASE_PROJECT_ID` set; sign-in methods, test
   numbers and the UAE-only SMS region were applied with `.local/firebase-auth-config.mjs`.

## Phase log

- **Phase 1 (2026-10-08)**: API with owner/staff auth, data entry, cheque lifecycle, disputes,
  attachments, audit, daily jobs and the owner-isolation suite; dashboard (login + TOTP, overview,
  owners, buildings and shares, contracts with the cheque grid, cheques, disputes, staff, audit);
  owner app (phone login, home, cheques, properties, disputes, settings); official brand.

- **Phase 0 (2026-10-07)**: monorepo, tooling, CI, Drizzle schema + migrations + indexes, seed
  script, shared business rules with unit tests, tokens from vamar.ae, Docker Postgres +
  Firebase emulator setup.
