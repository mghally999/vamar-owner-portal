# Progress

One entry per phase: what was built, how to try it, and a short client-report paragraph in Arabic.

## Phase 0, foundation (7 Oct 2026)

**Built.** pnpm + Turborepo monorepo with strict TypeScript, ESLint, Prettier and CI; the full
Postgres schema with Drizzle migrations, indexes and append-only audit grants; a realistic seed
(owners in Arabic and English, Dubai and Sharjah buildings, a year of cheques, vacant units,
disputes); the shared business rules (cheque schedule, state machine, owner shares, occupancy,
alerts, money and date formatting) with 82 unit tests; design tokens.

**Try it.** `pnpm check` runs typecheck, lint and every test.

تم إنشاء الأساس التقني لبوابة ملاك فامار، حيث تم تجهيز مستودع المشروع وأدوات العمل الموحدة للتطبيق ولوحة التحكم والخدمة الخلفية. وتم تصميم قاعدة البيانات الكاملة التي تحفظ بيانات الملاك والمباني والوحدات والمستأجرين والعقود والشيكات والمنازعات، مع ضمان دقة المبالغ المالية والتواريخ بتوقيت الإمارات. كما تم بناء واختبار القواعد الأساسية للعمل، مثل توليد مواعيد الشيكات من العقد، وتتبع حالة كل شيك من الاستلام حتى الصرف أو الارتجاع، وتوزيع المبالغ على الملاك المشتركين في الوحدة الواحدة، واحتساب نسبة الإشغال، ومواعيد التنبيهات، وتم تجهيز بيانات تجريبية واقعية لاستخدامها في العرض والاختبار.

## Phase 1, first end-to-end slice (8 Oct 2026)

**Built.**

- API (Hono on Cloudflare Workers): owner phone-login exchange with rotating, device-bound
  sessions and replay detection; staff email login with mandatory authenticator (TOTP) and a
  12-hour cookie session; roles enforced on every route; owner endpoints scoped through one
  helper and proven by an isolation test suite; owner home in one SQL round trip; owners,
  buildings, units with 100 % share validation, tenants, contracts with the generated cheque grid
  and activation rules; full cheque lifecycle (deposit, clear, bounce with owner alert, replace,
  cancel, bulk), disputes, attachments on R2, staff users, audit log, overview, daily jobs.
  51 integration tests run against an in-process Postgres.
- Dashboard (React + Vite, Arabic first with English toggle): login with TOTP enrolment and
  verification, overview, owners (list, create, detail, disable), buildings and units with the
  owner-shares dialog, contracts with the editable cheque grid and activation, cheques table with
  filters, bulk update and the bounce/replace dialog, cheque detail with timeline and image,
  disputes, staff users (Admin / Data entry), audit log.
- Owner app (Expo): phone + OTP sign-in, "not registered" screen, home (month switcher, hero
  total, next cheque, occupancy with vacant units, disputes), cheques with month, property and
  status filters, properties, disputes, cheque / unit / dispute detail, settings with devices,
  language and biometric lock.
- Official Vamar logo and colours everywhere; two dashboard roles as agreed with the client.

**Try it.** `pnpm dev`, then follow `DEMO.md`.

تم إنجاز المرحلة الأولى من بوابة ملاك فامار بحيث أصبحت تعمل من البداية إلى النهاية. فقد تم بناء لوحة تحكم الموظفين التي يُسجَّل الدخول إليها بالبريد الإلكتروني وكلمة المرور ثم برمز من تطبيق المصادقة، وتم فيها تمكين إدخال الملاك والمباني والوحدات مع تحديد حصص الملاك المشتركين، وإنشاء العقود التي تُولَّد منها مواعيد الشيكات تلقائياً بينما تُدخَل المبالغ يدوياً، إضافة إلى متابعة حالة كل شيك من الإيداع إلى الصرف أو الارتجاع والاستبدال. كما تم بناء تطبيق المالك الذي يُسجَّل الدخول إليه برقم الجوال ورمز التحقق، ويعرض للمالك إجمالي شيكات الشهر والشيك التالي ونسبة الإشغال والوحدات الشاغرة والمنازعات، مع تصفية الشيكات حسب الشهر والعقار. وتم اعتماد شعار فامار الرسمي وألوانه في التطبيق ولوحة التحكم، وتم التحقق من أن كل مالك لا يرى سوى بياناته بواسطة اختبارات آلية.

## Clean-up, GitHub and dashboard demo pass (9 Oct 2026)

**Built.**

- Green state: the half-applied SQL fixes were completed (buildings, owners, overview and owner
  home queries qualify their columns; `/api/staff/buildings` works again, with a test), the
  equal-split helper fills whole dirhams while the grid still starts empty, every package has
  real unit tests, `pnpm check` and Prettier pass.
- Repository pushed to the private GitHub repo `mghally999/vamar-owner-portal`; CI runs on every
  push; nightly encrypted backup workflow added (secrets still to be set).
- Dashboard demo pass over 64 screenshots (Arabic and English, 1440 px and 390 px, every page and
  detail page): fixed a crash on the contracts page, filter widths, amounts and dates that
  wrapped, the select chevron in Arabic, the browser's English file picker on the import page,
  and the owner form. Playwright now covers the real flows: login with the authenticator, new
  owner, unit with owner shares validated to 100 %, contract with the cheque grid and activation,
  cheque deposit, bounce with a reason and replacement.
- `pnpm dev` recreates the demo staff logins in the Firebase emulator on every start and starts
  the local Postgres correctly; `pnpm demo:android` added for the emulator demo.

**Try it.** `pnpm dev`, then `pnpm --filter @vamar/dashboard e2e` (flows and screenshots).

تم تنظيف المشروع والتأكد من نجاح جميع الفحوصات والاختبارات الآلية، وتم رفع الشيفرة إلى مستودع خاص على GitHub بحيث تُحفظ نسخة من العمل بعد كل خطوة وتُشغَّل الفحوصات تلقائياً مع كل تحديث، كما تم إعداد نسخة احتياطية ليلية مشفرة لقاعدة البيانات. وتم مراجعة لوحة التحكم صفحةً صفحة باللغتين العربية والإنجليزية وعلى الشاشات الكبيرة والصغيرة، وتم إصلاح ما ظهر من أخطاء في العرض مثل التفاف الأرقام والتواريخ واتجاه القوائم في الواجهة العربية، وتم بناء اختبارات آلية تمر بالمسار الكامل للموظف من تسجيل الدخول إلى إضافة مالك ووحدة وعقد مع جدول الشيكات ثم تحديث حالة الشيك وارتجاعه واستبداله.

## Owner app on the emulator, live deployment, store readiness (10 Oct 2026)

**Built.**

- The owner app runs on the Android emulator from a local dev build and was taken through every
  screen in Arabic and English, light and dark: phone sign-in with the Auth emulator code, the
  "not registered" state, home with the month switcher, cheques with property and status filters,
  cheque detail with the timeline, properties and unit detail, disputes and dispute detail,
  settings (language with RTL reload, notifications, biometric lock, signed-in devices, PDF
  statements shared from the phone, account deletion request). Fixes along the way: a device id
  that does not need WebCrypto, TTF fonts, the Android splash, the tab bar on gesture-navigation
  phones, device rows and dates in settings, natural unit ordering, and Arabic text clipping.
- Live: Worker at https://vamar-owner-portal.vamar-api.workers.dev (dashboard + API + cron,
  security headers on static files), Neon database in Frankfurt with an append-only audit role,
  R2 buckets, backup secrets (R2 API token still to add), `pnpm demo:reset` for both databases.
- EAS: project linked, preview APK built against the live API (link + QR in MEETING.md),
  production and submit profiles, STORE.md with both stores' listing texts, privacy answers,
  reviewer account and the publishing steps; store-sized screenshots in `demo/screenshots/store`.
- MEETING.md: ten-minute checklist, logins, five-minute script, likely questions, backup plan and
  the WhatsApp message for PULSE.

**Waiting on one click**: Firebase console > Authentication > Get started, after which the live
sign-in, the real push notifications and the APK sign-in test are switched on by script.

تم تشغيل تطبيق المالك على محاكي أندرويد ومراجعته شاشةً شاشة باللغتين العربية والإنجليزية وبالوضعين الفاتح والداكن، من تسجيل الدخول برقم الجوال ورسالة الرقم غير المسجل، إلى الشاشة الرئيسية والشيكات بفلاترها وتفاصيل الشيك والعقارات والوحدات والمنازعات والإعدادات، مع إصدار كشف الحساب بصيغة PDF من الهاتف، وتم إصلاح كل ما ظهر من أخطاء في العرض والاتجاه العربي. وتم نشر النسخة الحية للوحة التحكم والخدمة الخلفية على الإنترنت مع قاعدة بيانات حقيقية ونسخة احتياطية ليلية، وتم بناء نسخة أندرويد قابلة للتنزيل برابط ورمز QR لتجربتها على أي هاتف، وتم تجهيز كل ما تطلبه متاجر التطبيقات من نصوص وصور وإجابات الخصوصية، وتم إعداد دليل الاجتماع مع العميل بالكامل.

## Independent audit before hardening (22 Oct 2026)

**Audited.** The whole repository and the live deployment were reviewed as an outside engineer
would: security against ASVS Level 2, reliability, performance on a synthetic portfolio of 2,000
owners, 6,000 units, 12,000 contracts and 68,000 cheques, query plans, load tests at 10 to 250
concurrent users plus a one-IP office scenario, bundle sizes and Lighthouse, mobile measurements,
code quality scans (secrets history, dependency advisories, dead code, duplication, complexity) and
a line-by-line check of the brief. The result is `AUDIT.md`: verdict, the ten worst findings, a
register of 55 defects with file and line evidence, a 17-dimension scorecard (6.1 / 10 today), the
complexity table, the load-test and query-plan tables and the brief compliance table. No code was
changed in this step; the fixes start in the next one and are tracked against the register.

تمت مراجعة المشروع بالكامل مراجعةً مستقلة قبل البدء بأي تعديل، من ناحية الأمان والاعتمادية والأداء وجودة الشيفرة ومطابقة ما تم بناؤه لما تم الاتفاق عليه، وتم اختبار النظام على بيانات تجريبية كبيرة تعادل محفظة عقارية ضخمة وعلى أعداد كبيرة من المستخدمين في نفس الوقت، وتم توثيق كل ما ظهر من نقاط ضعف في ملف واحد مع تقدير خطورة كل نقطة وطريقة علاجها، وتم تحديد ترتيب الإصلاحات التي ستبدأ في الخطوة التالية.

## Hardening, staging, redesign start and production deploy (23 Oct 2026)

**Fixed** every Critical, High and Medium finding of `AUDIT.md` (configuration and secrets checks,
staff sign-in binding and 2-step rules, revocation, cache headers, readiness probe, one error
format, single-use authenticator codes, push notifications that retry, guarded cron with
retention, imports that survive bad rows, safe file storage, paged lists, a parallel overview
with new indexes, sessions that survive network hiccups in both clients, offline banner and
cached images in the app, rules moved back into the shared package, owner phone change as an
admin action). 86 API tests, 86 shared, 10 db, 5 app, 3 dashboard, 5 token tests and 11
Playwright flows.

**Operations**: staging at https://vamar-owner-portal-staging.vamar-api.workers.dev with its own
database branch, bucket and secrets; request ids and JSON access logs; error reporting ready for
Sentry; deploy workflow from GitHub (waiting for a Cloudflare token, BLOCKED.md item 6); restore
drill passed with every table identical; CI with coverage floors, bundle budgets, secret scan and
dependency audit.

**Design**: tokens rebuilt from the Figma file, two themes (Default slate and White) chosen in
Settings and remembered, Almarai, the app's new header, floating tab bar and Home screen 1:1 from
the design, the dashboard's slate sidebar and hero card; 128 dashboard screenshots in
`demo/screenshots/v2`.

**Distribution**: `/download` page with the QR in `demo/download-qr.png`, version check in the
API, app 1.1.0 prepared with over-the-air updates; the next APK is 36.7 MB instead of 114 MB.

**Production** now runs this code (migrations 0003 to 0005 applied, smoke test passed); the
installed app and the trial accounts work as before.

تمت مراجعة النظام بالكامل ومعالجة كل ما ظهر في تقرير المراجعة من نقاط ضعف في الأمان والاعتمادية والأداء، وتم تجهيز نسخة تجريبية منفصلة تماماً عن النسخة الحية لاختبار أي تعديل قبل وصوله إلى المستخدمين، مع سجلات تشغيل منظمة وتجربة ناجحة لاسترجاع النسخة الاحتياطية لقاعدة البيانات. وتم البدء بتطبيق التصميم الجديد من ملف فيجما على التطبيق ولوحة التحكم بمظهرين يختار المستخدم بينهما، وتم تجهيز صفحة تنزيل واحدة ترسل للملاك وتعرض الطريقة المناسبة لهاتف كل منهم، وتم تقليص حجم تطبيق أندرويد من 114 إلى نحو 37 ميجابايت، وتم نشر هذه التحسينات على النسخة الحية بعد نجاح اختبارها على النسخة التجريبية.

## Distribution, go-live kit, tests, re-audit and handover (24 Oct 2026)

**Distribution**: owner app 1.1.0 (36.7 MB APK) on the `/download` page and in the update check;
the same app as a web app at `/app` for iPhone (installable from Safari, offline shell, tested on an
iPhone screen with axe after every staging deploy); an over-the-air update with this round's fixes
published to installed 1.1.0 apps. Production runs v1.1.1.

**Go-live kit**: `vamar-import-template.xlsx` (Arabic instructions, examples, Excel validation for
5,000 rows) downloadable from the Import page; imports go in batches of 500 keyed by the file, so
uploading the same file twice adds nothing; a 5,000-row test with bad and duplicate rows;
`pnpm golive:blank` (dry run, then `--confirm`) rehearsed on the staging database server; GOLIVE.md
with the day's checklist, rollback and the secret rotation record.

**Tests and CI**: about 250 tests with coverage floors in every package, property tests for money
and dates, component tests for the dashboard and the app, a load smoke and the Docker stack in CI;
all six CI jobs green.

**Re-audit**: AUDIT.md section 9, average 8.4 out of 10 (was 6.1). On the same machine and data,
the API serves about twice the requests with a 3 to 5 times lower p95; the staff overview went from
70 to 189 requests a second. Found and fixed along the way: arrows pointing the wrong way in both
languages, a missing back button on screens opened from a notification, demo cheque timelines a
year off, an unnamed progress bar. HANDOVER.md, README, DEMO and PROJECT updated; app screenshots
v2 in both themes and both languages.

تم تسليم المشروع كاملاً وجاهزاً للتشغيل الفعلي، فقد أصبح تطبيق الملاك متاحاً عبر رابط تنزيل واحد يعرض تطبيق أندرويد أو نسخة الويب المناسبة للآيفون، مع تحديثات تصل للتطبيق المثبت تلقائياً. وتم تجهيز نموذج إكسل باللغة العربية لإدخال بيانات فامار الحقيقية مع التحقق من صحتها قبل الحفظ، وتجربة استيراد 5,000 سجل بنجاح، وخطوات واضحة ومجربة لبدء التشغيل الفعلي ببيانات نظيفة. وأظهرت المراجعة النهائية تحسناً في التقييم العام من 6.1 إلى 8.4 من 10، وأصبح النظام يتحمل ضعف عدد المستخدمين بسرعة استجابة أعلى بثلاث إلى خمس مرات، وتم توثيق كل ما يلزم لاستلام المشروع وتشغيله.

## v2 phase 1, model and rules (2 Nov 2026)

**Built.** Migrations 0006 and 0007: expense categories (21 seeded, fixed and variable), vendors,
expenses with a draft / posted / void life cycle, append-only owner allocations, recurring rules,
work orders, unit status with its history and the property identifiers (title deed, plot, Makani,
DEWA/SEWA, municipality) on units and buildings, dispute-to-cheque links (backfilled from the
contracts of existing bounced-cheque cases), calendar events, the 2026 and 2027 UAE holidays
(religious ones tentative) and the settings table with its defaults. Shared rules: period presets
(this year by default, Dubai dates, Monday week start, comparison periods of the same length,
monthly buckets), the largest-remainder allocation of a building expense to units and owners,
VAT at 5 %, recurring due dates with month-end clamping, fixed-cost projections, the rent identity
expected = collected + outstanding + at risk, month grids and the Hijri date, settings parsing.

**Try it.** `pnpm --filter @vamar/shared test` (176 tests; property tests prove every allocation
adds up and the identity holds; presets checked on 1 Jan, 31 Dec and 29 Feb),
`pnpm --filter @vamar/db test` (migrations and the seed on an in-process Postgres).

تم بناء أساس النسخة الثانية: جداول المصروفات والفئات والموردين وقواعد المصروفات المتكررة، وتوزيع كل
مصروف على الملاك بدقة الفلس، وأوامر الصيانة، وحالة الوحدة وسجلها وأرقام العقار، وربط الشيكات المرتجعة
بالقضايا، وأحداث التقويم والعطلات الرسمية للعامين 2026 و2027، مع قواعد الفترات والحسابات (المتوقع =
المحصّل + المتبقي + المعرّض للخطر) مختبرة بالكامل.

## v2 phase 2, API (2 Nov 2026)

**Built.** Staff endpoints for categories, vendors, expenses (create, edit, post with the owners'
shares computed from the ownership on the invoice date, void with a reason and an optional
corrected copy, live allocation preview, duplicate-invoice and outlier warnings), recurring rules
and the drafts the daily cron creates from them, work orders with photos and the paying invoice,
unit status with reason and history, identifiers, unit and building history timelines, a calendar
for any range with manual events and admin-managed holidays, a one-round-trip report summary
(rent, expenses by kind and category, occupancy over time, comparison period, up to 24 monthly
buckets), global search, settings, and dispute-to-cheque links (a bounced-cheque case needs at
least one). Owner endpoints: the period summary behind Home, expenses with invoice files, work
orders, the unit timeline, the calendar and the display settings on the profile. Pushes: a
monthly summary on the 1st, a hearing reminder three days before, a finished work order and a
large expense. The demo seed now carries eighteen months of fixed costs, a lift repair, an AC
breakdown with before and after photos, legal fees on the bounced-cheque case, work orders,
statuses, identifiers and events.

**Try it.** `pnpm --filter @vamar/api test` (150 tests, 30 new, owner isolation on every new
endpoint); `GET /api/owner/summary?preset=this_year` and `GET /api/staff/reports/summary?preset=last_month&compare=1`.

تم بناء واجهة البرمجة الكاملة للمصروفات وأوامر الصيانة وسجل العقار والتقويم والتقارير والبحث
والإعدادات، مع ملخص المالك لأي فترة في طلب واحد، وربط الشيكات المرتجعة بالقضايا، وتنبيهات شهرية
وتذكير بالجلسات وإشعار بإنجاز الصيانة وبالمصروفات الكبيرة، وبيانات تجريبية لثمانية عشر شهراً.

## v2 phase 3, dashboard (2 to 9 Nov 2026)

**Built.** One period bar, in the style of the Foodics console, on Overview, Cheques, Expenses and
Reports: preset chips (today to last year, custom range), a two-month range picker in Arabic with
Western digits and typed `dd/mm/yyyy` input, a compare-with-previous-period switch, all kept in the
URL so a refresh or a shared link shows the same period. Every plain date field became the shared
date picker, with a weekend and holiday warning on cheque, replacement and hearing dates. Overview
shows expected rent, collected, outstanding, at risk, expenses fixed and variable, and net, with a
month-by-month chart. New pages: Expenses (filters, totals, the drafts queue, the form with the live
share of each owner, VAT from the vendor's TRN, invoice upload, duplicate and outlier warnings, post,
and void with a corrected copy for admins), recurring rules, Work orders (list and board by status,
photos, the paying invoice), Reports (owner statement, building P&L, expenses by category, collection
rate, occupancy over time, outstanding and bounced; Excel and PDF exports in the browser), the
Calendar (year, month, week and list views, filters and a colour legend, weekends and holidays
shaded, a side panel per item, drag to move manual events only), the unit record page (property
number and identifiers, status with reason and history, owners, contracts, the history timeline),
building identifiers and history, dispute cheque links (a bounced-cheque case needs a cheque; the
list shows and searches cheque numbers), Settings, Holidays, Expense categories and Vendors, and a
Ctrl+K search across owners, phones, units, deeds, Makani, cheques, cases and invoices. The import
page reads the Expenses sheet and the identifier columns.

**Try it.** `pnpm dev`, sign in as the admin, then `/` (period bar), `/expenses/new` (pick Al Noor
Tower and watch the owner shares), `/work-orders` (Board), `/calendar`, `/reports` (Excel, PDF),
`/units/<id>` from a building page, `/disputes` (type a cheque number), `/settings`, and Ctrl+K.
Not deployed yet; screenshots, the load test and the verification run come in the next phases.

تم بناء لوحة التحكم الخاصة بالنسخة الثانية: شريط فترة واحد على طريقة فودكس يحفظ الفترة في الرابط، ومنتقي
تواريخ عربي في كل الشاشات مع تنبيه عند الجمعة والسبت والعطلات، وشاشات المصروفات وقواعدها المتكررة مع عرض
حصة كل مالك قبل الترحيل، وأوامر الصيانة كقائمة ولوحة، والتقارير مع التصدير إلى إكسل وPDF، والتقويم السنوي
والشهري والأسبوعي، وسجل كل وحدة بأرقامها وحالتها وتاريخها، وربط الشيكات المرتجعة بالقضايا، والإعدادات
والعطلات والفئات والموردين، والبحث السريع بلوحة المفاتيح.

## v2 phase 4, owner app (2 Nov 2026)

**Built.** Home has a period switcher (This month, Next month, Next 6 months, This year, and a sheet
for last month, last year, a year, a month or a custom range) over the owner summary: expected rent,
collected, outstanding, at risk, expenses fixed and variable, net or projected net with the "before
Vamar's management fee" note, a 12-month chart of rent against expenses, and rows for the next
cheque, contracts ending, open maintenance and the calendar; every number opens the list behind it.
A fifth tab lists expenses with category, reason, property, date, invoice value, VAT and the owner's
share; the detail shows the invoice (zoomable), the vendor and the linked job. The calendar has year,
month, week and agenda views built in the app, RTL with Western digits, coloured dots with a legend
and the Hijri line when the admin turns it on; the Cheques tab gets a List and Calendar switch. Units
show the status badge, the property record and the history timeline with filters. Disputes show the
case and cheque numbers with bank, amount and dates. The PDF statement covers any period. New pushes
(monthly summary, hearing reminder, finished job, large expense) open their screens. JavaScript only:
it reaches installed apps through an over-the-air update, no new download.

**Try it.** `pnpm build:web` with the local API running, then the web app at `/app/`, `/app/expenses`,
`/app/calendar`, `/app/work-orders`, a unit and a dispute; tests: `pnpm --filter @vamar/mobile test`
(238 component tests). Not published yet: the over-the-air update goes out in the shipping phase.

تم تحديث تطبيق الملاك: الصفحة الرئيسية تعرض المتوقع والمحصّل والمتبقي والمعرّض للخطر والمصروفات الثابتة
والمتغيرة والصافي لأي فترة يختارها المالك، هذا الشهر أو الشهر القادم أو الستة أشهر القادمة أو السنة أو السنة
الماضية أو أي فترة، مع رسم بياني لاثني عشر شهراً. وأُضيف قسم المصروفات بسبب كل مصروف وقيمة فاتورته وصورتها،
وتقويم سنوي وشهري وأسبوعي، وسجل كل وحدة وأرقامها، وأرقام الشيكات في القضايا، وكشف حساب لأي فترة، وإشعارات
جديدة. ويصل التحديث إلى التطبيقات المثبتة تلقائياً دون تحميل جديد.

## v2 phase 5, review, screenshots and speed (10 to 11 Nov 2026)

**Built.** Every screen was photographed and reviewed: 56 owner app screenshots (iPhone 13, Default
and White themes, Arabic and English) and 264 dashboard screenshots (both themes, Arabic and English,
1440 and 390 px), with no two files identical. The review fixed what it found: Home's period chips wrap
so This year and More are always one tap away, no tile label or amount is cut, the `?preset=` link
from a push opens the right period on the web app, the job priority reads as a normal row, chart month
names keep their shape, and the dashboard menu fits a 900 px screen. The demo data now reads as a
real Arabic portfolio: Arabic bounce reasons, hearing dates in words and on working days, and real
looking Makani, DEWA and SEWA, title deed and municipality numbers. The owner summary meets its budget
with 200,000 expenses: p95 295 ms at 50 simultaneous owners (it was 2,081 ms), and the old Home went
from 412 to 625 requests a second, by computing only the months of the period, reusing one date
formatter and one token key, and looking up counts and shares through their indexes.

**Try it.** Screenshots in `demo/screenshots/v3/app` and `demo/screenshots/v3/dashboard`; the load
numbers in the Load comparison workflow runs 42975758808 and 42976397036.

تم مراجعة كل شاشات التطبيق ولوحة التحكم بالعربي والإنجليزي وفي الثيمين، وتصحيح كل ما ظهر: أزرار الفترة كلها ظاهرة،
ولا رقم ولا عنوان مقطوع، ورابط الإشعار يفتح الفترة الصحيحة، وأسماء الشهور في الرسم البياني واضحة، والقائمة الجانبية
كاملة على الشاشة. وأصبحت بيانات العرض عربية واقعية بأسباب الارتجاع ومواعيد الجلسات في أيام العمل وأرقام مكاني
وديوا وسند الملكية. وصار ملخص المالك يفتح في أقل من 300 جزء من الثانية حتى مع 200 ألف مصروف و50 مالكاً في نفس اللحظة.

## v2 phase 6, shipping (11 Nov 2026)

**Built.** Staging first: migrations 0006 to 0008, the new version deployed, the smoke test (4/4), the
iPhone web app test (2/2) and the staging Playwright run (16/16) passed, and the staging demo data was
refreshed with the Arabic v2 story. Then production: the same migrations (additive only), the same
version deployed, smoke test 4/4. The owner app update went out over the air to installed apps of
version 1.2.0 (update group b5fc0303, preview channel): an installed app downloads it the next time it
opens and shows v2 the time after. The demo reset and the go-live blank start were fixed on the way:
they no longer drop the expense categories, holidays and settings, the demo reset runs in one
transaction, and it keeps every staff login, including accounts the seed does not create.

**Try it.** Staging https://vamar-owner-portal-staging.vamar-api.workers.dev, production
https://vamar-owner-portal.vamar-api.workers.dev, the app: open it, close it, open it again.

تم نشر النسخة الثانية على بيئة الاختبار ثم على النسخة الحقيقية بعد نجاح كل الفحوصات، وأُرسل تحديث التطبيق إلى
الهواتف المثبت عليها التطبيق، ويظهر بعد فتح التطبيق وإغلاقه ثم فتحه مرة أخرى.

## v2 phase 7, independent re-check (11 Nov 2026)

**Built.** The verification scripts ran against v2: 85 adversarial checks on the local stack passed
(owner isolation on every new endpoint, allocations exact to the fils, periods, dispute cheques, roles,
headers), and all 119 protected routes answer 401 without a valid token on staging and production.
The re-check is in VERIFY.md ("v2 re-check"). Still open and outside the code: tested backups (no R2
token yet), a separate Firebase project for staging, Sentry and an uptime monitor, and the trial's
demo admin without a second step until go-live day.

تم فحص النسخة الثانية فحصاً مستقلاً: كل مالك يرى بياناته فقط في كل الشاشات الجديدة، وتوزيع المصروفات صحيح
حتى آخر فلس، وكل الروابط المحمية ترفض أي دخول بدون تسجيل صحيح على بيئة الاختبار والنسخة الحقيقية.

