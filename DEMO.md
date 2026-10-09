# Demo guide

Everything below runs on this machine against the seeded local database and the Firebase Auth
emulator. No SMS is sent and no real Firebase project is needed.

## Start everything (one command)

```
cd C:\dev\vamar-owner-portal
pnpm dev
```

This starts PostgreSQL (if it is not already running), the Firebase Auth emulator, the API on
http://localhost:8787 and the dashboard on http://localhost:5173. The emulator UI (where OTP codes
appear) is at http://localhost:4000.

If the database is empty: `pnpm db:migrate && pnpm db:seed`. To start over: `pnpm db:reset`.

## Dashboard logins

| Role       | Email            | Password     |
| ---------- | ---------------- | ------------ |
| Admin      | admin@vamar.test | `Vamar2026!` |
| Data entry | entry@vamar.test | `Vamar2026!` |

These accounts exist in the Firebase emulator (recreated by `pnpm dev` from `tooling/firebase/data`).

**Authenticator code (TOTP).** The first sign-in shows a QR code. Scan it with Google
Authenticator / Microsoft Authenticator / 1Password, or type the key below the QR into any TOTP
app, then enter the 6-digit code. Every later sign-in asks only for the code. If a demo phone is
not at hand, the admin can reset a user's authenticator from **Staff users**, and the dashboard
e2e helper (`apps/dashboard/e2e/helpers.ts`) computes codes from the shown key.

## Owner app logins (phone + OTP)

| Owner              | Phone         | Story                                                   |
| ------------------ | ------------- | ------------------------------------------------------- |
| Khalid Al Mansoori | +971500000001 | 8 apartments in Al Noor Tower + 30 % of 4 Mamzar villas |
| Fatima Al Suwaidi  | +971500000002 | Al Safa Building, two units shared 60/40 with Omar      |
| Omar Haddad        | +971500000003 | Offices and warehouses, English UI, shared units        |
| Mariam Al Qasimi   | +971500000004 | Al Khan Residence (Sharjah) incl. two shops             |
| Rashid Bin Touq    | +971500000005 | 50 % of the Mamzar villas                               |

In the emulator the OTP is **any 6 digits** (the code is also printed at http://localhost:4000
under Authentication). In the real Firebase project these numbers are registered as test numbers
with code `123456`. Any other number gets the polite "not registered, contact Vamar" screen.

## 5-minute click-through

1. **Sign in** to the dashboard as `admin@vamar.test`, scan the QR, enter the code. Point out:
   two steps, nothing stored in the browser, the session ends after 12 hours.
2. **Overview**: the hero number is this month's expected rent, with cleared / pending / bounced
   under it. Scroll: bounced cheques needing action, cheques due in 7 days, contracts ending within
   60 days with a one-click **Renew** button.
3. **Owners**: search "Khalid", open him. Show his units with share percentages and the devices
   list (empty until he signs in on the phone). Create a new owner (phone +9715…); explain that
   this phone number is now allowed to sign in to the app.
4. **Buildings & units**: open Al Safa Building. Units 301 and 302 show two owners (60 % / 40 %).
   Click **Assign owners** on any unit: the total must be exactly 100 % or Save stays disabled.
5. **Contracts → New contract**: pick a building, a vacant unit, a tenant, dates, annual rent
   85,000 and 4 cheques. The schedule is generated (31 Jan → 28 Feb → 31 Mar is handled); type
   amounts or press **Fill equal amounts**, cheque numbers and banks. Save as draft, then
   **Activate**: if the total differs from the rent, a reason is required and audited.
6. **Cheques**: filter by month, building, owner and status. Select a few and **Bulk update** to
   deposited. Open a deposited cheque and **Mark bounced** with a reason: the owner gets a push
   alert and the cheque appears under "needing action"; then **Replace with a new cheque**.
7. **Switch language** (bottom of the sidebar): the whole dashboard flips to English, LTR, same
   Western digits.
8. **Owner app** (screenshots in `demo/screenshots/app`, or the dev build): phone login →
   OTP → home with this month's total, next cheque, "18 of 20 units rented", vacant units,
   open disputes; cheques tab with month and property filters; properties and disputes tabs.

## Screenshots

`demo/screenshots/dashboard` (1440 px and 390 px, Arabic and English) and
`demo/screenshots/app` (phone size, Arabic). Regenerate the dashboard set with
`pnpm --filter @vamar/dashboard e2e -- screenshots` while `pnpm dev` is running.
