# Vamar Owner Portal, engineering notes

Owner mobile app (Expo), staff dashboard (React + Vite) and one API (Hono on Cloudflare Workers)
for Vamar Real Estate. Owners see their cheques, units, occupancy and disputes; Vamar staff enter
the data and update cheque statuses by hand. No bank, Ejari or government integrations.

## Repository layout

```
apps/
  api/          Hono Worker; also serves the built dashboard as static assets   (Phase 1)
  dashboard/    React + Vite SPA, TanStack Router/Query/Table, Tailwind v4     (Phase 1)
  mobile/       Expo app, Expo Router, EAS dev builds                           (Phase 1)
packages/
  shared/       Pure business rules: dates, money, cheque schedule, state machine, shares,
                occupancy, alerts, i18n labels, zod schemas. Fully unit tested.
  db/           Drizzle schema, SQL migrations, seed script, Node/Neon clients.
  tokens/       Design tokens (colours, type scale, spacing, radii, logo) + generated CSS.
tooling/
  postgres/     init SQL for the local Docker database (roles, test database)
  firebase/     Firebase Auth emulator image and config
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
pnpm infra:up          # Postgres 17 + Firebase Auth emulator in Docker
pnpm db:migrate        # apply SQL migrations
pnpm db:seed           # realistic demo data (see "Demo accounts")
pnpm check             # typecheck + lint + tests for every package
pnpm dev               # infra + every app in watch mode (apps arrive in Phase 1)
```

- Postgres: `postgres://vamar:vamar@localhost:5433/vamar` (5432 with Docker) (logs every statement, so N+1s are
  visible in `docker compose logs postgres`). Integration tests use the `vamar_test` database.
- Firebase Auth emulator: http://localhost:9099, UI at http://localhost:4000, project `demo-vamar`.
  OTP codes are printed in the UI and in `docker compose logs firebase`; no SMS is ever sent.
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
numbers** (Authentication > Sign-in method > Phone > Phone numbers for testing) so no SMS is sent;
in the emulator any number works and the code is shown in the UI.

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
real passwords are set in the Firebase console, never in this repo.

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
  no PDF (expo-print on the phone), no Excel parsing (SheetJS in the browser). CPU timings per
  handler will be recorded here from `wrangler dev` in Phase 1+.
- Neon Free suspends after ~5 min idle; first request ~1 s. Every screen shows skeletons.
- Exactly one cron trigger (daily alerts at 04:00 UTC = 08:00 Dubai).
- Reads use the Neon HTTP driver; multi-statement writes open a per-request `Pool` closed with
  `ctx.waitUntil(pool.end())`.

## Security notes

- Owner isolation: owner id comes only from the verified session; every owner query is scoped
  through `unit_ownerships` by one helper (Phase 1), with an integration suite proving owner A
  gets 404 on owner B's data.
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
- **Neon runtime role created by SQL, never from the console/CLI**, so that it is a plain role
  without `neon_superuser` and the append-only audit grants hold (see "Setup I must do").
- **Android SDK via command-line tools, not Android Studio**, so no admin install is needed and
  the setup is reproducible from PROJECT.md; Android Studio can be added later for its GUI.
- **Internal packages export source, not `dist`.** All consumers bundle; removes a build step
  and stale-output bugs. Turborepo calls this "just-in-time packages".
- **Money as `number` fils in code, `bigint` in Postgres.** Safe to 2^53 fils; avoids BigInt JSON
  pain in two apps. Share maths uses BigInt to avoid intermediate overflow.
- **UUID v7 generated in code**, not in the database (no native `uuidv7()` on Postgres 17).
- **PGlite for the db package tests** so migrations and the seed are verified without Docker.
  API integration tests (Phase 1) run on Docker Postgres locally and the Postgres service in CI.
- **Node `pg` driver locally, Neon drivers in the Worker.** Same Drizzle schema and types; the
  service layer never sees the driver.
- **Firebase emulator runs in Docker** (it needs Java) so the only local prerequisite is Docker.
- **Dispute case numbers** `D-YYYY-NNNN` from a per-year counter table, assigned in the service.
- **Attachments** also carry `file_name` (not in the brief) so downloads keep their original name.
- **`rate_limits` and `dispute_counters` tables** added beyond the brief's list; both are needed
  by rules the brief does specify (rate limiting, case numbers).
- **Fixed Arabic/English month names** instead of `Intl.DateTimeFormat` so dates render
  identically on every phone and browser.

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
3. **Firebase**: create the project, enable Phone and Email/Password sign-in, add the test phone
   numbers from "Demo accounts", restrict the SMS region policy to the UAE, set a billing budget
   alert. Download the iOS/Android config files for the app (Phase 1).
4. **Cloudflare**: done on 9 Oct 2026. Worker `vamar-owner-portal` (account
   `d79f7d201117913b244dfa7dad50ba26`) serves the dashboard and the API at
   https://vamar-owner-portal.vamar-api.workers.dev with the daily cron; R2 buckets `vamar-files`
   (attachments) and `vamar-backups` (nightly dumps). Secrets set: `DATABASE_URL` (the
   `vamar_app` Neon URL), `JWT_SECRET`, `TOTP_ENC_KEY`. Deploy with
   `pnpm --filter @vamar/dashboard build && cd apps/api && npx wrangler deploy --var APP_ENV:production`.
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
5. **Expo/EAS**: account and project for dev builds and push notifications (Phase 1/4).

## Phase log

- **Phase 1 (2026-10-08)**: API with owner/staff auth, data entry, cheque lifecycle, disputes,
  attachments, audit, daily jobs and the owner-isolation suite; dashboard (login + TOTP, overview,
  owners, buildings and shares, contracts with the cheque grid, cheques, disputes, staff, audit);
  owner app (phone login, home, cheques, properties, disputes, settings); official brand.

- **Phase 0 (2026-10-07)**: monorepo, tooling, CI, Drizzle schema + migrations + indexes, seed
  script, shared business rules with unit tests, tokens from vamar.ae, Docker Postgres +
  Firebase emulator setup.
