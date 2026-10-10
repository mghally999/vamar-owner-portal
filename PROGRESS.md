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
