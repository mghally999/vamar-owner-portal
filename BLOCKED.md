# Blocked: needs a click or a credential from the project owner

Each item says exactly what to do. Everything else keeps moving without them.

## 1. Nightly database backups never ran (AUDIT V-050)

The GitHub Actions workflow `.github/workflows/backup.yml` encrypts a `pg_dump` with `age` and
uploads it to the private R2 bucket `vamar-backups`. It needs an R2 API token.

1. Cloudflare dashboard > R2 > **Manage R2 API Tokens** > **Create API token**.
2. Name `vamar-backups-ci`, permission **Object Read & Write**, scope **Apply to specific buckets
   only** > `vamar-backups`, TTL **Forever**. Create.
3. Copy the **Access Key ID** and **Secret Access Key** (shown once).
4. GitHub > repository `mghally999/vamar-owner-portal` > Settings > Secrets and variables >
   Actions > **New repository secret**: `R2_ACCESS_KEY_ID`, then `R2_SECRET_ACCESS_KEY`.
5. Actions > **Nightly database backup** > **Run workflow**. The run must finish green; the restore
   drill in Phase C then uses that artifact.

## 2. Firebase web API key and authorised domain (AUDIT V-041)

1. Google Cloud console > project `vamar-owner-portal-c55c2` > APIs & Services > Credentials >
   the **Browser key (auto created by Firebase)** > **Application restrictions: Websites** > add
   `https://vamar-owner-portal.vamar-api.workers.dev/*` and `http://localhost:5173/*`. Save.
2. Firebase console > Authentication > Settings > **Authorised domains** > Add domain
   `vamar-owner-portal.vamar-api.workers.dev`. Needed before the owner web app at `/app` (Phase E)
   can sign owners in with their phone.

## 3. Accounts for Phase C (one sign-in each, then the setup is scripted)

- **Sentry**: create a free account at sentry.io, one organisation `vamar`, then run
  `npx sentry-wizard` is **not** needed; give the DSNs (one for the API, one for the dashboard, one
  for the app) by pasting them into `.local/sentry.env` as `SENTRY_DSN_API=`, `SENTRY_DSN_DASHBOARD=`,
  `SENTRY_DSN_MOBILE=`.
- **Uptime check**: create a free account at betterstack.com (or uptimerobot.com) and add a monitor
  for `https://vamar-owner-portal.vamar-api.workers.dev/readyz` every 3 minutes, alert to your
  e-mail. Nothing in the code depends on it.

## 4. Docker Desktop

Docker Desktop is installed but was not running during the audit. Start it once so the
`docker compose` smoke test in Phase C can run (`docker compose up --wait`).

## 5. Keystore and credentials backup (Phase E)

EAS holds the Android signing key. After the production build in Phase E, run
`eas credentials --platform android` and choose **Download credentials**; keep the file in the
password manager, not in the repository.
