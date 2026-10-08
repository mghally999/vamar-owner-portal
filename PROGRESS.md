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
