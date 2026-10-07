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

Prerequisites: Node 24 (`.nvmrc`), pnpm 12 (`npm i -g pnpm`), Docker Desktop.

```
cp .env.example .env
pnpm install
pnpm infra:up          # Postgres 17 + Firebase Auth emulator in Docker
pnpm db:migrate        # apply SQL migrations
pnpm db:seed           # realistic demo data (see "Demo accounts")
pnpm check             # typecheck + lint + tests for every package
pnpm dev               # infra + every app in watch mode (apps arrive in Phase 1)
```

- Postgres: `postgres://vamar:vamar@localhost:5432/vamar` (logs every statement, so N+1s are
  visible in `docker compose logs postgres`). Integration tests use the `vamar_test` database.
- Firebase Auth emulator: http://localhost:9099, UI at http://localhost:4000, project `demo-vamar`.
  OTP codes are printed in the UI and in `docker compose logs firebase`; no SMS is ever sent.
- `pnpm db:reset` drops, migrates and reseeds the local database (refuses non-local hosts).
- `pnpm db:generate` writes a new migration after a schema change; review the SQL before committing.
- `pnpm db:studio` opens Drizzle Studio.

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

Staff (dashboard, Firebase email + password, then TOTP): `admin@vamar.test`, `editor@vamar.test`,
`viewer@vamar.test`. Passwords are set in the Firebase emulator / console, not in this repo.

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

`packages/tokens` holds the palette pulled from vamar.ae on 2026-10-07 (navy `#162842` on a
warm off-white `#f5f4ef`, slate accent `#5f7180`) and the stroked "V" monogram from the site
header. Everything brand-related is marked `TEMPORARY: from vamar.ae, replace with official files`.
A unit test asserts WCAG AA contrast for text on every background and every status chip in both
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

## Decisions

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

1. **Docker Desktop** is not installed on this machine. Install it, then `pnpm infra:up`.
2. **GitHub**: `gh` is installed but not logged in. Run `gh auth login`, then from the repo root:
   `gh repo create mghally999/vamar-owner-portal --private --source=. --push`.
3. **Neon**: create a project (Postgres 17), create role `vamar_app`, set `DATABASE_URL` and
   run `pnpm db:migrate` against it, then re-apply `migrations/0001_app_role_grants.sql`.
4. **Firebase**: create the project, enable Phone and Email/Password sign-in, add the test phone
   numbers from "Demo accounts", restrict the SMS region policy to the UAE, set a billing budget
   alert. Download the iOS/Android config files for the app (Phase 1).
5. **Cloudflare**: account for Workers + R2 (private bucket) + one cron trigger. Secrets via
   `wrangler secret put` (names listed in `apps/api/.dev.vars.example` from Phase 1).
6. **Expo/EAS**: account and project for dev builds and push notifications (Phase 1/4).

## Phase log

- **Phase 0 (2026-10-07)**: monorepo, tooling, CI, Drizzle schema + migrations + indexes, seed
  script, shared business rules with unit tests, tokens from vamar.ae, Docker Postgres +
  Firebase emulator setup.
