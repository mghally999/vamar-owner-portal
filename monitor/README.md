# vamar-uptime

A small Cloudflare Worker that watches production and staging every 5 minutes and opens a GitHub
issue labelled `outage` when one of them stops answering. GitHub e-mails repository watchers
about new issues: that e-mail is the alert. On recovery the issue gets a comment and is closed.

It replaces the GitHub workflow as the main monitor because GitHub starts the scheduled
`uptime.yml` only 3 to 5 times a day, so an outage could go unnoticed for hours. Cloudflare cron
triggers run on time. The workflow stays as the backup and watches this Worker (see below).

## What it checks

| When                                   | Request                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Every 5 minutes                        | `GET /healthz` on both targets (the portal Worker answers; no database)                 |
| Every 30 min (production)              | `GET /readyz` instead (the database answers)                                            |
| Every 2 hours (staging)                | `GET /readyz` instead                                                                   |
| While a target is down or has an issue | `GET /readyz` every run, so a database outage is not "recovered" by a `/healthz` answer |

Each request has a 15 s timeout. A failed try is retried once after 20 s, and a target is down
only when both tries fail (about 50 s of failure).

Why `/readyz` is not called every 5 minutes: each call wakes the Neon compute, which then stays
up for 5 minutes. Neon Free gives 100 compute-unit hours a month per project (about 400 hours at
0.25 CU) and its 5-minute suspend cannot be changed. Calling `/readyz` every 5 minutes would keep
the production and staging computes awake around the clock, about 1,460 hours. The quota would run
out in about 8 days, and Neon would then suspend the production database until the next month.
With the slots above, the worst case, a database that is otherwise idle, is about 130 hours a month
for production and 33 for staging: about 40 compute-unit hours at 0.25 CU, out of the 100. Real use of the portal wakes the database anyway and costs the
monitor nothing extra. Change `readyEveryMinutes` in `wrangler.jsonc` (a multiple of 5) to trade
detection time against compute hours.

## Alerts

- **Down**: a new issue `Outage: <target> does not answer /readyz` with the status, time (UTC and
  Dubai), body excerpt and which endpoint failed.
- **Still down**: a comment when the status changes, otherwise at most once every 55 minutes.
- **Recovered**: a comment, then the issue is closed.

The titles, label and `<!-- uptime-status:NNN -->` marker are the same as in
`.github/workflows/uptime.yml`, so either monitor can continue or close an issue the other one
opened. To make sure the e-mail reaches you, choose **Watch > All Activity** (or **Custom >
Issues**) on the repository page, or set `UPTIME_MENTION` in `wrangler.jsonc` to a GitHub login
with a leading at-sign.

The Worker writes the issues as a **GitHub App** (owner step below). This is not a personal token,
it does not expire, and the issues appear as written by `<app name>[bot]`, so the repository owner
gets the e-mail. If issues were written with the owner's own token, GitHub would not e-mail the
owner, because GitHub sends no notification for your own activity.

E-mail straight from Cloudflare (Email Workers `send_email`) is not possible on this account: it
needs Email Routing on a domain (zone) in the Cloudflare account, and the account has no zones.

## Watching the watcher

- `GET https://vamar-uptime.vamar-api.workers.dev/readyz` answers `200 {"ok":true,...}` while the
  cron has run in the last 20 minutes and could reach GitHub, and `503` with the reason otherwise.
  The reasons are "no run recorded yet", "last run N min ago", "alerts off" and "GitHub: ...".
- `GET /status` shows what the last run saw: each target's endpoint, status code, tries and time,
  and any open issue.
- With the repository variable `UPTIME_WORKER_URL` set, each run of the `Uptime` workflow first
  checks that `/readyz`. If it is unhealthy, the workflow opens `Outage: uptime worker does not
answer /readyz` and watches production and staging itself for 9 minutes. If it is healthy, the
  workflow leaves the targets to the Worker.
- A run that could not reach GitHub throws, so it shows as an error in Cloudflare (Workers >
  vamar-uptime > Logs / Cron events).

## Develop and test

No package of its own: it uses the repository's root `node_modules` (wrangler, vitest, typescript).

```sh
cd monitor
npx vitest run                    # 50 tests: retry, state transitions, message text, GitHub App JWT, full runs
npx tsc -p tsconfig.json          # types
npx eslint . && npx prettier --check .
npx wrangler dev --test-scheduled # then: curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
                                  # and   curl http://localhost:8787/status
```

`wrangler dev` without credentials checks the real targets and records the result, but it cannot
alert (`/readyz` says "alerts off"). For local credentials, put them in `monitor/.dev.vars`, which
git ignores.

## Deploy (one time)

1. Deploy the Worker. The first deploy also creates the KV namespace for the `STATE` binding:

   ```sh
   cd monitor
   npx wrangler deploy
   ```

2. After 5 to 10 minutes, `curl https://vamar-uptime.vamar-api.workers.dev/status` should show
   both targets `"up":true`. This confirms the checks work from Cloudflare's network. `/readyz`
   answers 503 "alerts off" until step 4.

3. **Owner step: create the GitHub App** (in the repository owner's account, about 3 minutes):
   1. Open https://github.com/settings/apps/new.
   2. **GitHub App name**: `vamar-uptime`. Names are unique across GitHub, so add a suffix if it
      is taken. **Homepage URL**: `https://github.com/mghally999/vamar-owner-portal`.
   3. **Webhook**: untick **Active**.
   4. **Permissions > Repository permissions > Issues**: **Read and write**. Leave everything else
      at "No access"; Metadata read-only is added automatically.
   5. **Where can this GitHub App be installed?**: **Only on this account**. Click **Create GitHub
      App**.
   6. On the App's page, note the **App ID** (a number near the top). Then go to **Private keys >
      Generate a private key**, and a `.pem` file downloads.
   7. In the left menu, choose **Install App > Install** next to the account, then **Only select
      repositories > vamar-owner-portal > Install**.

4. Give the Worker the App's id and key. Each `secret put` makes a new version of the Worker; no
   redeploy is needed:

   ```sh
   cd monitor
   npx wrangler secret put GITHUB_APP_ID                         # paste the App ID
   npx wrangler secret put GITHUB_APP_PRIVATE_KEY < ~/Downloads/<app>.<date>.private-key.pem
   ```

   In PowerShell, run the second command as
   `Get-Content -Raw "$HOME\Downloads\<file>.pem" | npx wrangler secret put GITHUB_APP_PRIVATE_KEY`.
   Then keep the `.pem` in the password manager and delete the downloaded file.

5. After the next run (5 minutes or less), `curl https://vamar-uptime.vamar-api.workers.dev/readyz`
   should answer `{"ok":true,...}`, and `/status` should show `"alerts":"github-app"` and
   `"github":{"ok":true,"error":null}`. Then tell the workflow to watch the Worker:

   ```sh
   gh variable set UPTIME_WORKER_URL --body https://vamar-uptime.vamar-api.workers.dev
   ```

**Alternative to the App** (not recommended): a fine-grained personal access token limited to this
repository, with only **Issues: Read and write**, stored with
`npx wrangler secret put GITHUB_TOKEN`. It expires, it belongs to a person, and GitHub sends that
person no e-mail for the issues it opens. If both are set, the App is used.

Later deploys of a changed Worker use `cd monitor && npx wrangler deploy`. To remove the monitor,
run `gh variable delete UPTIME_WORKER_URL`, then `npx wrangler delete --name vamar-uptime`.

## Cost (free plans)

| Resource            | Use                                                         | Free allowance                    |
| ------------------- | ----------------------------------------------------------- | --------------------------------- |
| Workers requests    | 288 cron runs a day, plus `/readyz` calls from the workflow | 100,000 a day                     |
| Cron triggers       | 1 (the portal uses 1)                                       | 5 per account                     |
| KV                  | 1 read and 1 write per run (288 each a day)                 | 100,000 reads, 1,000 writes a day |
| Subrequests per run | at most 4 checks and about 7 GitHub calls                   | 50                                |
| CPU per run         | a few ms (one RSA signature for the GitHub App token)       | 10 ms                             |
| GitHub API          | about 3 calls a run while all is well                       | 5,000 an hour per installation    |
| Neon compute        | see "What it checks"                                        | 100 CU-hours a month              |

## Limits

- The Worker runs on Cloudflare, like the portal. If Cloudflare Workers itself fails, the monitor
  fails too. The only alert then comes from the `Uptime` workflow, on its next run (GitHub runs it
  3 to 5 times a day), which finds the Worker's `/readyz` unreachable.
- Detection time is about 1 to 6 minutes for a portal Worker that does not answer, up to 30 minutes
  for a production database outage, and up to 2 hours for staging's database. GitHub's e-mail
  usually follows within a minute.
- If the GitHub App is removed or its key revoked, the Worker keeps checking but cannot alert. Its
  `/readyz` turns 503, and the workflow raises an issue on its next run.
