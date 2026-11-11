# Blocked: needs a click or a credential from the project owner

Each item says exactly what to do. Everything else keeps moving without them. The v2 features
(expenses, calendar, records, dispute cheques) need no new account or credential.

## 1. Nightly database backups (resolved 11 Nov 2026; R2 copy optional)

The nightly workflow `.github/workflows/backup.yml` now works without any new account: it dumps
production with the `postgres:17` image, compresses and encrypts it with `age`, and keeps it as a
private workflow artifact for 35 days. First run 43005702744 (26 KB). Restore drill done the same
day: the artifact was downloaded, decrypted with the offline key, restored into a scratch database,
and all 31 tables matched production row for row.

Optional, for a second copy outside GitHub: an R2 API token for the private bucket `vamar-backups`
(Cloudflare dashboard > R2 > Manage R2 API Tokens > Create API token, name `vamar-backups-ci`,
Object Read & Write, only that bucket), saved as the GitHub secrets `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY`. The workflow copies to R2 as soon as they exist. Keep the age private key
(`.local/backup-age-key.txt`) in the password manager as well: without it no backup can be read.

## 2. Firebase web API key and authorised domain (AUDIT V-041)

1. Google Cloud console > project `vamar-owner-portal-c55c2` > APIs & Services > Credentials >
   the **Browser key (auto created by Firebase)** > **Application restrictions: Websites** > add
   `https://vamar-owner-portal.vamar-api.workers.dev/*` and `http://localhost:5173/*`. Save.
2. Firebase console > Authentication > Settings > **Authorised domains** > Add domain
   `vamar-owner-portal.vamar-api.workers.dev`. Needed before the owner web app at `/app` (Phase E)
   can sign owners in with their phone.

## 3. Accounts for Phase C (one sign-in each, then the setup is scripted)

Monitoring: uptime: done with GitHub Actions; error tracking (Sentry) still needs an account.

- **Sentry**: create a free account at sentry.io, one organisation `vamar`, then run
  `npx sentry-wizard` is **not** needed; give the DSNs (one for the API, one for the dashboard, one
  for the app) by pasting them into `.local/sentry.env` as `SENTRY_DSN_API=`, `SENTRY_DSN_DASHBOARD=`,
  `SENTRY_DSN_MOBILE=`.
- **Uptime (done, no account)**: `.github/workflows/uptime.yml` calls `/readyz` on production
  and staging every 10 minutes; a target that fails three tries in a row gets an issue labelled
  `outage` (GitHub e-mails repository watchers), and the issue is commented on and closed when it
  answers again. It starts once the workflow is on `main`. To be sure the e-mail reaches you: on
  the repository page choose **Watch > All Activity** (or **Custom > Issues**), or set the Actions
  variable `UPTIME_MENTION` to your GitHub login with a leading at-sign.

## 4. Docker Desktop (resolved)

No longer needed: the CI job "Docker image" builds the image and runs the whole compose stack on
every push (green since 23 Oct 2026). Docker Desktop is only needed to run it on this machine.

## 5. Keystore and credentials backup (Phase E)

EAS holds the Android signing key. After the production build in Phase E, run
`eas credentials --platform android` and choose **Download credentials**; keep the file in the
password manager, not in the repository.

## 6. Cloudflare API token for automatic deploys

Staging deploys from `main` and production deploys from a `v*` tag run in GitHub Actions
(`.github/workflows/deploy.yml`). The database and account secrets are already set; the workflow
skips the deploy with a notice until this token exists.

1. Cloudflare dashboard > My Profile > **API Tokens** > **Create Token** > template **Edit
   Cloudflare Workers** > Account Resources: **Include** the Vamar account; Zone Resources: **All
   zones** (no zone is used, the template needs a value) > Continue > Create Token. Copy it.
2. GitHub > repository > Settings > Secrets and variables > Actions > **New repository secret**
   `CLOUDFLARE_API_TOKEN`, paste, Add.
3. Actions > **Deploy** > Run workflow (branch `main`). The staging job must end with
   "smoke test passed".

Until then v2 is deployed by hand like every release so far (HANDOVER.md), including the two new
migrations (0006, 0007), which are applied before the Worker is deployed.
