# Store listing: Vamar Owner Portal

Everything the Apple App Store and Google Play ask for, in Arabic and English. Copy from here
into App Store Connect and the Play Console. The app is published **unlisted / invite only**
(owners are created by Vamar staff; there is no public sign-up).

| Item               | Value                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| App name           | Vamar / فامار                                                                   |
| Bundle / package   | `ae.vamar.owner` (iOS bundle identifier and Android application id)             |
| Version            | 1.0.0 (build numbers auto-increment through EAS)                                |
| Category           | Business (secondary: Finance)                                                   |
| Privacy policy URL | https://vamar-owner-portal.vamar-api.workers.dev/privacy                        |
| Support URL        | https://vamar.ae                                                                |
| Support contact    | Vamar Real Estate office (phone and email to be confirmed by Vamar)             |
| Marketing URL      | https://vamar.ae                                                                |
| Copyright          | © 2026 Vamar Real Estate                                                        |
| Age rating         | 4+ (Apple) / Everyone (Google). No user-generated content, no ads, no purchases |
| Price              | Free                                                                            |

## Names and descriptions

**Subtitle / short description (max 30 / 80 characters)**

- AR: شيكاتك وعقاراتك مع فامار
- EN: Your cheques and properties with Vamar

**Full description (Arabic)**

تطبيق فامار لملاك العقارات الذين تدير فامار العقارية عقاراتهم. من هاتفك ترى شيكات الإيجار
المستحقة هذا الشهر وحالة كل شيك، من الاستلام إلى الإيداع والصرف، وتصلك إشعارات قبل موعد الشيك
وعند ارتجاعه. تتابع وحداتك المؤجرة والشاغرة ونسبة الإشغال، ومواعيد انتهاء العقود، والمنازعات
الجارية، وتصدر كشف حساب شهرياً أو سنوياً بصيغة PDF.

الدخول برقم الجوال المسجل لدى فامار فقط. التطبيق مخصص لملاك العقارات المتعاقدين مع فامار
العقارية ولا يتيح التسجيل العام.

**Full description (English)**

The Vamar app is for property owners whose buildings are managed by Vamar Real Estate. From your
phone you see the rent cheques due this month and the status of every cheque, from receipt to
deposit and clearance, with alerts before a cheque is due and if one bounces. You follow your
rented and vacant units and occupancy, contract end dates and ongoing disputes, and export a
monthly or yearly statement as PDF.

Sign-in is with the mobile number registered with Vamar. The app is for owners who have a
management agreement with Vamar Real Estate; there is no public registration.

**Keywords (Apple, max 100 characters)**

`vamar,فامار,عقارات,شيكات,إيجار,مالك,دبي,real estate,rent,cheques,owner,dubai`

**What's new (1.0.0)**

- AR: الإصدار الأول: الشيكات، العقارات، المنازعات، كشوف الحساب والإشعارات.
- EN: First release: cheques, properties, disputes, statements and alerts.

## Screenshots

Taken from the emulator in `demo/screenshots/app` (Arabic first, then English, light then dark).
Sizes: Google Play phone 1080 × 1920 or larger (we use 1080 × 2400); Apple 6.7" (1290 × 2796) and
6.5" (1284 × 2778) are produced from the same frames by the `demo/screenshots/store` script.
Order: login, home, cheques, cheque detail, properties, disputes, settings. No tablet support
(`supportsTablet: false`), so no tablet screenshots are required.

## Privacy questionnaire (Apple "App Privacy" and Google "Data safety")

| Data                                       | Collected | Linked to user | Used for                    | Notes                                                            |
| ------------------------------------------ | --------- | -------------- | --------------------------- | ---------------------------------------------------------------- |
| Phone number                               | Yes       | Yes            | App functionality (sign-in) | Verified by Firebase Phone Auth; stored by Vamar as the login id |
| Name                                       | Yes       | Yes            | App functionality           | Entered by Vamar staff, shown in the app                         |
| Email address                              | Optional  | Yes            | App functionality           | Only if Vamar staff entered it                                   |
| Financial info (rent, cheques)             | Yes       | Yes            | App functionality           | The owner's own rental cheques and contracts                     |
| Device identifiers (device id, push token) | Yes       | Yes            | App functionality, security | Push alerts, "sign out other devices", new-device login alert    |
| Diagnostics (crash logs)                   | No        |                |                             | No analytics or crash SDK is included                            |
| Location, contacts, photos, health         | No        |                |                             |                                                                  |
| Tracking / advertising                     | No        |                |                             | No ads, no tracking, no third-party data sharing                 |

- Data is encrypted in transit (HTTPS) and at rest (Neon/Cloudflare). Users can request deletion
  from Settings > Request account deletion (Apple requirement); Vamar staff disable the account
  and revoke sessions.
- Third parties that process data: Google Firebase (phone verification), Expo push service
  (notification delivery), Cloudflare (hosting, file storage), Neon (database).
- Google Play "Data safety": data collected = phone, name, email (optional), financial info,
  device ids; shared = none; encrypted in transit = yes; deletion request = yes (in-app).

## Reviewer demo account and notes

- Phone: **+971 50 000 0001**, SMS code **123456** (registered as a Firebase test number; no SMS
  is sent). Owner "Khalid Al Mansoori" with 12 units, cheques in every status and one dispute.
- Notes for the reviewer (paste into both stores):

  > The app is for property owners under management by Vamar Real Estate; accounts are created by
  > Vamar staff, so there is no sign-up screen. Use the demo phone number above; the verification
  > code is 123456 (test number, no SMS). Biometric unlock is optional and can be skipped.
  > Account deletion is available under Settings.

## Permissions

| Permission                            | Why                                               |
| ------------------------------------- | ------------------------------------------------- |
| Notifications (`POST_NOTIFICATIONS`)  | Cheque and contract alerts (optional, asked once) |
| Biometrics (`USE_BIOMETRIC`, Face ID) | Optional app lock; passcode fallback              |
| Internet                              | API access                                        |

No camera, location, contacts, storage or background location permissions.

## What is still needed from Vamar

1. **Apple Developer Program as an organisation** (USD 99/year) in Vamar's name. Requires a
   **D-U-N-S number** for Vamar Real Estate (free, 1 to 2 weeks from Dun & Bradstreet) and a
   legal signatory with the trade licence. Apple accounts under an individual cannot publish an
   app branded Vamar.
2. **Google Play Console as an organisation** (USD 25 once) with the **trade licence**, a
   company email and a verified D-U-N-S; new organisation accounts also pass a 14-day closed test
   with 12 testers before production release.
3. **APNs key** (Apple Push Notifications) created in the Apple developer account and uploaded to
   EAS (`eas credentials`) so iPhone owners receive alerts. Android alerts work through Firebase
   Cloud Messaging already.
4. Support phone and email for the listing, and confirmation of the Arabic and English texts
   above.

## Publishing steps once the accounts exist

1. Invite `mohammedghallydev@gmail.com` as Admin in App Store Connect and in the Play Console.
2. `cd apps/mobile`, `eas credentials` to create the Android keystore (kept by EAS) and the iOS
   distribution certificate, provisioning profile and APNs key; `eas build --profile production
--platform all`.
3. Android: `eas submit --platform android` uploads the AAB to the internal track; in the Play
   Console complete the listing from this file, Data safety, content rating (IARC questionnaire:
   no violence, no UGC, no ads), target audience 18+, then promote to production.
   Google Play has no "unlisted" option; keep the app discoverable but it is useless without an
   account created by Vamar, or use the "Managed Google Play / private app" route if Vamar
   prefers it hidden.
4. iOS: `eas submit --platform ios`; in App Store Connect fill App Information and App Privacy
   from this file, add the reviewer notes, and under **Pricing and Availability > App
   Distribution** choose **Unlisted** (request the unlisted link through the form Apple shows the
   first time). Unlisted apps are not searchable and are installed through the link Vamar shares
   with owners.
5. After approval, send owners the links through WhatsApp from the Vamar office number.
