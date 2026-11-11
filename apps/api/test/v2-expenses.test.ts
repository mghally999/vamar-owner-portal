/**
 * Expenses: categories and vendors, the draft -> posted -> void life cycle with allocations that
 * add up, the warnings, the roles, recurring rules and the drafts the cron creates from them.
 */
import { and, eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyJobs } from '../src/cron.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
let editor: string;
let viewer: string;
let noor: { id: string };
let categories: { id: string; nameEn: string; kind: string }[];
let vendorId: string;

const cat = (nameEn: string) => {
  const c = categories.find((x) => x.nameEn === nameEn);
  if (!c) throw new Error(`no category ${nameEn}`);
  return c;
};

beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
  editor = await w.staffToken('entry@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  const [b] = await w.db
    .select({ id: schema.buildings.id })
    .from(schema.buildings)
    .where(eq(schema.buildings.nameEn, 'Al Noor Tower'));
  noor = b!;
  const res = await w.json<{ items: typeof categories }>('/api/staff/expense-categories', {
    token: viewer,
  });
  categories = res.body.items;
  const [v] = await w.db
    .select({ id: schema.vendors.id })
    .from(schema.vendors)
    .where(eq(schema.vendors.name, 'Gulf Lifts Technical Services'));
  vendorId = v!.id;
  // These are life-cycle tests of large repairs; owner approval of them is v3-approvals.test.ts.
  await w.json('/api/staff/settings', {
    method: 'PATCH',
    token: admin,
    body: JSON.stringify({ repairApprovalThresholdFils: 100_000_000 }),
  });
});
afterAll(() => w.close());

describe('categories and vendors', () => {
  it('ships the seeded fixed and variable categories; only admins change them', async () => {
    expect(categories.filter((c) => c.kind === 'fixed').length).toBe(8);
    expect(categories.filter((c) => c.kind === 'variable').length).toBe(13);
    const forbidden = await w.json('/api/staff/expense-categories', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ nameAr: 'x', nameEn: 'x', kind: 'fixed' }),
    });
    expect(forbidden.status).toBe(403);
    const created = await w.json<{ id: string }>('/api/staff/expense-categories', {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ nameAr: 'حدائق', nameEn: 'Landscaping', kind: 'variable', sort: 5 }),
    });
    expect(created.status).toBe(201);
    const off = await w.json('/api/staff/expense-categories/' + created.body.id, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ active: false }),
    });
    expect(off.status).toBe(200);
    const visible = await w.json<{ items: { id: string }[] }>('/api/staff/expense-categories', {
      token: viewer,
    });
    expect(visible.body.items.some((c) => c.id === created.body.id)).toBe(false);
  });

  it('vendors need a 15-digit TRN when given; editors may add them', async () => {
    const bad = await w.json('/api/staff/vendors', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ name: 'Bad TRN', trn: '12' }),
    });
    expect(bad.status).toBe(422);
    const ok = await w.json<{ id: string; trn: string | null }>('/api/staff/vendors', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ name: 'New Vendor LLC', trn: '100999999900003' }),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.trn).toBe('100999999900003');
    const list = await w.json<{ items: { name: string }[] }>('/api/staff/vendors?search=New', {
      token: viewer,
    });
    expect(list.body.items.map((v) => v.name)).toContain('New Vendor LLC');
  });
});

describe('expense life cycle', () => {
  let expenseId: string;

  it('creates a draft with 5 % VAT from the vendor TRN, previews the split, posts it and the parts add up', async () => {
    const body = {
      scope: 'building',
      buildingId: noor.id,
      categoryId: cat('Lifts (repairs)').id,
      vendorId,
      reasonAr: 'استبدال كابل المصعد',
      reasonEn: 'Lift cable replacement',
      invoiceNo: 'GL-TEST-1',
      invoiceDate: TODAY,
      amountFils: 1_000_001,
    };
    const preview = await w.json<{
      method: string;
      items: { amountFils: number; ownerId: string }[];
    }>('/api/staff/expenses/preview-allocation', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: noor.id,
        invoiceDate: TODAY,
        totalFils: 1_050_001,
      }),
    });
    expect(preview.status).toBe(200);
    expect(preview.body.method).toBe('by_area');
    expect(preview.body.items.reduce((a, p) => a + p.amountFils, 0)).toBe(1_050_001);

    const created = await w.json<{
      id: string;
      status: string;
      vatFils: number;
      totalFils: number;
      kind: string;
      allocationMethod: string;
      warnings: { duplicateInvoice: unknown; outlier: unknown };
    }>('/api/staff/expenses', { method: 'POST', token: editor, body: JSON.stringify(body) });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.vatFils).toBe(50_000);
    expect(created.body.totalFils).toBe(1_050_001);
    expect(created.body.kind).toBe('variable');
    expect(created.body.allocationMethod).toBe('by_area');
    expect(created.body.warnings.duplicateInvoice).toBeNull();
    expenseId = created.body.id;

    const posted = await w.json<{
      expense: { status: string; totalFils: number };
      allocations: { amountFils: number; ownerId: string; unitId: string }[];
      large: boolean;
    }>(`/api/staff/expenses/${expenseId}/post`, { method: 'POST', token: editor });
    expect(posted.status).toBe(200);
    expect(posted.body.expense.status).toBe('posted');
    expect(posted.body.allocations.length).toBe(8); // eight units, one owner
    expect(posted.body.allocations.reduce((a, p) => a + p.amountFils, 0)).toBe(1_050_001);
    expect(posted.body.large).toBe(true);
    await w.flush();
    const pushed = await w.db
      .select()
      .from(schema.notificationLog)
      .where(
        and(
          eq(schema.notificationLog.type, 'large_expense'),
          eq(schema.notificationLog.entityId, expenseId),
        ),
      );
    expect(pushed.length).toBe(1);

    const again = await w.json(`/api/staff/expenses/${expenseId}/post`, {
      method: 'POST',
      token: editor,
    });
    expect(again.status).toBe(409);
    const edit = await w.json(`/api/staff/expenses/${expenseId}`, {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ amountFils: 5 }),
    });
    expect(edit.status).toBe(409);
  });

  it('warns about a duplicate invoice number from the same vendor and an outlier amount', async () => {
    const warn = await w.json<{ duplicateInvoice: { expenseId: string } | null; outlier: unknown }>(
      '/api/staff/expenses/warnings',
      {
        method: 'POST',
        token: editor,
        body: JSON.stringify({
          vendorId,
          invoiceNo: 'GL-TEST-1',
          categoryId: cat('Lifts (repairs)').id,
          totalFils: 100,
        }),
      },
    );
    expect(warn.body.duplicateInvoice?.expenseId).toBe(expenseId);
    // Salaries: eighteen months of posted invoices; ten times the usual amount is an outlier.
    const outlier = await w.json<{ outlier: { averageFils: number } | null }>(
      '/api/staff/expenses/warnings',
      {
        method: 'POST',
        token: editor,
        body: JSON.stringify({
          vendorId: null,
          invoiceNo: null,
          categoryId: cat('Building staff salaries (guard, cleaners, technician)').id,
          totalFils: 50_000_000,
        }),
      },
    );
    expect(outlier.body.outlier).not.toBeNull();
    expect(outlier.body.outlier!.averageFils).toBeGreaterThan(0);
  });

  it('shows the detail with allocations, and lists with totals and filters', async () => {
    const detail = await w.json<{
      allocations: { amountFils: number; nameEn: string; unitNo: string }[];
      categoryNameEn: string;
      vendorName: string;
      postedByName: string | null;
    }>(`/api/staff/expenses/${expenseId}`, { token: viewer });
    expect(detail.status).toBe(200);
    expect(detail.body.categoryNameEn).toBe('Lifts (repairs)');
    expect(detail.body.vendorName).toBe('Gulf Lifts Technical Services');
    expect(detail.body.allocations.every((a) => a.nameEn === 'Khalid Al Mansoori')).toBe(true);
    expect(detail.body.postedByName).toBe('Noura Al Hammadi');

    const list = await w.json<{
      items: { id: string; kind: string }[];
      totals: { count: number; totalFils: number; fixedFils: number; variableFils: number };
    }>(`/api/staff/expenses?buildingId=${noor.id}&kind=variable&status=posted&limit=100`, {
      token: viewer,
    });
    expect(list.body.items.some((e) => e.id === expenseId)).toBe(true);
    expect(list.body.items.every((e) => e.kind === 'variable')).toBe(true);
    expect(list.body.totals.fixedFils).toBe(0);
    expect(list.body.totals.variableFils).toBe(list.body.totals.totalFils);
    expect(list.body.totals.count).toBe(list.body.items.length);

    const thisYear = await w.json<{ totals: { count: number } }>(
      '/api/staff/expenses?preset=this_year&status=posted&limit=1',
      { token: viewer },
    );
    expect(thisYear.body.totals.count).toBeGreaterThan(10);
    const search = await w.json<{ items: { id: string }[] }>('/api/staff/expenses?search=GL-TEST', {
      token: viewer,
    });
    expect(search.body.items.map((e) => e.id)).toContain(expenseId);
  });

  it('only an admin voids a posted expense; the correction is posted in the same transaction', async () => {
    const denied = await w.json(`/api/staff/expenses/${expenseId}/void`, {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ reason: 'wrong amount' }),
    });
    expect(denied.status).toBe(403);
    const voided = await w.json<{
      voided: { status: string; voidReason: string };
      correction: {
        expense: { id: string; status: string; correctsExpenseId: string; totalFils: number };
      } | null;
    }>(`/api/staff/expenses/${expenseId}/void`, {
      method: 'POST',
      token: admin,
      body: JSON.stringify({
        reason: 'Invoice was for AED 9,000, not 10,000',
        correction: {
          scope: 'building',
          buildingId: noor.id,
          categoryId: cat('Lifts (repairs)').id,
          vendorId,
          reasonAr: 'استبدال كابل المصعد (مصحح)',
          reasonEn: 'Lift cable replacement (corrected)',
          invoiceNo: 'GL-TEST-1',
          invoiceDate: TODAY,
          amountFils: 900_000,
          vatFils: 45_000,
        },
      }),
    });
    expect(voided.status).toBe(200);
    expect(voided.body.voided.status).toBe('void');
    expect(voided.body.correction?.expense.status).toBe('posted');
    expect(voided.body.correction?.expense.correctsExpenseId).toBe(expenseId);
    expect(voided.body.correction?.expense.totalFils).toBe(945_000);
    const twice = await w.json(`/api/staff/expenses/${expenseId}/void`, {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ reason: 'again' }),
    });
    expect(twice.status).toBe(409);
    // The voided allocations are history: no owner total counts them.
    const detail = await w.json<{ allocations: unknown[]; correctedBy: { id: string } | null }>(
      `/api/staff/expenses/${expenseId}`,
      { token: viewer },
    );
    expect(detail.body.allocations.length).toBe(8);
    expect(detail.body.correctedBy?.id).toBe(voided.body.correction?.expense.id);
  });

  it('refuses bad input with the 422 envelope and hides writes from viewers', async () => {
    const bad = await w.json<{ error: { code: string; details: { path: string }[] } }>(
      '/api/staff/expenses',
      {
        method: 'POST',
        token: editor,
        body: JSON.stringify({
          scope: 'unit',
          buildingId: noor.id,
          categoryId: cat('Plumbing').id,
          reasonAr: 'x',
          reasonEn: 'x',
          invoiceDate: TODAY,
          amountFils: 100,
        }),
      },
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('validation');
    expect(bad.body.error.details.some((d) => d.path === 'unitId')).toBe(true);
    const denied = await w.json('/api/staff/expenses', {
      method: 'POST',
      token: viewer,
      body: JSON.stringify({}),
    });
    expect(denied.status).toBe(403);
    const unknownCategory = await w.json('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: noor.id,
        categoryId: '019a0000-0000-7000-8000-000000000099',
        reasonAr: 'x',
        reasonEn: 'x',
        invoiceDate: TODAY,
        amountFils: 100,
      }),
    });
    expect(unknownCategory.status).toBe(404);
  });

  it('a draft can be edited and deleted by an editor', async () => {
    const draft = await w.json<{ id: string; vatFils: number }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: noor.id,
        categoryId: cat('Pest control').id,
        reasonAr: 'رش',
        reasonEn: 'Spraying',
        invoiceDate: TODAY,
        amountFils: 50_000,
      }),
    });
    expect(draft.body.vatFils).toBe(0); // no vendor: no VAT by default
    const edited = await w.json<{ amountFils: number; totalFils: number; vatFils: number }>(
      `/api/staff/expenses/${draft.body.id}`,
      {
        method: 'PATCH',
        token: editor,
        body: JSON.stringify({ amountFils: 60_000, vatFils: 3_000 }),
      },
    );
    expect(edited.body.totalFils).toBe(63_000);
    const gone = await w.json(`/api/staff/expenses/${draft.body.id}`, {
      method: 'DELETE',
      token: editor,
    });
    expect(gone.status).toBe(200);
    expect(
      (await w.request(`/api/staff/expenses/${draft.body.id}`, { token: viewer })).status,
    ).toBe(404);
  });
});

describe('recurring rules and the cron', () => {
  it('a rule due today becomes one draft, once, with the covered month', async () => {
    const day = Number(TODAY.slice(8, 10));
    const rule = await w.json<{ id: string; allocationMethod: string; vatFils: number }>(
      '/api/staff/recurring-rules',
      {
        method: 'POST',
        token: editor,
        body: JSON.stringify({
          scope: 'building',
          buildingId: noor.id,
          categoryId: cat('Internet and intercom').id,
          reasonAr: 'اشتراك',
          reasonEn: 'Subscription',
          amountFils: 20_000,
          frequency: 'monthly',
          dayOfMonth: day,
          startDate: addDays(TODAY, -40),
        }),
      },
    );
    expect(rule.status).toBe(201);
    expect(rule.body.allocationMethod).toBe('by_area');
    const variable = await w.json('/api/staff/recurring-rules', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: noor.id,
        categoryId: cat('Plumbing').id,
        reasonAr: 'x',
        reasonEn: 'x',
        amountFils: 1,
        frequency: 'monthly',
        dayOfMonth: 1,
        startDate: TODAY,
      }),
    });
    expect(variable.status).toBe(422);

    const first = await runDailyJobs(w.env);
    expect(first.recurringDrafts).toBeGreaterThanOrEqual(1);
    const drafts = await w.db
      .select()
      .from(schema.expenses)
      .where(
        and(eq(schema.expenses.recurringRuleId, rule.body.id), eq(schema.expenses.status, 'draft')),
      );
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.invoiceDate).toBe(TODAY);
    expect(drafts[0]!.coversFrom).toBe(`${TODAY.slice(0, 7)}-01`);
    const second = await runDailyJobs(w.env);
    expect(second.recurringDrafts).toBe(0);

    const queue = await w.json<{ items: { recurringRuleId: string | null }[] }>(
      `/api/staff/expenses?status=draft&recurringRuleId=${rule.body.id}`,
      { token: viewer },
    );
    expect(queue.body.items.length).toBe(1);
    const paused = await w.json<{ active: boolean }>(`/api/staff/recurring-rules/${rule.body.id}`, {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ active: false }),
    });
    expect(paused.body.active).toBe(false);
  });
});
