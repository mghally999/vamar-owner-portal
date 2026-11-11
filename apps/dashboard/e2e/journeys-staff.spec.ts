/**
 * Staff journeys through the newest dashboard features, clicked as a person would, against the
 * local stack (`pnpm dev` on 5173 proxying /api to the API on 8787, Auth emulator, seeded
 * Postgres):
 *
 * 1. Today panel: every tile opens its list with the same filter; a filter chip comes off.
 * 2. Bulk cheque status: deposit two with a date, a refused change that changes nothing, cancel.
 * 3. Bank statement: CSV, column mapping saved per bank, strong and weak matches, apply.
 * 4. Expense drafts queue: post two in bulk, delete one, hide and show a posted one (admin).
 * 5. Budgets: add a line, see actual against budget, cross 80 % and see it on Today.
 * 6. Renewal: suggestion card for Dubai (cap) and Sharjah (check the rules), prepare a draft.
 * 7. Calendar: Year, Month, Week and List; a day's count in Year opens that day's list.
 *
 * Journeys 1, 4 and 7 run in Arabic (1 switches with the sidebar's language button) and check
 * that the page stays right to left. Each journey prepares its own data and undoes what an
 * earlier run left behind, so the file can be run again and on its own (one worker).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import {
  addDays,
  dbAll,
  dbOne,
  deleteRenewalDrafts,
  dubaiToday,
  ensureJourneyAdmin,
  expectRtl,
  loginJourneyAdmin,
  resetChequesToDeposited,
  staffApi,
  trackStaffToken,
  typedDate,
  type Api,
} from './journeys-staff-support';

// Each journey is a few minutes of clicking on a slow laptop; the suite default is one minute.
test.describe.configure({ mode: 'default', timeout: 240_000 });
// The dev server on a busy laptop can take a few seconds per list; CI is faster.
const expect = baseExpect.configure({ timeout: 15_000 });

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const stamp = Date.now().toString().slice(-6);
const today = dubaiToday();
const year = Number(today.slice(0, 4));

test.beforeAll(async () => {
  await ensureJourneyAdmin();
});

async function signIn(page: Page, lang: 'ar' | 'en'): Promise<Api> {
  const token = trackStaffToken(page);
  await loginJourneyAdmin(page, lang);
  return staffApi(page, token);
}

async function buildingId(nameEn: string): Promise<string> {
  return (await dbOne<{ id: string }>('select id from buildings where name_en = $1', [nameEn])).id;
}

// 1 -------------------------------------------------------------------------------------------

test('Today panel: each tile opens its list with the same filter (Arabic, switched in the app)', async ({
  page,
}) => {
  await signIn(page, 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Overview/);

  // The sidebar's language button switches the whole app to Arabic and remembers the choice.
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('نظرة عامة');
  await expectRtl(page);
  expect(await page.evaluate(() => localStorage.getItem('vamar.lang'))).toBe('ar');
  // login() pins the language on every page load; keep Arabic from here on, as the app would.
  await page.addInitScript(() => {
    localStorage.setItem('vamar.lang', 'ar');
  });

  const today_ = page.locator('section[aria-labelledby="today-title"]');
  await expect(today_.getByText('اليوم', { exact: true })).toBeVisible();
  await expect(today_.getByRole('link')).toHaveCount(10);

  const tileCount = async (label: string) =>
    Number(
      await today_
        .getByRole('link', { name: new RegExp(label) })
        .locator('span')
        .first()
        .textContent(),
    );
  const openTile = async (label: string) => {
    await page.goto('/');
    await expect(today_.getByRole('link')).toHaveCount(10);
    const n = await tileCount(label);
    await today_.getByRole('link', { name: new RegExp(label) }).click();
    return n;
  };
  const search = () => new URL(page.url()).searchParams;

  // Cheques due today and in the next three days: the period and the status come with the link.
  await openTile('شيكات مستحقة اليوم');
  await expect(page).toHaveURL(/\/cheques\?/);
  expect(search().get('from')).toBe(today);
  expect(search().get('to')).toBe(today);
  await expect(page.getByLabel('الحالة')).toHaveValue('upcoming,deposited');
  await expectRtl(page);

  await openTile('شيكات مستحقة خلال 3 أيام');
  expect(search().get('from')).toBe(addDays(today, 1));
  expect(search().get('to')).toBe(addDays(today, 3));
  await expect(page.getByLabel('الحالة')).toHaveValue('upcoming,deposited');

  const bounced = await openTile('شيكات مرتجعة');
  expect(search().get('status')).toBe('bounced');
  await expect(page.getByLabel('الحالة')).toHaveValue('bounced');
  if (bounced > 0) {
    await expect(page.locator('main tbody tr', { hasText: 'مرتجع' }).first()).toBeVisible();
  }

  // Hearings in the next 7 days: no control of its own on the disputes page, so a chip.
  await openTile('جلسات خلال 7 أيام');
  await expect(page).toHaveURL(/\/disputes\?/);
  expect(search().get('hearingFrom')).toBe(today);
  expect(search().get('hearingTo')).toBe(addDays(today, 7));
  await removeChipAndSeeFullList(page, /جلسة من .+ إلى /);

  // Work orders past their date: chip, and the list holds exactly the tile's count.
  const overdue = await openTile('أوامر عمل تجاوزت موعدها');
  await expect(page).toHaveURL(/\/work-orders\?overdue=1/);
  if (overdue > 0) await expect(page.locator('main tbody tr')).toHaveCount(overdue);
  await removeChipAndSeeFullList(page, 'تجاوز الموعد المحدد');

  // Expense drafts: the drafts queue tab is open.
  await openTile('مسودات مصروفات');
  await expect(page).toHaveURL(/\/expenses\?/);
  expect(search().get('status')).toBe('draft');
  await expect(page.getByRole('tab', { name: 'قائمة المسودات' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Contracts ending in 30 days without a renewal draft: the 30-day box is ticked, plus a chip.
  const ending = await openTile('عقود تنتهي خلال 30 يوماً');
  await expect(page).toHaveURL(/\/contracts\?/);
  await expect(page.getByRole('checkbox', { name: 'عقود تنتهي خلال 30 يوماً' })).toBeChecked();
  if (ending > 0) await expect(page.locator('main tbody tr')).toHaveCount(ending);
  else await expect(page.getByText(/لا توجد عقود|لا عقود/)).toBeVisible();
  await removeChipAndSeeFullList(page, 'دون مسودة تجديد');

  // Owner approvals: the "awaiting owner approval" toggle is on.
  await openTile('بانتظار موافقة الملاك');
  expect(search().get('approval')).toBe('awaiting');
  await expect(page.getByRole('button', { name: 'بانتظار موافقة الملاك' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Budget lines past 80 %: the budgets page for this year.
  await openTile('بنود ميزانية تجاوزت 80%');
  await expect(page).toHaveURL(new RegExp(`/budgets\\?year=${String(year)}`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الميزانيات');
  await expect(page.getByLabel('السنة')).toHaveValue(String(year));

  // Unanswered owner messages: the "waiting for an answer" box is ticked.
  await openTile('رسائل ملاك بلا رد');
  expect(search().get('waiting')).toBe('1');
  await expect(page.getByRole('checkbox', { name: 'بانتظار الرد فقط' })).toBeChecked();
  await expectRtl(page);
});

/** The chip's remove button drops the filter from the URL and the list grows back. */
async function removeChipAndSeeFullList(page: Page, chip: string | RegExp) {
  const rows = page.locator('main tbody tr');
  await page.waitForLoadState('networkidle');
  const before = await rows.count();
  const remove = page.getByRole('button', {
    name: typeof chip === 'string' ? `إزالة عامل التصفية: ${chip}` : /^إزالة عامل التصفية: /,
  });
  await expect(remove).toBeVisible();
  const url = page.url();
  await remove.click();
  await expect(page).not.toHaveURL(url);
  await expect(remove).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  expect(await rows.count()).toBeGreaterThanOrEqual(before);
}

// 2 -------------------------------------------------------------------------------------------

/** A fresh active contract with three upcoming cheques, on a new unit, for this run only. */
async function contractWithUpcomingCheques(api: Api) {
  const building = await buildingId('Al Nahda Commercial Centre');
  const { id: ownerId } = await dbOne<{ id: string }>('select id from owners order by id limit 1');
  const { id: tenantId } = await dbOne<{ id: string }>(
    'select id from tenants order by id limit 1',
  );
  const unit = await api<{ id: string }>('POST', '/api/staff/units', {
    buildingId: building,
    unitNo: `E2E-B${stamp}`,
    type: 'office',
  });
  await api('PUT', `/api/staff/units/${unit.id}/owners`, {
    fromDate: today,
    owners: [{ ownerId, shareBp: 10_000 }],
  });
  const start = addDays(today, 20);
  const nos = [1, 2, 3].map((i) => `B${stamp}${String(i)}`);
  const contract = await api<{ id: string }>('POST', '/api/staff/contracts', {
    unitId: unit.id,
    tenantId,
    startDate: start,
    endDate: addDays(start, 364),
    annualRentFils: 3_000_000,
    chequeCount: 3,
    cheques: nos.map((chequeNo, i) => ({
      seq: i + 1,
      dueDate: addDays(start, i * 7),
      amountFils: 1_000_000,
      chequeNo,
      bankName: 'Mashreq',
    })),
  });
  await api('POST', `/api/staff/contracts/${contract.id}/activate`, {});
  return { nos, from: start, to: addDays(start, 14) };
}

test('Bulk cheque status: deposit two with a date, a refused change, cancel with a note', async ({
  page,
}) => {
  const api = await signIn(page, 'en');
  const { nos, from, to } = await contractWithUpcomingCheques(api);
  const [a, b, c] = nos as [string, string, string];
  const row = (no: string) =>
    page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: no, exact: true }) });
  const tick = (no: string) => page.getByRole('checkbox', { name: no, exact: true }).check();
  const bar = page.getByRole('region', { name: 'Selected cheques' });

  await page.goto(`/cheques?from=${from}&to=${to}`);
  await page.getByLabel('Building').selectOption({ label: 'Al Nahda Commercial Centre' });
  await expect(row(a)).toContainText('Upcoming');
  await expect(row(c)).toContainText('Upcoming');

  // Two upcoming cheques, deposited yesterday.
  await tick(a);
  await tick(b);
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: 'Mark deposited' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Mark deposited: 2 cheques');
  const deposit = dialog.getByLabel('Deposit date');
  await expect(deposit).toHaveValue(typedDate(today));
  // A date after today is refused before anything is sent.
  await deposit.fill(typedDate(addDays(today, 1)));
  await deposit.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  const yesterday = addDays(today, -1);
  await deposit.fill(typedDate(yesterday));
  await deposit.press('Enter');
  await expect(deposit).toHaveValue(typedDate(yesterday));
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('2 cheques updated.')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(row(a)).toContainText('Deposited');
  await expect(row(b)).toContainText('Deposited');
  await expect(row(c)).toContainText('Upcoming');
  // The bank's date is the one recorded, not the day of the click.
  const stamped = await dbAll<{ d: string }>(
    `select to_char(deposited_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as d
       from cheques where cheque_no = any($1::text[])`,
    [[a, b]],
  );
  expect(stamped.map((r) => r.d)).toEqual([yesterday, yesterday]);

  // Clearing a deposited cheque together with an upcoming one is refused as a whole.
  await tick(a);
  await tick(c);
  await bar.getByRole('button', { name: 'Mark cleared' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Nothing was changed. These cheques cannot be updated:',
  );
  const refused = dialog.getByRole('listitem');
  await expect(refused).toHaveCount(1);
  await expect(refused).toContainText(c);
  await expect(refused).toContainText('Is Upcoming; cannot move to Cleared');
  await dialog.getByRole('button', { name: 'Deselect these and go back' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(bar).toContainText('1 selected');
  await expect(page.getByRole('checkbox', { name: c, exact: true })).not.toBeChecked();
  // Nothing changed: a is still deposited, c still upcoming.
  await expect(row(a)).toContainText('Deposited');
  await expect(row(c)).toContainText('Upcoming');
  await bar.getByRole('button', { name: 'Clear selection' }).click();

  // Cancel the upcoming one with a note: no date asked.
  await tick(c);
  await bar.getByRole('button', { name: 'Cancel cheque' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Deposit date')).toHaveCount(0);
  await dialog.getByLabel('Note').fill(`Tenant replaced the cheque ${stamp}`);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('1 cheques updated.')).toBeVisible();
  await expect(row(c)).toContainText('Cancelled');

  // The note is on the cheque's history.
  await row(c).getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Cheque/);
  await expect(page.getByText(`Tenant replaced the cheque ${stamp}`)).toBeVisible();
});

// 3 -------------------------------------------------------------------------------------------

const STATEMENT = join(FIXTURES, 'bank-statement-e2e.csv');
const BANK = 'E2E Test Bank';
// The fixture's lines: 983281 credited (strong), 5,083.00 with no number (weak, 852565),
// 303337 returned (strong bounce), and a transfer that is no cheque.
const STRONG_NO = '983281';
const BOUNCE_NO = '303337';
const WEAK_NO = '852565';

test('Bank statement: map the columns once, match, apply, and the bank is remembered', async ({
  page,
}) => {
  expect(readFileSync(STATEMENT, 'utf8')).toContain(STRONG_NO);
  await resetChequesToDeposited([STRONG_NO, BOUNCE_NO, WEAK_NO], '2026-11-09');
  const api = await signIn(page, 'en');
  await api('DELETE', `/api/staff/settings/bank-csv-mappings?bank=${encodeURIComponent(BANK)}`);

  await page.goto('/cheques');
  await page.getByRole('link', { name: 'Bank statement' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bank statement');
  await page.locator('input[type="file"]').setInputFiles(STATEMENT);
  await expect(page.getByText('4 rows read from bank-statement-e2e.csv')).toBeVisible();

  // A bank seen for the first time: name it and map its columns.
  await expect(page.getByRole('combobox', { name: /^Saved bank/ })).toHaveValue('');
  await page.getByLabel('Bank name').fill(BANK);
  await page.getByRole('combobox', { name: 'Date', exact: true }).selectOption('Date');
  await page.getByRole('combobox', { name: /^Amount \(or credit\)/ }).selectOption('Credit');
  await page.getByRole('combobox', { name: /^Cheque number/ }).selectOption('Cheque No');
  await page.getByRole('combobox', { name: /^Description/ }).selectOption('Description');
  await page.getByRole('combobox', { name: /^Debit amount column/ }).selectOption('Debit');
  await page.getByRole('button', { name: 'Save mapping and find matches' }).click();

  const results = page.getByRole('region', { name: 'Proposed matches' });
  const match = (no: string) => results.getByRole('row').filter({ hasText: no });
  await expect(match(STRONG_NO)).toContainText('Strong');
  await expect(match(STRONG_NO)).toContainText('Cleared');
  await expect(match(BOUNCE_NO)).toContainText('Strong');
  await expect(match(BOUNCE_NO)).toContainText('Bounced');
  await expect(match(WEAK_NO)).toContainText('Review');
  await expect(match(WEAK_NO)).toContainText('Same amount within 3 days, no cheque number');
  // Strong matches start ticked; the weak one waits for a person.
  await expect(match(STRONG_NO).getByRole('checkbox')).toBeChecked();
  await expect(match(BOUNCE_NO).getByRole('checkbox')).toBeChecked();
  await expect(match(WEAK_NO).getByRole('checkbox')).not.toBeChecked();
  await results.getByText('Lines without a match (1)').click();
  await expect(results.getByText('TRANSFER FROM ACME TRADING LLC')).toBeVisible();
  await expect(results.getByText('No cheque with this number or amount')).toBeVisible();

  // Looked at the weak one: it is right, tick it too.
  await match(WEAK_NO).getByRole('checkbox').check();
  await results.getByRole('button', { name: 'Apply 3 selected' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply bank statement' });
  await expect(dialog).toContainText('2');
  // The bounce reason starts as "returned by the bank" and can be changed.
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('3 cheques updated from the statement.')).toBeVisible();

  // Each cheque's own page shows its new status.
  const ids = await dbAll<{ id: string; cheque_no: string }>(
    'select id, cheque_no from cheques where cheque_no = any($1::text[])',
    [[STRONG_NO, BOUNCE_NO, WEAK_NO]],
  );
  const idOf = (no: string) => ids.find((r) => r.cheque_no === no)?.id ?? '';
  for (const [no, status] of [
    [STRONG_NO, 'Cleared'],
    [WEAK_NO, 'Cleared'],
    [BOUNCE_NO, 'Bounced'],
  ] as const) {
    await page.goto(`/cheques/${idOf(no)}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(no);
    await expect(page.locator('main').getByText(status, { exact: true }).first()).toBeVisible();
  }

  // Next month's statement from the same bank: the saved columns are picked by themselves.
  await page.goto('/cheques/bank-statement');
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(STATEMENT);
  await expect(page.getByRole('combobox', { name: /^Saved bank/ })).toHaveValue(BANK);
  await expect(page.getByLabel('Bank name')).toHaveValue(BANK);
  await expect(page.getByRole('combobox', { name: /^Amount \(or credit\)/ })).toHaveValue('Credit');
  await expect(page.getByRole('combobox', { name: /^Debit amount column/ })).toHaveValue('Debit');
  await page.getByRole('button', { name: 'Save mapping and find matches' }).click();
  // Those cheques are settled now, so this statement proposes nothing new for them.
  await expect(page.getByText('No cheque matches this statement.')).toBeVisible();
});

// 4 -------------------------------------------------------------------------------------------

test('Expense drafts queue: post two, delete one, hide and show a posted one (Arabic)', async ({
  page,
}) => {
  const api = await signIn(page, 'ar');
  const building = await buildingId('Al Khan Residence');
  const { id: categoryId } = await dbOne<{ id: string }>(
    `select id from expense_categories where name_en = 'General maintenance'`,
  );
  const reasons = ['أ', 'ب', 'ج'].map((x) => `صيانة تجريبية ${stamp} ${x}`);
  for (const [i, reasonAr] of reasons.entries()) {
    await api('POST', '/api/staff/expenses', {
      scope: 'building',
      buildingId: building,
      categoryId,
      reasonAr,
      reasonEn: `E2E maintenance ${stamp} ${String(i + 1)}`,
      invoiceNo: `E2E-X${stamp}-${String(i + 1)}`,
      invoiceDate: today,
      amountFils: 30_000 + i * 1_000,
      vatFils: 0,
    });
  }
  const [a, b, c] = reasons as [string, string, string];
  const tick = (reason: string) =>
    page.getByRole('checkbox', { name: new RegExp(`^اختيار ${reason} · `) });
  const bar = page.getByRole('region', { name: 'المصروفات المختارة' });

  await page.getByRole('link', { name: 'المصروفات' }).first().click();
  await page.getByRole('tab', { name: 'قائمة المسودات' }).click();
  await page.getByLabel('بحث').fill(`صيانة تجريبية ${stamp}`);
  await expect(page.locator('main tbody tr')).toHaveCount(3);
  await expectRtl(page);

  // Post two drafts at once.
  await tick(a).check();
  await tick(b).check();
  await expect(bar).toContainText('تم اختيار 2');
  await bar.getByRole('button', { name: 'ترحيل' }).click();
  let dialog = page.getByRole('dialog', { name: 'ترحيل المسودات المختارة (2)' });
  await dialog.getByLabel('ملاحظة').fill('ترحيل تجريبي');
  await dialog.getByRole('button', { name: 'تأكيد' }).click();
  await expect(page.getByText('المصروفات المرحَّلة: 2.')).toBeVisible();
  await expect(page.locator('main tbody tr')).toHaveCount(1);
  await expect(page.locator('main tbody tr')).toContainText(c);

  // Delete the third.
  await tick(c).check();
  await bar.getByRole('button', { name: 'حذف المسودات' }).click();
  dialog = page.getByRole('dialog', { name: 'حذف المسودات المختارة (1)' });
  await dialog.getByRole('button', { name: 'تأكيد' }).click();
  await expect(page.getByText('المسودات المحذوفة: 1.')).toBeVisible();
  await expect(page.getByText('لا توجد مصروفات في هذه الفترة.')).toBeVisible();

  // Posted: hide the first from the owners, then show it again.
  await page.getByRole('tab', { name: 'المرحَّلة' }).click();
  await expect(page.locator('main tbody tr')).toHaveCount(2);
  await expect(page.locator('main tbody tr').first()).toContainText('مرحَّل');
  for (const [action, title, done, visible] of [
    [
      'إخفاء عن الملاك',
      'إخفاء المصروفات المختارة عن الملاك (1)',
      'المصروفات المخفية عن الملاك: 1.',
      'لا',
    ],
    ['إظهار للملاك', 'إظهار المصروفات المختارة للملاك (1)', 'المصروفات الظاهرة للملاك: 1.', 'نعم'],
  ] as const) {
    await tick(a).check();
    await bar.getByRole('button', { name: action }).click();
    dialog = page.getByRole('dialog', { name: title });
    await dialog.getByRole('button', { name: 'تأكيد' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(done)).toBeVisible();
    await page.locator('main tbody tr', { hasText: a }).getByRole('link').click();
    await expect(page.getByText('ظاهر للملاك').locator('..')).toContainText(visible);
    await expectRtl(page);
    await page.goBack();
    await page.getByRole('tab', { name: 'المرحَّلة' }).click();
    await page.getByLabel('بحث').fill(`صيانة تجريبية ${stamp}`);
    await expect(page.locator('main tbody tr')).toHaveCount(2);
  }
});

// 5 -------------------------------------------------------------------------------------------

test('Budgets: an admin adds a line, sees actual against budget, and Today flags 80 %', async ({
  page,
}) => {
  const api = await signIn(page, 'en');
  const building = await buildingId('Al Safa Building');
  const { id: categoryId } = await dbOne<{ id: string }>(
    `select id from expense_categories where name_en = 'Pest control'`,
  );
  // Undo an earlier run: its expense is voided and its line removed.
  for (const e of await dbAll<{ id: string }>(
    `select id from expenses where invoice_no like 'E2E-BUD-%' and status = 'posted'`,
  )) {
    await api('POST', `/api/staff/expenses/${e.id}/void`, {
      reason: 'End-to-end test clean-up',
    });
  }
  for (const l of await dbAll<{ id: string }>(
    'select id from budgets where building_id = $1 and year = $2 and category_id = $3',
    [building, year, categoryId],
  )) {
    await api('DELETE', `/api/staff/budgets/${l.id}`);
  }

  const todayTile = page
    .locator('section[aria-labelledby="today-title"]')
    .getByRole('link', { name: /Budget lines past 80%/ });
  await page.goto('/');
  const before = Number(await todayTile.locator('span').first().textContent());

  await page.getByRole('link', { name: 'Buildings & units' }).first().click();
  await page
    .getByRole('link', { name: /Al Safa Building/ })
    .first()
    .click();
  const section = page.locator('section[aria-labelledby="budget-title"]');
  await section.getByRole('button', { name: 'Add line' }).click();
  const dialog = page.getByRole('dialog', { name: 'New budget line' });
  await dialog.getByLabel('Category').selectOption({ label: 'Pest control' });
  await dialog.getByLabel('Yearly budget (AED)').fill('1000');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(section.getByText('Budget saved.')).toBeVisible();
  const line = section.getByRole('listitem').filter({ hasText: 'Pest control' });
  await expect(line).toContainText('0%');
  await expect(line).toContainText(/0(\.00)? spent of .*1,000/);
  await expect(line.getByRole('img', { name: 'Pest control: 0%' })).toBeVisible();

  // An 850 AED pest-control invoice is posted from its draft page.
  const draft = await api<{ id: string }>('POST', '/api/staff/expenses', {
    scope: 'building',
    buildingId: building,
    categoryId,
    reasonAr: `مكافحة حشرات ${stamp}`,
    reasonEn: `Pest control ${stamp}`,
    invoiceNo: `E2E-BUD-${stamp}`,
    invoiceDate: today,
    amountFils: 85_000,
    vatFils: 0,
  });
  await page.goto(`/expenses/${draft.id}`);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Expense posted.')).toBeVisible();

  // Actual against budget, with the bar.
  await page.goto(`/buildings/${building}`);
  await expect(line).toContainText('85%');
  await expect(line).toContainText(/850(\.00)? spent of .*1,000/);
  await expect(line.getByRole('img', { name: 'Pest control: 85%' })).toBeVisible();

  // Today counts the line, and its link opens this year's budgets with it.
  await page.goto('/');
  await expect(todayTile.locator('span').first()).toHaveText(String(before + 1));
  await todayTile.click();
  const safa = page.getByRole('region', { name: 'Al Safa Building' });
  await expect(safa.getByRole('listitem').filter({ hasText: 'Pest control' })).toContainText('85%');
});

// 6 -------------------------------------------------------------------------------------------

test('Renewal: Dubai cap and Sharjah rules on the suggestion, then a draft at a new rent', async ({
  page,
}) => {
  const safa = await dbOne<{ id: string; end_date: string }>(
    `select c.id, to_char(c.end_date, 'YYYY-MM-DD') as end_date
       from contracts c join units u on u.id = c.unit_id join buildings b on b.id = u.building_id
      where b.name_en = 'Al Safa Building' and u.unit_no = '201' and c.status = 'active'`,
  );
  await deleteRenewalDrafts(safa.id);
  await signIn(page, 'en');

  // Sharjah: no cap is worked out; staff are told to check the emirate's rules.
  await page.goto('/contracts?endingWithinDays=90');
  await page.getByRole('link', { name: /Mamzar Villas · V1/ }).click();
  const card = page.locator('section', { has: page.getByText('Renewal suggestion') }).first();
  await expect(card).toContainText(/Renewal due in \d+ days/);
  await expect(card.getByRole('heading', { name: 'Check the emirate’s rent rules' })).toBeVisible();
  await expect(card).toContainText('No cap is worked out for Sharjah');
  await expect(card.getByText('Dubai rent increase cap')).toHaveCount(0);

  // Dubai: comparables and the cap.
  await page.goto('/contracts?endingWithinDays=90');
  const listRow = page.getByRole('row').filter({ hasText: 'Al Safa Building · 201' });
  await expect(listRow).toContainText(/Renewal due in \d+ days/);
  await listRow.getByRole('link').click();
  await expect(card).toContainText('Renewal suggestion');
  await expect(card).toContainText('Market reference');
  await expect(card.getByRole('heading', { name: 'Dubai rent increase cap' })).toBeVisible();
  await expect(card.getByText(/Contracts (used|found) \(\d+\)/)).toBeVisible();

  await card.getByRole('button', { name: 'Prepare renewal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Prepare renewal' });
  const rent = dialog.getByLabel('New annual rent (AED)');
  await expect(rent).not.toHaveValue('');
  await rent.fill('87500');
  await dialog.getByRole('button', { name: 'Create draft' }).click();

  // Lands on the new draft, starting the day after the old contract ends.
  await expect(page).not.toHaveURL(new RegExp(safa.id));
  await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Draft').first()).toBeVisible();
  await expect(page.locator('main')).toContainText('87,500');
  const draft = await dbOne<{ annual_rent_fils: string; start_date: string }>(
    `select annual_rent_fils, to_char(start_date, 'YYYY-MM-DD') as start_date
       from contracts where previous_contract_id = $1 and status = 'draft'`,
    [safa.id],
  );
  expect(Number(draft.annual_rent_fils)).toBe(8_750_000);
  expect(draft.start_date).toBe(addDays(safa.end_date, 1));

  // The old contract now points to its draft instead of offering a second one.
  await page.goBack();
  await expect(card.getByRole('link', { name: 'Open renewal draft' })).toBeVisible();
});

// 7 -------------------------------------------------------------------------------------------

test('Calendar: year, month, week and list; a day count in Year opens that day (Arabic)', async ({
  page,
}) => {
  await signIn(page, 'ar');
  await page.getByRole('link', { name: 'التقويم' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('التقويم');
  const tabs = page.getByRole('tablist');
  const view = (name: string) => tabs.getByRole('tab', { name, exact: true });

  for (const [name, selector] of [
    ['شهر', '.fc-dayGridMonth-view'],
    ['أسبوع', '.fc-timeGridWeek-view'],
    ['قائمة', '.fc-listMonth-view'],
    ['سنة', '.fc-multiMonthYear-view'],
  ] as const) {
    await view(name).click();
    await expect(view(name)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(selector)).toBeVisible();
    await expectRtl(page);
  }

  // Year shows one count per busy day; it opens the day's list with that many items.
  const count = page.locator('.fc-multiMonthYear-view button.vc-count').first();
  await expect(count).toBeVisible();
  const n = Number((await count.textContent())?.trim());
  expect(n).toBeGreaterThan(0);
  await expect(count).toHaveAttribute('aria-label', /عنصر|عنصران|عناصر|عنصرًا/);
  await count.click();
  await expect(page.locator('.fc-listDay-view')).toBeVisible();
  await expect(view('قائمة')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.fc-listDay-view .fc-list-event')).toHaveCount(n);
  await expectRtl(page);
});
