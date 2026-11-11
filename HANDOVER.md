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

## What v2 added (November 2026)

- **Expenses** for the owners: fixed costs (salaries, DEWA/SEWA, service charges, insurance, lift
  contracts...) and variable costs (repairs, breakdowns, legal fees...), each with its reason, invoice
  number and value, VAT and the invoice file. A posted expense is split to the owners by the ownership
  on its invoice date; a mistake is voided by an admin and replaced by a corrected copy, nothing is
  rewritten. Fixed costs that recur are **recurring rules**: the daily job turns each due date into a
  draft for staff to check and post, and the owner app projects the future ones.
- **Periods everywhere**: the owner app's Home and the dashboard's Overview, Cheques, Expenses and
  Reports show any period (this month by default, this year one tap away) with expected rent,
  collected, outstanding, at risk, expenses and net, and a comparison with the previous period.
- **Work orders** (maintenance and breakdowns) with before and after photos and the paying invoice.
- **Property records**: each unit's status (occupied comes from the contract; staff set vacant, under
  maintenance, reserved or not available with a reason), its numbers (title deed, plot, Makani,
  DEWA/SEWA account, municipality) and a history timeline. Buildings carry plot, Makani, deed, year and
  floors.
- **Disputes and cheques**: a bounced-cheque case is linked to its cheques; the case and cheque numbers
  show everywhere the case appears, including the owner app and the hearing push.
- **Calendar** in both the app and the dashboard, with the public holidays the admin maintains.
- **Settings** (dashboard, **Settings** page, admin only): week start (Monday), the Hijri date (off),
  the "before Vamar's management fee" label (on), the large-expense alert (AED 5,000) and whether
  owners may open invoice files (on). Holidays, expense categories and vendors have their own pages.

## Cheque tools for staff

**Bulk status change.** On **Cheques**, tick the cheques (or the box in the header for every cheque
loaded on the page). A bar shows how many are selected with **Mark deposited**, **Mark cleared**,
**Mark bounced** and **Cancel cheque**. The first three ask for the bank's date (today by default,
never a future date); a bounce also needs a reason, with the common ones one tap away. A cancel, as a
single cancel, needs neither date nor reason (a note is optional) and only applies to upcoming
cheques. It is all or nothing: if any selected cheque cannot
make the move (for example it is still upcoming and you chose cleared), nothing is changed and the
dialog lists each such cheque and why. **Deselect these and go back** keeps the rest selected. Every
cheque gets the same timeline entry and audit row as a single change, and owners of bounced cheques get
the same alert. At most 200 cheques per change.

**Bank statement matching.** **Cheques → Bank statement**. Editors and admins only.

1. Choose the CSV the bank sends. It is read in the browser, never uploaded. Rows above the table
   (account details) are skipped on their own.
2. The first time for a bank, type its name and pick which column holds the date, the amount (or the
   credit amount), and if the file has them the cheque number, the description, a debit/credit
   indicator (CR/DR) or a separate debit column. **Save mapping and find matches** saves it; next
   month the saved bank is picked automatically when its columns are in the file.
3. The page proposes matches against cheques that are upcoming or deposited:
   - **Strong**: the cheque number and the amount match. Ticked for you.
   - **Review**: no cheque number on the line, same amount, within 3 days of the due or deposit date.
     Not ticked; check it before ticking.
   - A line whose description says RETURN, RTN, BOUNCED or مرتجع proposes **Bounced**; other credits
     propose **Cleared**. Other debits (bills, transfers out) are listed under "Lines without a match".
4. **Apply** shows what will happen and asks for the bounce reason ("Returned by the bank" by default).
   Nothing changes before you confirm. An upcoming cheque the bank already paid is first marked
   deposited on the statement date, because the bank only clears a deposited cheque. Each date and
   status is one all-or-nothing step; if a step is refused it stops and lists the cheques, and the
   steps before it stay saved (they were true).

Amounts may have thousands separators, Arabic digits, brackets or a minus for debits; dates may be
dd/mm/yyyy, yyyy-mm-dd or dd-MMM-yyyy. Mappings live in the `bank_csv_mappings` setting.

## Where it runs

| What                    | Address                                                           | Notes                                    |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| Production              | https://vamar-owner-portal.vamar-api.workers.dev                  | Worker `vamar-owner-portal`, Neon `main` |
| Owner web app (iPhone)  | https://vamar-owner-portal.vamar-api.workers.dev/app/             | Add to Home Screen from Safari           |
| App download (one link) | https://vamar-owner-portal.vamar-api.workers.dev/download         | QR code: `demo/download-qr.png`          |
| Staging                 | https://vamar-owner-portal-staging.vamar-api.workers.dev          | Demo data lives here after go-live       |
| Health                  | `/healthz` (the Worker answers), `/readyz` (the database answers) | Checked every 10 min by `uptime.yml`     |
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
   **Daily job (v2).** The one cron trigger (08:00 Dubai) now also creates the draft expenses of the
   recurring rules due in the last seven days, sends the hearing reminder three days before a hearing,
   and on the 1st of each month sends every owner a summary of the month that ended (collected,
   expenses, net). Each push is sent once (dedupe key). Staging has no cron: run it with
   `POST /api/staff/jobs/daily` as an admin.
4. **Owner app.** The v2 owner app is JavaScript only (no new native module): it reaches installed
   apps of version 1.2.0 through `eas update --channel preview` (runtime 1.2.0), no new APK and no
   change to `APP_LATEST_VERSION` or `APP_MIN_VERSION`. The APK is built for 64-bit ARM phones only (`arm64-v8a`, which keeps it near
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
- **Uptime**: the "Uptime" workflow (`.github/workflows/uptime.yml`) calls `/readyz` on
  production and staging every 10 minutes with the built-in GitHub token. Three failed tries open
  an issue labelled `outage` (status code, body excerpt, time); repository watchers get an e-mail.
  While it stays down the issue gets a comment when the status changes and at most hourly
  otherwise; on recovery the run comments and closes it. A red run means the monitor itself could
  not read or write issues, not that the site is down. GitHub may start scheduled runs a few
  minutes late. On a private repository each run counts as about one Actions minute (about 4,300 a
  month); if that is more than the plan includes, change the cron to `*/20`.
- **Errors**: set the `SENTRY_DSN` Worker secret (BLOCKED.md item 3) and every server error goes
  to Sentry with personal data scrubbed; until then errors are in the logs only. Error tracking
  still needs the Sentry account.
- **Backups**: every night at 04:30 Dubai the workflow dumps production, compresses and encrypts
  it with `age`, and keeps it as a private workflow artifact for 35 days (Actions > Nightly
  database backup > the run > Artifacts); with an R2 key (BLOCKED.md item 1, optional) it also
  copies it to R2. Neon keeps 6 hours of point-in-time history on top. Restore: download the
  artifact, then `age --decrypt -i <key file> <file>.sql.gz.age | gunzip | psql "<target url>"`.
  Drill done on 11 Nov 2026 with run 43005702744: restored into a scratch database, all 31 tables
  matched production. Repeat it after any schema change and once a quarter. The decryption key is
  in `.local/` on the dev machine only: keep a copy in the password manager.
- **Load**: the "Load comparison" workflow (Actions > Load comparison > Run) measures any commit on
  the large synthetic dataset; AUDIT.md section 9 has the numbers before and after this round.
- **Secrets**: rotate at go-live (GOLIVE.md step 2) and when anyone with access leaves; the
  rotation record is the table at the end of GOLIVE.md.

## Go-live

GOLIVE.md is the runbook: decide the first admin, fill and rehearse the import template on
staging, take a Neon restore point, rotate secrets and set `DEMO_TRIAL` to `"false"`,
`pnpm golive:blank --confirm`, first sign-in, invite staff, import the eight sheets (owners,
buildings, units, tenants, shares, contracts, cheques, expenses; buildings and units now carry
their identifier columns), check, tell the owners. The blank start
was rehearsed on a scratch database on the staging Neon server on 23 Oct 2026 (log on the dev
machine only) and on a local scratch database during the independent check of 24 Oct 2026.

## Still open

- **BLOCKED.md**: six items that need a click or an account from the project owner (backup key,
  Firebase authorised domain for iPhone sign-in, Sentry account (uptime is done), keystore download,
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
