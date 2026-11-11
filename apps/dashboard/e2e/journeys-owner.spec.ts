/**
 * Journeys that cross from the staff dashboard to the owner web app (/app) and back, as people
 * would click them, on the local stack (`pnpm dev` for the dashboard, the API serving the web app):
 *
 * 1. Repair approval: a job above the approval threshold waits for the owner, who approves (or
 *    rejects) in the web app; staff then start it, or an admin overrides the rejection with a
 *    reason; the audit log shows the answer and the override.
 * 2. Messages: the owner asks about a cheque, staff see it waiting (header badge, Today, inbox),
 *    reply, the owner reads the reply and the unread count clears, staff close the thread.
 * 3. Statements: last year's statement from the yearly picker (12 month rows, totals equal to the
 *    year's summary) and the monthly statement card a summary push opens on Home.
 * 4. Budgets: an admin sets a building budget line; the owner sees it on Properties with the
 *    right percentage.
 *
 * The owner is signed in by writing a session into the local database (owner-session.ts; owners
 * sign in by SMS). Everything the journeys create carries the E2E tag and is removed before and
 * after the file runs, so reruns start clean and other spec files never see it.
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { formatAmount } from '@vamar/shared';
import { withLocalDb } from './db';
import { login, type STAFF } from './helpers';
import { ownerApp, ownerByPhone, removeOwnerSessions, type OwnerApp } from './owner-session';

/** Mariam Al Qasimi in the seed: every unit of hers in Al Khan Residence has her as sole owner. */
const OWNER_PHONE = '+971500000004';
const TAG = 'E2E journey';
const stamp = Date.now().toString(36).slice(-6);
type Lang = 'ar' | 'en';
const L = <T>(lang: Lang, en: T, ar: T): T => (lang === 'ar' ? ar : en);
/**
 * The owner web app keeps the earlier screens of its navigation stack in the page, hidden; text
 * lookups there must only count what is on the screen.
 */
const shown = (l: Locator) => l.filter({ visible: true });
const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

interface Fixture {
  ownerId: string;
  unitId: string;
  unitNo: string;
  buildingId: string;
  buildingAr: string;
  buildingEn: string;
  thresholdFils: number;
}
let fx: Fixture | undefined;
/** The fixture, once beforeAll has found it. */
function f(): Fixture {
  if (!fx) throw new Error('the journey fixture was not set up');
  return fx;
}

/** Removes what earlier runs of this file left behind (work orders, threads, budget lines). */
async function cleanUp(ownerId: string): Promise<void> {
  await withLocalDb(async (c) => {
    await c.query(
      `delete from notification_log where entity_id in (
         select ra.id from repair_approvals ra join work_orders w on w.id = ra.work_order_id
          where w.title_en like $1)`,
      [`${TAG}%`],
    );
    // repair_approvals go with their work order (on delete cascade).
    await c.query(`delete from work_orders where title_en like $1`, [`${TAG}%`]);
    const threads = await c.query<{ id: string }>(
      `select distinct thread_id as id from thread_messages where body like $1`,
      [`${TAG}%`],
    );
    const ids = threads.rows.map((r) => r.id);
    if (ids.length) {
      await c.query(
        `delete from notification_log where entity_id in
           (select id from thread_messages where thread_id = any($1::uuid[]))`,
        [ids],
      );
      await c.query(`delete from thread_messages where thread_id = any($1::uuid[])`, [ids]);
      await c.query(`delete from message_threads where id = any($1::uuid[])`, [ids]);
    }
    await c.query(
      `delete from budgets where amount_fils % 1000 = 7 and created_by is not null
                     and building_id in (select building_id from units u
                       join unit_ownerships o on o.unit_id = u.id where o.owner_id = $1)`,
      [ownerId],
    );
    // The owner's message limit is 20 an hour; reruns must not run into it.
    await c.query(`delete from rate_limits where key like 'owner_message:%'`);
  });
  await removeOwnerSessions(ownerId);
}

// Each journey signs staff in with TOTP, and a sign-in waits for a code step not used yet (up
// to 30 s): one or two sign-ins plus the owner's side need more than the default minute. The
// tests do not depend on each other, so a failure does not skip the rest.
test.describe.configure({ timeout: 180_000 });

test.beforeAll(async () => {
  const owner = await ownerByPhone(OWNER_PHONE);
  await cleanUp(owner.id);
  fx = await withLocalDb(async (c) => {
    const unit = await c.query<Omit<Fixture, 'ownerId' | 'thresholdFils'>>(
      `select u.id as "unitId", u.unit_no as "unitNo", b.id as "buildingId",
              b.name_ar as "buildingAr", b.name_en as "buildingEn"
         from unit_ownerships uo
         join units u on u.id = uo.unit_id
         join buildings b on b.id = u.building_id
        where uo.owner_id = $1 and uo.to_date is null
          and (select count(*) from unit_ownerships x where x.unit_id = u.id and x.to_date is null) = 1
        order by u.unit_no limit 1`,
      [owner.id],
    );
    const setting = await c.query<{ value: number | string }>(
      `select value from app_settings where key = 'repair_approval_threshold_fils'`,
    );
    const row = unit.rows[0];
    if (!row) throw new Error('the seed owner has no unit of her own');
    return { ...row, ownerId: owner.id, thresholdFils: Number(setting.rows[0]?.value ?? 500_000) };
  });
});

test.afterAll(async () => {
  if (fx) await cleanUp(fx.ownerId);
});

/** A second staff member in their own browser context (one context per person). */
async function staffPage(browser: Browser, who: keyof typeof STAFF, lang: Lang): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    locale: lang === 'ar' ? 'ar-AE' : 'en-AE',
  });
  const page = await context.newPage();
  await login(page, who, lang);
  return page;
}

// 1. Repair approval -------------------------------------------------------------------------------

/** Staff create a job on the owner's unit with an estimate above the threshold. */
async function createLargeJob(page: Page, lang: Lang, title: string): Promise<string> {
  await page.goto('/work-orders');
  await page.getByRole('button', { name: L(lang, 'New work order', 'أمر صيانة جديد') }).click();
  await page.waitForURL(/\/work-orders\/new$/);
  await page
    .getByLabel(L(lang, 'Building', 'المبنى'), { exact: false })
    .first()
    .selectOption({ label: L(lang, f().buildingEn, f().buildingAr) });
  await page.getByLabel(new RegExp(`^${L(lang, 'Unit', 'الوحدة')}`)).selectOption({
    label: f().unitNo,
  });
  await page
    .getByLabel(new RegExp(`^${L(lang, 'Title \\(Arabic\\)', 'العنوان \\(عربي\\)')}`))
    .fill(`${TAG} ${title} (ar)`);
  await page
    .getByLabel(new RegExp(`^${L(lang, 'Title \\(English\\)', 'العنوان \\(إنجليزي\\)')}`))
    .fill(`${TAG} ${title}`);
  const estimate = page.getByLabel(
    new RegExp(`^${L(lang, 'Estimate \\(AED\\)', 'التكلفة التقديرية \\(درهم\\)')}`),
  );
  await estimate.fill(String(f().thresholdFils / 100 + 2500));
  await page.getByRole('button', { name: exact(L(lang, 'Create', 'إنشاء')) }).click();
  await page.waitForURL(/\/work-orders\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop() ?? '';
}

/** Tries to start the job from the status field; returns after the page answered. */
async function tryToStart(page: Page, lang: Lang): Promise<void> {
  await page
    .getByLabel(new RegExp(`^${L(lang, 'Status', 'الحالة')}`))
    .selectOption({ label: L(lang, 'In progress', 'قيد التنفيذ') });
  await page.getByRole('button', { name: exact(L(lang, 'Save', 'حفظ')) }).click();
}

const REFUSED = {
  en: 'The owners have not approved this job yet',
  ar: 'لم يوافق الملاك على هذا العمل بعد',
};

/** The owner finds the request in the web app and answers it. */
async function ownerAnswers(
  owner: OwnerApp,
  lang: Lang,
  title: string,
  decision: 'approve' | 'reject',
  note: string,
): Promise<void> {
  const { page } = owner;
  // Home links the open maintenance jobs; their screen starts with the requests waiting for her.
  await owner.open('/');
  await page.locator('a[href$="/work-orders"]').first().click();
  await page
    .getByRole('link', { name: new RegExp(L(lang, 'Awaiting your approval', 'بانتظار موافقتك')) })
    .click();
  await expect(
    page.getByRole('heading', { name: L(lang, 'Approval requests', 'طلبات الموافقة') }),
  ).toBeVisible();
  const label = lang === 'ar' ? `${TAG} ${title} (ar)` : `${TAG} ${title}`;
  await page.getByRole('link', { name: new RegExp(label.replace(/[()]/g, '\\$&')) }).click();
  // The web app keeps earlier screens of the stack in the page, hidden: look at the shown one.
  const estimate = `${L(lang, 'Estimated cost', 'التكلفة التقديرية')}: ${formatAmount(
    f().thresholdFils + 250_000,
    lang,
  )}`;
  await expect(shown(page.getByText(estimate))).toBeVisible();
  await page.getByLabel(L(lang, 'Note (optional)', 'ملاحظة (اختيارية)')).fill(note);
  if (decision === 'approve') {
    await page.getByRole('button', { name: exact(L(lang, 'Approve', 'موافقة')) }).click();
  } else {
    await page.getByRole('button', { name: exact(L(lang, 'Reject', 'رفض')) }).click();
    await page
      .getByRole('button', { name: exact(L(lang, 'Confirm rejection', 'تأكيد الرفض')) })
      .click();
  }
  await expect(shown(page.getByText(L(lang, 'Your answer', 'ردك'), { exact: true }))).toBeVisible();
  await expect(
    shown(
      page.getByText(
        decision === 'approve' ? L(lang, 'Approved', 'موافق') : L(lang, 'Rejected', 'مرفوض'),
        { exact: true },
      ),
    ).first(),
  ).toBeVisible();
  await expect(shown(page.getByText(note))).toBeVisible();
}

/** The audit log (admins only) has the row; opening it shows what was recorded. */
async function auditShows(page: Page, lang: Lang, action: string, entity: string, text: string) {
  await page.goto('/audit');
  await expect(
    page.getByRole('heading', { name: L(lang, 'Audit log', 'سجل التدقيق') }),
  ).toBeVisible();
  const filtered = page.waitForResponse(
    (r) => r.url().includes('/api/staff/audit?') && r.url().includes(`entityType=${entity}`),
  );
  await page.getByLabel(L(lang, 'Entity', 'العنصر')).selectOption(entity);
  await filtered;
  const row = page.getByRole('row').filter({ hasText: action }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.locator('pre').filter({ hasText: text }).first()).toBeVisible();
}

test('repair approval: the owner approves in the web app, then staff can start the job (English)', async ({
  page,
  browser,
}) => {
  const title = `roof pump ${stamp}`;
  const note = `${TAG} go ahead ${stamp}`;
  await login(page, 'entry', 'en');
  await createLargeJob(page, 'en', title);

  // Waiting for the owner: the page says so per owner and refuses to start the job.
  await expect(page.getByText('Awaiting owner approval').first()).toBeVisible();
  const panel = page.getByRole('region', { name: /Owner approval/ });
  await expect(panel.getByText('Mariam Al Qasimi')).toBeVisible();
  await expect(panel.getByText('Awaiting answer')).toBeVisible();
  await tryToStart(page, 'en');
  await expect(page.getByText(REFUSED.en)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/^Status/)).toHaveValue('open');

  const owner = await ownerApp(browser, OWNER_PHONE, 'en');
  await ownerAnswers(owner, 'en', title, 'approve', note);
  await owner.close();

  // Staff reload: approved, with the owner's note, and the job can start.
  await page.reload();
  await expect(page.getByText('Approved by the owners').first()).toBeVisible();
  await expect(panel.getByText(note)).toBeVisible();
  await tryToStart(page, 'en');
  await expect(page.getByText('Work order saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/^Status/)).toHaveValue('in_progress');

  // The answer is in the audit log, for the admin.
  const admin = await staffPage(browser, 'admin', 'en');
  await auditShows(admin, 'en', 'repair_approval.answer', 'repair_approval', note);
  await admin.context().close();
});

test('repair approval: the owner rejects, the admin overrides with a reason (Arabic)', async ({
  page,
  browser,
}) => {
  const title = `lift motor ${stamp}`;
  const note = `${TAG} السعر مرتفع ${stamp}`;
  const reason = `${TAG} عطل يهدد السلامة ${stamp}`;
  await login(page, 'admin', 'ar');
  await createLargeJob(page, 'ar', title);
  await expect(page.getByText('بانتظار موافقة الملاك').first()).toBeVisible();

  const owner = await ownerApp(browser, OWNER_PHONE, 'ar');
  await ownerAnswers(owner, 'ar', title, 'reject', note);

  await page.reload();
  await expect(page.getByText('رفضه مالك').first()).toBeVisible();
  const panel = page.getByRole('region', { name: /موافقة الملاك/ });
  await expect(panel.getByText(note)).toBeVisible();
  await tryToStart(page, 'ar');
  await expect(page.getByText(REFUSED.ar)).toBeVisible();

  // The override needs a reason of three characters or more.
  await panel.getByRole('button', { name: 'تجاوز الموافقة' }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'تجاوز الموافقة' });
  await dialog.getByLabel('السبب').fill('لا');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('السبب').fill(reason);
  await confirm.click();
  await expect(page.getByText('تم تجاوز الموافقة.')).toBeVisible();
  await expect(page.getByText('تجاوز المدير الموافقة').first()).toBeVisible();
  await expect(panel.getByText(reason)).toBeVisible();
  await tryToStart(page, 'ar');
  await expect(page.getByText('تم حفظ أمر الصيانة.')).toBeVisible();

  // The owner's own answer stays a rejection; the job no longer waits for them.
  await owner.page.reload();
  await expect(shown(owner.page.getByText('مرفوض', { exact: true })).first()).toBeVisible();
  await owner.close();

  await auditShows(page, 'ar', 'repair_approval.override', 'work_order', reason);
});

// 2. Messages ------------------------------------------------------------------------------------

for (const lang of ['en', 'ar'] as const) {
  test(`messages: the owner asks about a cheque and reads the answer (${lang})`, async ({
    page,
    browser,
  }) => {
    const question = `${TAG} ${L(lang, 'Has this cheque cleared?', 'هل تم صرف هذا الشيك؟')} ${stamp}`;
    const answer = `${TAG} ${L(lang, 'It clears tomorrow.', 'يُصرف غداً.')} ${stamp}`;
    const owner = await ownerApp(browser, OWNER_PHONE, lang);
    const o = owner.page;

    // The owner opens Messages (from Settings), then asks about a cheque from its screen.
    await owner.open('/settings');
    await o.getByRole('link', { name: L(lang, 'Messages with Vamar', 'الرسائل مع فامار') }).click();
    await expect(o.getByRole('heading', { name: L(lang, 'Messages', 'الرسائل') })).toBeVisible();
    await owner.open('/cheques');
    await o.locator('a[href*="/cheque/"]').first().click();
    await o
      .getByRole('button', { name: L(lang, 'Ask Vamar about this', 'اسأل فامار عن هذا') })
      .click();
    const subjectBox = o.getByLabel(L(lang, 'Subject', 'الموضوع'));
    const subject = await subjectBox.inputValue();
    // The subject starts filled in from the cheque the owner was looking at.
    expect(subject).toMatch(L(lang, /^Cheque \d+$/, /^الشيك \d+$/));
    await o.getByLabel(L(lang, 'Your message', 'رسالتك')).fill(question);
    await o.getByRole('button', { name: exact(L(lang, 'Send', 'إرسال')) }).click();
    await o.waitForURL(/\/message\/[0-9a-f-]{36}/);
    await expect(shown(o.getByText(question))).toBeVisible();

    const waiting = await withLocalDb(async (c) => {
      const r = await c.query<{ n: string }>(
        `select count(*) as n from message_threads where status = 'open' and last_sender_type = 'owner'`,
      );
      return Number(r.rows[0]?.n ?? 0);
    });

    // Staff: unread badge in the header, the Today tile, the inbox row.
    await login(page, 'entry', lang);
    await expect(
      page
        .getByRole('link', {
          name: new RegExp(L(lang, 'Owner messages, \\d+ unread', 'رسائل الملاك، \\d+ غير مقروءة')),
        })
        .first(),
    ).toBeVisible();
    const tile = page.getByRole('link', {
      name: new RegExp(L(lang, 'Unanswered owner messages', 'رسائل ملاك بلا رد')),
    });
    await expect(tile).toContainText(String(waiting));
    await tile.click();
    await page.waitForURL(/\/messages\?waiting=1/);
    const row = page.getByRole('link').filter({ hasText: question });
    await expect(row).toContainText(L(lang, '1 unread', '1 غير مقروءة'));
    await expect(row).toContainText(L(lang, 'Waiting for an answer', 'بانتظار الرد'));
    await row.click();
    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
    await page.getByLabel(L(lang, 'Your answer to the owner', 'ردك على المالك')).fill(answer);
    await page.getByRole('button', { name: exact(L(lang, 'Send', 'إرسال')) }).click();
    await expect(page.getByText(L(lang, 'Answer sent.', 'تم إرسال الرد.'))).toBeVisible();

    // The owner: the list shows one new message; opening the thread shows the answer and clears it.
    await owner.open('/messages');
    const ownerRow = o.getByRole('link').filter({ hasText: subject }).first();
    await expect(ownerRow).toContainText(L(lang, '1 new', '1 جديدة'));
    await ownerRow.click();
    await expect(shown(o.getByText(answer))).toBeVisible();
    await expect(
      shown(o.getByText(L(lang, 'Vamar', 'فامار'), { exact: true })).first(),
    ).toBeVisible();
    await owner.open('/messages');
    await expect(o.getByRole('link').filter({ hasText: subject }).first()).not.toContainText(
      L(lang, '1 new', '1 جديدة'),
    );

    // Staff close the thread; the owner sees it closed.
    await page.getByRole('button', { name: L(lang, 'Close thread', 'إغلاق المحادثة') }).click();
    await expect(page.getByText(L(lang, 'Closed on', 'أُغلقت في'))).toBeVisible();
    await o.getByRole('link').filter({ hasText: subject }).first().click();
    await expect(
      shown(
        o.getByText(
          L(lang, 'The Vamar team closed this conversation', 'أغلق فريق فامار هذه المحادثة'),
        ),
      ),
    ).toBeVisible();
    await owner.close();
  });
}

// 3. Statements ----------------------------------------------------------------------------------

interface Summary {
  rent: { collectedFils: number };
  expenses: { fixedFils: number; variableFils: number };
}

/** Today's date in Dubai as YYYY-MM-DD (the app's calendar). */
function dubaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
}

for (const lang of ['en', 'ar'] as const) {
  test(`statements: last year's statement and the monthly card on Home (${lang})`, async ({
    browser,
  }) => {
    const owner = await ownerApp(browser, OWNER_PHONE, lang);
    const o = owner.page;
    const lastYear = Number(dubaiToday().slice(0, 4)) - 1;

    // The yearly picker in Settings: pick last year, ask for its statement.
    await owner.open('/settings');
    await expect(
      o.getByText(L(lang, 'Yearly statement (PDF)', 'كشف الحساب السنوي PDF'), { exact: true }),
    ).toBeVisible();
    await o.getByRole('button', { name: exact(String(lastYear)) }).click();
    const summaryRes = o.waitForResponse(
      (r) =>
        r.url().includes('/api/owner/summary?') &&
        r.url().includes(`from=${String(lastYear)}-01-01`) &&
        r.url().includes(`to=${String(lastYear)}-12-31`),
    );
    const popup = owner.context.waitForEvent('page');
    await o
      .getByRole('button', {
        name: exact(L(lang, `Statement for ${lastYear}`, `كشف حساب ${lastYear}`)),
      })
      .click();
    const summary = (await (await summaryRes).json()) as Summary;
    const print = await popup;
    await print.waitForLoadState();
    await expect(print.locator('h1')).toHaveText(L(lang, 'Yearly statement', 'كشف الحساب السنوي'));
    await expect(print.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    const months = print.locator('table.months tr.month');
    await expect(months).toHaveCount(12);
    expect(
      await months.evaluateAll((rows) => rows.map((r) => r.getAttribute('data-month'))),
    ).toEqual(
      Array.from({ length: 12 }, (_, i) => `${lastYear}-${String(i + 1).padStart(2, '0')}`),
    );
    const collected = summary.rent.collectedFils;
    const expenses = summary.expenses.fixedFils + summary.expenses.variableFils;
    const total = print.locator('table.months tfoot tr.total');
    await expect(total.locator('th').first()).toHaveText(
      L(lang, 'Total for the year', 'إجمالي السنة'),
    );
    await expect(total.locator('[data-total="collected"]')).toHaveText(
      formatAmount(collected, lang),
    );
    await expect(total.locator('[data-total="expenses"]')).toHaveText(formatAmount(expenses, lang));
    await expect(total.locator('[data-total="net"]')).toHaveText(
      formatAmount(collected - expenses, lang),
    );
    await print.close();

    // The monthly summary push opens Home on last month with the statement card.
    const today = dubaiToday();
    const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    const lastDay = new Date(first.getTime() - 86_400_000);
    const from = `${lastDay.toISOString().slice(0, 7)}-01`;
    const to = lastDay.toISOString().slice(0, 10);
    await owner.open(`/?from=${from}&to=${to}&statement=1`);
    const monthName = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(lastDay);
    const card = o.getByRole('button', {
      name: L(lang, `Statement for ${monthName}`, `كشف حساب ${monthName}`),
    });
    await expect(card).toBeVisible();
    const monthPopup = owner.context.waitForEvent('page');
    await card.click();
    const monthPrint = await monthPopup;
    await monthPrint.waitForLoadState();
    await expect(monthPrint.locator('h1')).toHaveText(L(lang, 'Statement', 'كشف حساب'));
    await expect(monthPrint.locator('body')).toContainText(monthName);
    await expect(monthPrint.locator('table.months')).toHaveCount(0);
    await monthPrint.close();

    // Choosing another period hides the card.
    await o.getByRole('button', { name: exact(L(lang, 'This month', 'هذا الشهر')) }).click();
    await expect(card).toHaveCount(0);
    await owner.close();
  });
}

// 4. Budgets -------------------------------------------------------------------------------------

test('budget: an admin sets a building budget line and the owner sees it on Properties', async ({
  page,
  browser,
}) => {
  const year = Number(dubaiToday().slice(0, 4));
  // A category this building spent on this year, all of it visible to owners, with no line yet.
  const cat = await withLocalDb(async (c) => {
    const r = await c.query<{ id: string; nameAr: string; nameEn: string; actual: string }>(
      `select x.category_id as id, c.name_ar as "nameAr", c.name_en as "nameEn",
              sum(x.total_fils) as actual
         from expenses x join expense_categories c on c.id = x.category_id
        where x.building_id = $1 and x.status = 'posted'
          and x.invoice_date between make_date($2, 1, 1) and make_date($2, 12, 31)
          and c.active
          and not exists (select 1 from budgets b where b.building_id = $1 and b.year = $2
                            and b.category_id = x.category_id)
        group by 1, 2, 3
       having bool_and(x.visible_to_owner)
        order by actual desc limit 1`,
      [f().buildingId, year],
    );
    return r.rows[0];
  });
  if (!cat) throw new Error('no category with spend and no budget line in the owner building');
  // Budget = twice the spend, so the line is at 50 %; the odd 7 fils mark the line as this test's.
  const actual = Number(cat.actual);
  const budgetFils = actual * 2 + 7;
  const pct = Math.floor((actual * 100) / budgetFils);

  await login(page, 'admin', 'ar');
  await page.goto(`/buildings/${f().buildingId}`);
  const section = page.getByRole('region', { name: 'الميزانية' });
  await section.getByRole('button', { name: 'إضافة بند' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^الفئة/).selectOption({ label: cat.nameAr });
  await dialog.getByLabel(/^الميزانية السنوية/).fill((budgetFils / 100).toFixed(2));
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ الميزانية.')).toBeVisible();
  await expect(section.getByText(cat.nameAr)).toBeVisible();

  for (const lang of ['ar', 'en'] as const) {
    const owner = await ownerApp(browser, OWNER_PHONE, lang);
    await owner.open('/properties');
    const card = owner.page.getByTestId(`budget-${f().buildingId}`);
    await expect(card).toContainText(L(lang, `${year} budget`, `ميزانية ${year}`));
    const name = L(lang, cat.nameEn, cat.nameAr);
    await expect(card.getByRole('progressbar', { name })).toHaveAttribute(
      'aria-valuenow',
      String(pct),
    );
    await expect(card).toContainText(`${name}${pct}%`);
    await expect(card).toContainText(
      L(
        lang,
        `${formatAmount(actual, lang)} spent of ${formatAmount(budgetFils, lang)}`,
        `صُرف ${formatAmount(actual, lang)} من ${formatAmount(budgetFils, lang)}`,
      ),
    );
    await owner.close();
  }
});
