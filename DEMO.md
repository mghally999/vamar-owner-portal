# Demo guide

Everything below runs on this machine against the seeded local database and the Firebase Auth
emulator. No SMS is sent and no real Firebase project is needed.

## Start everything

| What                                                 | Command             |
| ---------------------------------------------------- | ------------------- |
| Dashboard demo (DB, Auth emulator, API, dashboard)   | `pnpm dev`          |
| Owner app demo (adds the Android emulator and Metro) | `pnpm demo:android` |

```
cd C:\dev\vamar-owner-portal
pnpm dev            # http://localhost:5173 (dashboard), http://localhost:4000 (emulator UI)
pnpm demo:android   # same stack without Vite, plus the Vamar_Demo emulator and the app
```

Both can run at the same time (`pnpm dev` first, then `pnpm demo:android` in a second terminal;
the second one notices the services that are already up). The emulator UI at
http://localhost:4000 is where phone OTP codes appear.

If the database is empty: `pnpm db:migrate && pnpm db:seed`. To start over: `pnpm db:reset`.
The emulator demo needs the one-time Android setup in `PROJECT.md` (SDK, `Vamar_Demo` AVD,
Windows Hypervisor Platform) and the dev build installed once with
`pnpm --filter @vamar/mobile android`.

## Dashboard logins

| Role       | Email            |
| ---------- | ---------------- |
| Admin      | admin@vamar.test |
| Data entry | entry@vamar.test |

Passwords: demo logins, ask Mohammed. Locally the emulator gives both accounts the local-only
password `LOCAL_STAFF_PASSWORD` (default in `apps/dashboard/e2e/helpers.ts`).

These accounts are recreated in the Firebase emulator every time `pnpm dev` starts.

**During the client trial (from 14 Oct 2026) the two demo accounts sign in with email and password
only**: 2-step login is switched off for them on the live site (`pnpm staff:reset-totp <email>
--live --on` turns it back on; `--off` switches it off; without a flag it only resets the
authenticator so the next sign-in shows the QR again). Real staff accounts always use 2-step login.

**Authenticator code (TOTP), when 2-step login is on.** The first sign-in of each account shows a QR code. Scan it with
Google Authenticator / Microsoft Authenticator / 1Password, or type the key shown under the QR
into any TOTP app, then enter the 6-digit code. Every later sign-in asks only for the code.
Before a demo without the phone that enrolled: sign in as admin, open **Staff users** and
**Reset authenticator** for the account, so the next sign-in shows the QR again.

## Owner app logins (phone + OTP)

| Owner              | Phone         | Language | Story                                                   |
| ------------------ | ------------- | -------- | ------------------------------------------------------- |
| Khalid Al Mansoori | +971500000001 | Arabic   | 8 apartments in Al Noor Tower + 30 % of 4 Mamzar villas |
| Fatima Al Suwaidi  | +971500000002 | Arabic   | Al Safa Building, two units shared 60/40 with Omar      |
| Omar Haddad        | +971500000003 | English  | Offices and warehouses, shared units                    |
| Mariam Al Qasimi   | +971500000004 | Arabic   | Al Khan Residence (Sharjah) incl. two shops             |
| Rashid Bin Touq    | +971500000005 | English  | 50 % of the Mamzar villas                               |

In the local Auth emulator the code is generated per request and shown at
http://localhost:4000 (Authentication tab) and by
`curl http://127.0.0.1:9099/emulator/v1/projects/demo-vamar/verificationCodes`. In the real Firebase project these numbers are
registered as test numbers with code `123456`. Any other number gets the polite "not
registered, contact Vamar" screen.

## 5-minute click-through

1. **Dashboard sign-in** as `admin@vamar.test`: password, then the authenticator code (the two
   demo accounts skip the code during the trial, see above). Point out the two steps, nothing
   stored in the browser, the session ends after 12 hours.
2. **Overview**: the hero number is this month's expected rent, with cleared / pending / bounced
   under it. Below: bounced cheques needing action, cheques due in 7 days, contracts ending
   within 60 days with a one-click **Renew**.
3. **Owner app** (emulator): sign in as **+971500000001** (Khalid), code `123456`, accept or skip
   the fingerprint prompt. Home shows the same month's total, the next cheque, "units rented"
   with the vacant units, and open disputes. Open the **Cheques** tab and keep the app visible.
4. **The change that appears in the app**: in the dashboard open **Cheques**, filter the
   building "Al Noor Tower", open any **deposited** cheque of Khalid and **Mark bounced** with a
   reason. Pull to refresh the app: the cheque turns red with the label "bounced", the home hero
   line shows one bounced cheque, and a push alert was queued for Khalid. Then **Replace with a
   new cheque**: the replacement shows in the app under the same unit.
5. **Owners**: search "Khalid", open him: units with share percentages and the device that just
   signed in. Create a new owner (phone +9715…): this number can now sign in to the app.
6. **Buildings & units**: Al Safa Building, units 301 and 302 have two owners (60 % / 40 %).
   **Assign owners** on a unit: Save stays disabled until the shares total exactly 100 %.
7. **Contracts → New contract**: vacant unit, tenant, dates, annual rent 85,000, 4 cheques. The
   due dates are generated (31 Jan → 28 Feb → 31 Mar is handled); amounts start empty, type them
   or press **Fill equal amounts**, add cheque numbers and banks, **Save as draft**, then
   **Activate**: if the total differs from the rent, a reason is required and audited.
8. **Language**: switch the dashboard to English from the sidebar (same Western digits), and in
   the app from Settings (the app reloads in LTR).

## Screenshots

**Current design (v2)**: `demo/screenshots/v2/dashboard` (every page at 1440 px and 390 px, Arabic
and English, Default and White themes; regenerate with `SCREENSHOT_THEME=white pnpm --filter
@vamar/dashboard e2e -- screenshots` and without the variable for Default) and
`demo/screenshots/v2/app` (home, cheques, properties, disputes, settings and the three detail
screens on an iPhone 13 screen, both themes, both languages; regenerate with
`node tooling/dev/app-screenshots.mjs` after `pnpm build:web` while the API dev server runs).

**First design (v1)**, kept for comparison: `demo/screenshots/dashboard` (1440 px and 390 px, Arabic and English, every page and detail
page), `demo/screenshots/app` (emulator captures: login, OTP, not registered, home, cheques,
cheque detail, properties, unit detail, disputes, dispute detail, settings, account deletion,
statement share; Arabic and English, plus a dark-mode set) and `demo/screenshots/store`
(`pnpm demo:store-shots`: the same frames at Google Play and App Store sizes). App captures are
taken with `tooling/dev/emu.sh shot <file>` while the app runs. Regenerate the dashboard set with
`pnpm --filter @vamar/dashboard e2e -- screenshots` while `pnpm dev` is running; the full flow
tests run with `pnpm --filter @vamar/dashboard e2e`.
