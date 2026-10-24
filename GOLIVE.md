# Go-live

How production moves from the demo data to Vamar's real data. Read it top to bottom once, then
follow the checklist on the day. Everything here was rehearsed: the blank start on the staging
Neon compute (`.local/golive-drill-staging.log` on the dev machine), the 5,000-row import in the
API test suite (`apps/api/test/import-large.test.ts`).

Demo data stays on **staging** (`vamar-owner-portal-staging`) for training and demos. Production
starts empty.

## Before the day

1. **Decide who the first admin is.** One real e-mail address (for example `ops@vamar.ae`). It
   must be able to receive mail: the first sign-in sends a verification link.
2. **Fill the import template.** Download it from the dashboard (Import page, "Download the
   template") or take `apps/dashboard/public/vamar-import-template.xlsx`. The sheet "اقرأني"
   explains every column in Arabic, with an example per sheet. Seven sheets: Owners, Buildings,
   Units, Tenants, Shares (one row per owner of a unit; a unit's shares add up to 100 %), Contracts
   (no two may overlap on a unit) and Cheques (each names its contract by building, unit and
   start date; amounts in AED). Excel itself refuses wrong languages, unit types, counts, shares
   and dates; the dashboard checks everything again and lists each bad row with its reason (in
   Arabic and English) before anything is saved. Owner phones must be UAE mobile numbers.
3. **Rehearse the import on staging** with the real file: sign in to the staging dashboard, import
   the sheets in this order: Owners, Buildings, Units, Tenants, Shares, Contracts, Cheques, and fix
   what the report lists. A contract is created as a draft and becomes active when its last cheque
   arrives and the cheques add up to the annual rent; when they do not, it stays a draft (the
   report says so) and is activated on its page with a reason. Re-importing is safe: each batch of
   500 rows is keyed by the file's fingerprint, so a batch that already landed returns its earlier
   report, and rows imported before under another key (an edited file) are refused as already
   there (a unit's identical shares are left unchanged).
4. **Firebase.** In the Firebase console, Authentication > Users > Add user: the admin's e-mail
   and a temporary password (the admin changes it after the first sign-in). Remove the demo staff
   users `admin@vamar.test` and `entry@vamar.test` from the production project once the trial is
   over, and the five test phone numbers under Sign-in method > Phone > Phone numbers for testing.

## On the day

All commands run from the repository root on the dev machine. `DATABASE_URL` is the **owner**
connection string of the production Neon branch (`.local/neon.env`, `DATABASE_URL`).

1. **Restore point.** Neon console > project > Branches > `main` > Create branch, name
   `pre-golive-YYYY-MM-DD`, from "Current point in time". This is the way back if anything goes
   wrong (see "Rollback").
2. **Rotate the Worker secrets.** Nobody is signed in after the blank start, so this costs
   nothing on this day and nothing from the trial period stays valid:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # TOTP_ENC_KEY
   cd apps/api
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put TOTP_ENC_KEY
   ```

   Paste each value at the prompt; do not put it in a file or a chat. Also rotate the Neon
   passwords (Neon console > Roles > `vamar_app` > Reset password, then
   `npx wrangler secret put DATABASE_URL` with the new `vamar_app` URL; same for `neondb_owner`,
   then update the GitHub secret `PROD_DATABASE_URL_OWNER`). Record the date in the table below.

   **End the demo trial** in the same step: in `apps/api/wrangler.jsonc` set `"DEMO_TRIAL": "false"`
   for production (and staging if the trial accounts should stop there too), commit, and deploy.
   From then on every staff account, the two demo accounts included, needs the authenticator.

3. **Dry run** (counts only, nothing is changed):

   ```sh
   export DATABASE_URL='<production owner URL>'
   export GOLIVE_ADMIN_EMAIL=ops@vamar.ae GOLIVE_ADMIN_NAME="Vamar Operations"
   pnpm golive:blank
   ```

   Check that the host and database printed are production's.

4. **Blank start:**

   ```sh
   pnpm golive:blank --confirm
   ```

   It empties all 19 application tables in one transaction (the schema and the migrations
   journal stay) and creates the admin as an invitation with two-step login required. Expected
   last line: `blank start done { owners: 0, staff: 1, admin: 'ops@vamar.ae' }`.

5. **Empty the demo files** in the production bucket (dispute attachments, cheque images,
   statements of the demo owners). Keep `releases/` (the Android app):

   ```sh
   cd apps/api
   npx wrangler r2 object list vamar-files --remote          # check what is there
   npx wrangler r2 object delete vamar-files/<key> --remote  # each non-release key
   ```

6. **First sign-in.** Open the dashboard, sign in with the admin e-mail and the temporary
   password. The first attempt sends a verification e-mail; click the link, sign in again, scan
   the QR code with an authenticator app and enter the 6-digit code. Change the password under
   Firebase's reset link if it was shared.
7. **Staff.** The Staff page: invite the other staff members with their roles. Each one goes
   through the same first sign-in. Two-step login is required for every account and cannot be
   switched off for admins.
8. **Import** the real file, sheet by sheet: Owners, Buildings, Units, Tenants, Shares, Contracts,
   Cheques. Then, in the dashboard: activate any contract the report left as a draft (its cheques
   do not add up to the rent), and set the status of cheques that were already deposited,
   cleared or bounced (Cheques page, bulk status).
9. **Check.** `curl https://vamar-owner-portal.vamar-api.workers.dev/readyz` answers
   `{"ok":true,"db":true}`; Overview shows the imported counts; an owner with a real number signs
   in to the app and sees their units.
10. **Tell the owners**: the `/download` link and the QR code (`demo/download-qr.png`).

## Starting from the import only (no blank start)

Not supported on production: the demo owners, units and cheques would be mixed with the real
ones. Always blank-start first.

## Rollback

The blank start is one transaction: if it fails nothing changed. After it succeeded, the way
back is the restore point from step 1: Neon console > Branches > `pre-golive-...` > Set as
default (or Restore `main` from it), then redeploy nothing; the Worker connects to the same host.
The drill in `tooling/ops/restore-drill.mjs` restores a backup into a scratch branch and compares
every table, for checking a backup without touching production.

## Secret rotation record

| Secret                                         | Last rotated | By  | Note                                          |
| ---------------------------------------------- | ------------ | --- | --------------------------------------------- |
| `JWT_SECRET` (production)                      | not yet      |     | go-live step 2                                |
| `TOTP_ENC_KEY` (production)                    | not yet      |     | go-live step 2                                |
| Neon `vamar_app` / `neondb_owner` (production) | not yet      |     | go-live step 2                                |
| `JWT_SECRET`, `TOTP_ENC_KEY` (staging)         | 2026-10-22   | MG  | generated new for staging, never shared       |
| Neon staging roles                             | 2026-10-22   | MG  | new branch `staging`, own passwords           |
| Firebase service account                       | n/a          |     | the API verifies tokens with public keys only |
