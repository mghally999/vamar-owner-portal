/**
 * Building budgets: admin writes and staff reads, budget against actual and forecast against the
 * seed on the pinned day, the 80 % and 100 % pushes (once each, owner-visible figures), the Today
 * panel count and owner isolation on the owner endpoint.
 */
import { and, eq, gte, inArray, like, lte } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  budgetAlertKeyDate,
  budgetToDate,
  projectedFixedByCategory,
  type BudgetRule,
  type PlainDate,
} from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
let editor: string;
let viewer: string;
const PHONES = {
  khalid: '+971500000001',
  fatima: '+971500000002',
  omar: '+971500000003',
  mariam: '+971500000004',
  rashid: '+971500000005',
} as const;
type OwnerKey = keyof typeof PHONES;
const tok = {} as Record<OwnerKey, string>;
const oid = {} as Record<OwnerKey, string>;
let b: Record<'noor' | 'safa' | 'khan' | 'nahda', string>;
let cat: (nameEn: string) => string;
const AED = (n: number) => Math.round(n * 100);

interface Line {
  budgetId: string;
  categoryId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  budgetFils: number;
  actualFils: number;
  actualToDateFils: number;
  budgetToDateFils: number;
  projectedFils: number;
  forecastFils: number;
  percent: number;
  forecastPercent: number;
  toDatePercent: number;
  level: string;
  forecastLevel: string;
}
interface Report {
  year: number;
  today: string;
  buildings: { buildingId: string; nameEn: string; nameAr: string; lines: Line[] }[];
}

const staffBudgets = (query: string, token = viewer) =>
  w.json<Report>(`/api/staff/budgets${query}`, { token });
const ownerBudgets = (who: OwnerKey, query = '') =>
  w.json<Report>(`/api/owner/budgets${query}`, { token: tok[who] });
const create = (body: Record<string, unknown>, token = admin) =>
  w.json<{ id: string; amountFils: number; error?: { code: string } }>('/api/staff/budgets', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
const lineOf = (r: Report, buildingId: string, categoryId: string | null) =>
  r.buildings
    .find((x) => x.buildingId === buildingId)
    ?.lines.find((l) => l.categoryId === categoryId);

/** Posts a variable expense (under the approval threshold) and waits for the background check. */
async function postExpense(fields: Record<string, unknown>) {
  const draft = await w.json<{ id: string }>('/api/staff/expenses', {
    method: 'POST',
    token: editor,
    body: JSON.stringify({
      scope: 'building',
      reasonAr: 'مصروف تجريبي',
      reasonEn: 'Test expense',
      invoiceDate: TODAY,
      ...fields,
    }),
  });
  expect(draft.status).toBe(201);
  const posted = await w.request(`/api/staff/expenses/${draft.body.id}/post`, {
    method: 'POST',
    token: editor,
  });
  expect(posted.status).toBe(200);
  await w.flush();
  return draft.body.id;
}

const budgetPushes = (ownerId: string) =>
  w.db
    .select({ key: schema.notificationLog.dedupeKey, entityId: schema.notificationLog.entityId })
    .from(schema.notificationLog)
    .where(
      and(
        eq(schema.notificationLog.type, 'budget_threshold'),
        eq(schema.notificationLog.ownerId, ownerId),
      ),
    );

async function rulesOf(buildingId: string): Promise<BudgetRule[]> {
  const rows = await w.db
    .select()
    .from(schema.recurringExpenseRules)
    .where(eq(schema.recurringExpenseRules.buildingId, buildingId));
  return rows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    active: r.active,
    amountFils: r.amountFils,
    vatFils: r.vatFils,
    frequency: r.frequency,
    dayOfMonth: r.dayOfMonth,
    startDate: r.startDate as PlainDate,
    endDate: r.endDate as PlainDate | null,
  }));
}
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, v) => a + v, 0);

/** The building's posted expenses of 2026, all of them or only those owners can see. */
async function postedIn2026(buildingId: string, ownerVisibleOnly = false): Promise<number> {
  const rows = await w.db
    .select({ total: schema.expenses.totalFils })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.buildingId, buildingId),
        eq(schema.expenses.status, 'posted'),
        gte(schema.expenses.invoiceDate, '2026-01-01'),
        lte(schema.expenses.invoiceDate, '2026-12-31'),
        ownerVisibleOnly ? eq(schema.expenses.visibleToOwner, true) : undefined,
      ),
    );
  return rows.reduce((a, r) => a + r.total, 0);
}

beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
  editor = await w.staffToken('entry@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  for (const k of Object.keys(PHONES) as OwnerKey[]) {
    tok[k] = await w.ownerToken(PHONES[k]);
    oid[k] = w.ids.owners[PHONES[k]]!;
  }
  const buildings = await w.db
    .select({ id: schema.buildings.id, nameEn: schema.buildings.nameEn })
    .from(schema.buildings);
  const byName = (n: string) => buildings.find((x) => x.nameEn.startsWith(n))!.id;
  b = {
    noor: byName('Al Noor'),
    safa: byName('Al Safa'),
    khan: byName('Al Khan'),
    nahda: byName('Al Nahda'),
  };
  const cats = await w.db.select().from(schema.expenseCategories);
  cat = (n) => cats.find((c) => c.nameEn.startsWith(n))!.id;
  // A phone that accepts pushes for every owner, so the pushes are recorded as sent.
  for (const id of Object.values(oid))
    await w.db.insert(schema.devices).values({
      ownerId: id,
      deviceId: `b-${id.slice(0, 8)}`,
      platform: 'android',
      pushToken: 'ExponentPushToken[budgets]',
    });
});
afterAll(() => w.close());

describe('budget against actual, on the seed', () => {
  it('lists the budgeted buildings with category lines first and the total last', async () => {
    const r = await staffBudgets('?year=2026');
    expect(r.status).toBe(200);
    expect(r.body.year).toBe(2026);
    expect(r.body.today).toBe(TODAY);
    expect(r.body.buildings.map((x) => x.nameEn)).toEqual(['Al Khan Residence', 'Al Noor Tower']);
    const noor = r.body.buildings.find((x) => x.buildingId === b.noor)!;
    // Categories in the order of the category list (fixed costs first), the total last.
    expect(noor.lines.map((l) => l.nameEn)).toEqual([
      'Building staff salaries (guard, cleaners, technician)',
      'Lifts (repairs)',
      null,
    ]);
    // Without a year: the current Dubai year.
    expect((await staffBudgets('')).body.year).toBe(2026);
  });

  it('lift repairs: AED 13,020 posted of AED 15,000, nothing projected, 86 %', async () => {
    const lifts = lineOf((await staffBudgets('?year=2026')).body, b.noor, cat('Lifts (repairs)'))!;
    expect(lifts).toMatchObject({
      nameAr: expect.any(String),
      budgetFils: AED(15_000),
      actualFils: AED(13_020),
      actualToDateFils: AED(13_020),
      projectedFils: 0,
      forecastFils: AED(13_020),
      percent: 86,
      level: 'near',
      forecastLevel: 'near',
    });
    // 7 October is day 280 of 365.
    expect(lifts.budgetToDateFils).toBe(budgetToDate(AED(15_000), 2026, TODAY));
    expect(lifts.budgetToDateFils).toBe(Math.round((AED(15_000) * 280) / 365));
    expect(lifts.toDatePercent).toBe(113);
  });

  it('salaries: January to September posted, October to December projected from the rule', async () => {
    const line = lineOf((await staffBudgets('?year=2026')).body, b.noor, cat('Building staff'))!;
    // AED 6,500 + 5 % VAT a month.
    expect(line).toMatchObject({
      budgetFils: AED(103_000),
      actualFils: 9 * AED(6_825),
      projectedFils: 3 * AED(6_825),
      forecastFils: 12 * AED(6_825),
      percent: 59,
      forecastPercent: 79,
      level: 'ok',
      forecastLevel: 'ok',
    });
  });

  it('the total counts every category of the building, and every rule for the forecast', async () => {
    const total = lineOf((await staffBudgets('?year=2026')).body, b.noor, null)!;
    const actual = await postedIn2026(b.noor);
    expect(total.actualFils).toBe(actual);
    expect(total.actualToDateFils).toBe(actual);
    expect(total.projectedFils).toBe(
      sum(projectedFixedByCategory(await rulesOf(b.noor), 2026, TODAY)),
    );
    expect(total.forecastFils).toBe(total.actualFils + total.projectedFils);
    expect(total.level).toBe('ok');
  });

  it('a past year has nothing projected; a year with no budget is empty', async () => {
    expect((await staffBudgets('?year=2025')).body.buildings).toEqual([]);
    expect((await staffBudgets('?year=1999')).status).toBe(422);
  });

  it('the Today panel counts the line past 80 %', async () => {
    const t = await w.json<{ budgets: unknown }>('/api/staff/today', { token: viewer });
    expect(t.body.budgets).toEqual({ year: 2026, near: 1, over: 0 });
  });
});

describe('alerts at 80 % and 100 %, once each', () => {
  let liftsBudget: string;
  let overId: string;

  it('nothing is sent until an expense is posted', async () => {
    expect(await budgetPushes(oid.khalid)).toEqual([]);
    liftsBudget = lineOf(
      (await staffBudgets('?year=2026')).body,
      b.noor,
      cat('Lifts (repairs)'),
    )!.budgetId;
  });

  it('a posting tells the Al Noor owner the lift repairs line is past 80 %', async () => {
    await postExpense({ buildingId: b.noor, categoryId: cat('Plumbing'), amountFils: AED(100) });
    expect(await budgetPushes(oid.khalid)).toEqual([
      { key: `budget_threshold:${oid.khalid}:${liftsBudget}:2026-01-01`, entityId: liftsBudget },
    ]);
    // Al Khan's lines are all under 80 %: its owner hears nothing.
    expect(await budgetPushes(oid.mariam)).toEqual([]);
  });

  it('taking the line past its budget sends the 100 % alert, and only once', async () => {
    overId = await postExpense({
      buildingId: b.noor,
      categoryId: cat('Lifts (repairs)'),
      amountFils: AED(2_000),
    });
    const keys = (await budgetPushes(oid.khalid)).map((p) => p.key).sort();
    expect(keys).toEqual([
      `budget_threshold:${oid.khalid}:${liftsBudget}:${budgetAlertKeyDate(2026, 80)}`,
      `budget_threshold:${oid.khalid}:${liftsBudget}:${budgetAlertKeyDate(2026, 100)}`,
    ]);
    const line = lineOf((await staffBudgets('?year=2026')).body, b.noor, cat('Lifts (repairs)'))!;
    expect(line).toMatchObject({ actualFils: AED(15_020), percent: 100, level: 'over' });
    const today = await w.json<{ budgets: unknown }>('/api/staff/today', { token: viewer });
    expect(today.body.budgets).toEqual({ year: 2026, near: 0, over: 1 });

    await postExpense({
      buildingId: b.noor,
      categoryId: cat('Lifts (repairs)'),
      amountFils: AED(50),
    });
    expect(await budgetPushes(oid.khalid)).toHaveLength(2);
  });

  it('voiding back under the budget and posting again sends nothing new', async () => {
    const voided = await w.request(`/api/staff/expenses/${overId}/void`, {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ reason: 'Entered twice' }),
    });
    expect(voided.status).toBe(200);
    await w.flush();
    await postExpense({ buildingId: b.noor, categoryId: cat('Plumbing'), amountFils: AED(10) });
    expect(await budgetPushes(oid.khalid)).toHaveLength(2);
  });

  it('a budget set below what was already spent alerts at 100 % only, never at 80 % after', async () => {
    const [pest] = await w.db
      .select({ total: schema.expenses.totalFils })
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.buildingId, b.khan),
          eq(schema.expenses.categoryId, cat('Pest control')),
        ),
      );
    const created = await create({
      buildingId: b.khan,
      year: 2026,
      categoryId: cat('Pest control'),
      amountFils: Math.floor(pest!.total * 0.9),
    });
    expect(created.status).toBe(201);
    await w.flush();
    expect((await budgetPushes(oid.mariam)).map((p) => p.key)).toEqual([
      `budget_threshold:${oid.mariam}:${created.body.id}:2026-12-31`,
    ]);
    // Raised so the line reads 87 %: the owner already knows it was used up.
    const raised = await w.request(`/api/staff/budgets/${created.body.id}`, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ amountFils: Math.ceil(pest!.total / 0.87) }),
    });
    expect(raised.status).toBe(200);
    await w.flush();
    expect(await budgetPushes(oid.mariam)).toHaveLength(1);
  });

  it('owners are told only from what they can see', async () => {
    const plumbing = await create({
      buildingId: b.noor,
      year: 2026,
      categoryId: cat('Plumbing'),
      amountFils: AED(4_000),
    });
    expect(plumbing.status).toBe(201);
    await postExpense({
      buildingId: b.noor,
      categoryId: cat('Plumbing'),
      amountFils: AED(3_000),
      visibleToOwner: false,
    });
    const staffLine = lineOf((await staffBudgets('?year=2026')).body, b.noor, cat('Plumbing'))!;
    const ownerLine = lineOf(
      (await ownerBudgets('khalid', '?year=2026')).body,
      b.noor,
      cat('Plumbing'),
    )!;
    expect(staffLine.level).toBe('near');
    expect(ownerLine.level).toBe('ok');
    expect((await budgetPushes(oid.khalid)).filter((p) => p.entityId === plumbing.body.id)).toEqual(
      [],
    );
  });
});

describe('admin writes, everyone else reads', () => {
  let totalId: string;
  let maintId: string;

  it('editors and viewers read but cannot write', async () => {
    expect((await staffBudgets('?year=2026', editor)).status).toBe(200);
    const body = { buildingId: b.safa, year: 2027, amountFils: AED(300_000) };
    expect((await create(body, editor)).status).toBe(403);
    expect((await create(body, viewer)).status).toBe(403);
    // Owners never reach the staff side, staff never the owner side, nobody without a session.
    expect((await w.request('/api/staff/budgets', { token: tok.fatima })).status).toBe(403);
    expect((await w.request('/api/owner/budgets', { token: viewer })).status).toBe(403);
    expect((await w.request('/api/staff/budgets')).status).toBe(401);
    expect((await w.request('/api/owner/budgets')).status).toBe(401);
  });

  it('creates a total and a category line, one of each per building and year', async () => {
    const total = await create({ buildingId: b.safa, year: 2027, amountFils: AED(300_000) });
    expect(total.status).toBe(201);
    totalId = total.body.id;
    const maint = await create({
      buildingId: b.safa,
      year: 2027,
      categoryId: cat('Building staff'),
      amountFils: AED(120_000),
    });
    expect(maint.status).toBe(201);
    maintId = maint.body.id;
    const again = await create({ buildingId: b.safa, year: 2027, amountFils: AED(1_000) });
    expect(again.status).toBe(409);
    const againCat = await create({
      buildingId: b.safa,
      year: 2027,
      categoryId: cat('Building staff'),
      amountFils: AED(1_000),
    });
    expect(againCat.status).toBe(409);
    // Another year is another budget.
    expect((await create({ buildingId: b.safa, year: 2028, amountFils: AED(1) })).status).toBe(201);
    expect(
      (
        await create({
          buildingId: b.safa,
          year: 2027,
          categoryId: crypto.randomUUID(),
          amountFils: 1,
        })
      ).status,
    ).toBe(422);
    expect((await create({ buildingId: b.safa, year: 2027, amountFils: 0 })).status).toBe(422);
  });

  it('a future year: nothing posted, the whole year of fixed costs projected', async () => {
    const r = (await staffBudgets(`?year=2027&buildingId=${b.safa}`)).body;
    const lines = r.buildings[0]!.lines;
    expect(lines.map((l) => l.budgetId)).toEqual([maintId, totalId]);
    const projected = projectedFixedByCategory(await rulesOf(b.safa), 2027, TODAY);
    expect(lines[0]).toMatchObject({
      actualFils: 0,
      actualToDateFils: 0,
      budgetToDateFils: 0,
      projectedFils: projected.get(cat('Building staff')),
    });
    expect(lines[1]!.projectedFils).toBe(sum(projected));
  });

  it('one building is returned even before it has a budget', async () => {
    const r = (await staffBudgets(`?year=2027&buildingId=${b.nahda}`)).body;
    expect(r.buildings).toEqual([
      expect.objectContaining({ buildingId: b.nahda, nameEn: expect.any(String), lines: [] }),
    ]);
  });

  it('changes the amount and removes a line, each with an audit row', async () => {
    const denied = await w.request(`/api/staff/budgets/${totalId}`, {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ amountFils: AED(250_000) }),
    });
    expect(denied.status).toBe(403);
    const changed = await w.json<{ amountFils: number }>(`/api/staff/budgets/${totalId}`, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ amountFils: AED(250_000) }),
    });
    expect(changed.status).toBe(200);
    expect(changed.body.amountFils).toBe(AED(250_000));
    expect(
      (await w.request(`/api/staff/budgets/${maintId}`, { method: 'DELETE', token: editor }))
        .status,
    ).toBe(403);
    expect(
      (await w.request(`/api/staff/budgets/${maintId}`, { method: 'DELETE', token: admin })).status,
    ).toBe(200);
    expect(
      (await w.request(`/api/staff/budgets/${maintId}`, { method: 'DELETE', token: admin })).status,
    ).toBe(404);
    const audits = await w.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(
        and(
          like(schema.auditLog.action, 'budget.%'),
          inArray(schema.auditLog.entityId, [totalId, maintId]),
        ),
      );
    expect(audits.map((a) => a.action).sort()).toEqual([
      'budget.create',
      'budget.create',
      'budget.delete',
      'budget.update',
    ]);
  });
});

describe('owners see the budgets of their own buildings only', () => {
  it('each owner gets the buildings they hold a unit in, nothing else', async () => {
    const names = async (who: OwnerKey, q = '?year=2026') =>
      (await ownerBudgets(who, q)).body.buildings.map((x) => x.nameEn);
    expect(await names('khalid')).toEqual(['Al Noor Tower']);
    expect(await names('mariam')).toEqual(['Al Khan Residence']);
    expect(await names('fatima')).toEqual([]);
    expect(await names('fatima', '?year=2027')).toEqual(['Al Safa Building']);
    expect(await names('omar', '?year=2027')).toEqual(['Al Safa Building']);
    expect(await names('rashid', '?year=2027')).toEqual([]);
    expect((await ownerBudgets('khalid', '?year=abc')).status).toBe(422);
  });

  it('the building figures, not a share, without hidden expenses', async () => {
    const staff = lineOf((await staffBudgets('?year=2026')).body, b.noor, null)!;
    const owner = lineOf((await ownerBudgets('khalid', '?year=2026')).body, b.noor, null)!;
    // The alerts above posted an AED 3,000 plumbing bill hidden from owners.
    expect(staff.actualFils).toBe(await postedIn2026(b.noor));
    expect(owner.actualFils).toBe(await postedIn2026(b.noor, true));
    expect(staff.actualFils - owner.actualFils).toBe(AED(3_000));
    // The same budget line and amount on both sides: the building's, not the owner's share.
    expect(owner.budgetId).toBe(staff.budgetId);
    expect(owner.budgetFils).toBe(staff.budgetFils);
  });
});
