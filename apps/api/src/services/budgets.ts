/**
 * Building budgets (v3): the admin's yearly amounts per building, per category and in total, and
 * the figures behind them: what was posted in the year (the building's full totals, not an
 * owner's share), what is posted up to today, and the fixed costs the recurring rules will still
 * bring. Staff figures count every posted expense; owner figures count only what owners can see,
 * so a hidden internal cost never shows through a percentage. The maths lives in
 * @vamar/shared (budgets.ts); this file only reads the rows.
 */
import { and, asc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  budgetLines,
  budgetYearPeriod,
  projectedFixedByCategory,
  type BudgetLine,
  type CreateBudgetInput,
  type PlainDate,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import { conflict, notFound, validation } from '../errors.js';
import { audit, type AuditActor } from './audit.js';

const { budgets, buildings, expenseCategories, expenses, recurringExpenseRules, units } = schema;
const { unitOwnerships } = schema;

export interface BudgetLineOut extends BudgetLine {
  /** The category's names; null on the total line. */
  nameAr: string | null;
  nameEn: string | null;
}

export interface BuildingBudget {
  buildingId: string;
  nameAr: string;
  nameEn: string;
  lines: BudgetLineOut[];
}

export interface BudgetReport {
  year: number;
  today: PlainDate;
  buildings: BuildingBudget[];
}

interface ReportOptions {
  year: number;
  today: PlainDate;
  /** Only these buildings; undefined: every building with a budget in the year. */
  buildingIds?: readonly string[] | undefined;
  /** Owners: only expenses and rules marked visible to them. */
  ownerVisibleOnly: boolean;
  /** Buildings to return even without a budget (the staff page of one building). */
  keepEmpty?: boolean;
}

/** Budget against actual and forecast, per building, for one year. */
export async function budgetReport(db: Dbx, o: ReportOptions): Promise<BudgetReport> {
  const period = budgetYearPeriod(o.year);
  if (o.buildingIds?.length === 0) return { year: o.year, today: o.today, buildings: [] };
  const rows = await db
    .select({
      id: budgets.id,
      buildingId: budgets.buildingId,
      categoryId: budgets.categoryId,
      amountFils: budgets.amountFils,
      nameAr: expenseCategories.nameAr,
      nameEn: expenseCategories.nameEn,
    })
    .from(budgets)
    .leftJoin(expenseCategories, eq(expenseCategories.id, budgets.categoryId))
    .where(
      and(
        eq(budgets.year, o.year),
        o.buildingIds ? inArray(budgets.buildingId, [...o.buildingIds]) : undefined,
      ),
    )
    .orderBy(asc(expenseCategories.sort), asc(expenseCategories.nameEn));
  const buildingIds = o.keepEmpty
    ? [...(o.buildingIds ?? [])]
    : [...new Set(rows.map((r) => r.buildingId))];
  if (buildingIds.length === 0) return { year: o.year, today: o.today, buildings: [] };

  const visible = o.ownerVisibleOnly ? eq(expenses.visibleToOwner, true) : undefined;
  const [names, actuals, rules] = await Promise.all([
    db
      .select({ id: buildings.id, nameAr: buildings.nameAr, nameEn: buildings.nameEn })
      .from(buildings)
      .where(inArray(buildings.id, buildingIds))
      .orderBy(asc(buildings.nameEn)),
    db
      .select({
        buildingId: expenses.buildingId,
        categoryId: expenses.categoryId,
        yearFils: sql<string>`sum(${expenses.totalFils})`,
        toDateFils: sql<string>`coalesce(sum(${expenses.totalFils}) filter (where ${expenses.invoiceDate} <= ${o.today}), 0)`,
      })
      .from(expenses)
      .where(
        and(
          inArray(expenses.buildingId, buildingIds),
          eq(expenses.status, 'posted'),
          sql`${expenses.invoiceDate} between ${period.from} and ${period.to}`,
          visible,
        ),
      )
      .groupBy(expenses.buildingId, expenses.categoryId),
    db
      .select()
      .from(recurringExpenseRules)
      .where(
        and(
          inArray(recurringExpenseRules.buildingId, buildingIds),
          eq(recurringExpenseRules.active, true),
          lte(recurringExpenseRules.startDate, period.to),
          o.ownerVisibleOnly ? eq(recurringExpenseRules.visibleToOwner, true) : undefined,
        ),
      ),
  ]);
  // Due dates after today that already have an expense (a draft made early, or an early
  // posting) are counted once, as the expense.
  const recorded =
    rules.length === 0
      ? []
      : await db
          .select({ ruleId: expenses.recurringRuleId, invoiceDate: expenses.invoiceDate })
          .from(expenses)
          .where(
            and(
              inArray(
                expenses.recurringRuleId,
                rules.map((r) => r.id),
              ),
              gt(expenses.invoiceDate, o.today),
              lte(expenses.invoiceDate, period.to),
              ne(expenses.status, 'void'),
            ),
          );
  const recordedKeys = new Set(recorded.map((r) => `${r.ruleId ?? ''}|${r.invoiceDate}`));

  return {
    year: o.year,
    today: o.today,
    buildings: names.map((b) => {
      const mine = rows.filter((r) => r.buildingId === b.id);
      const projected = projectedFixedByCategory(
        rules
          .filter((r) => r.buildingId === b.id)
          .map((r) => ({
            id: r.id,
            categoryId: r.categoryId,
            active: r.active,
            amountFils: r.amountFils,
            vatFils: r.vatFils,
            frequency: r.frequency,
            dayOfMonth: r.dayOfMonth,
            startDate: r.startDate as PlainDate,
            endDate: r.endDate as PlainDate | null,
          })),
        o.year,
        o.today,
        recordedKeys,
      );
      const lines = budgetLines(
        mine,
        actuals
          .filter((a) => a.buildingId === b.id)
          .map((a) => ({
            categoryId: a.categoryId,
            yearFils: Number(a.yearFils),
            toDateFils: Number(a.toDateFils),
          })),
        projected,
        o.year,
        o.today,
      );
      return {
        buildingId: b.id,
        nameAr: b.nameAr,
        nameEn: b.nameEn,
        lines: lines.map((l) => {
          const row = mine.find((r) => r.id === l.budgetId);
          return { ...l, nameAr: row?.nameAr ?? null, nameEn: row?.nameEn ?? null };
        }),
      };
    }),
  };
}

/** The buildings an owner holds a unit in today: the same scope as the rest of the owner API. */
export async function ownerBuildingIds(db: Dbx, ownerId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ buildingId: units.buildingId })
    .from(unitOwnerships)
    .innerJoin(units, eq(units.id, unitOwnerships.unitId))
    .where(and(eq(unitOwnerships.ownerId, ownerId), isNull(unitOwnerships.toDate)));
  return rows.map((r) => r.buildingId);
}

// Admin writes ----------------------------------------------------------------------------------

export async function createBudget(db: Dbx, actor: AuditActor, input: CreateBudgetInput) {
  const building = await db.query.buildings.findFirst({
    where: eq(buildings.id, input.buildingId),
    columns: { id: true },
  });
  if (!building) throw validation('Unknown building');
  if (input.categoryId) {
    const category = await db.query.expenseCategories.findFirst({
      where: eq(expenseCategories.id, input.categoryId),
      columns: { id: true },
    });
    if (!category) throw validation('Unknown expense category');
  }
  const existing = await db.query.budgets.findFirst({
    where: and(
      eq(budgets.buildingId, input.buildingId),
      eq(budgets.year, input.year),
      input.categoryId ? eq(budgets.categoryId, input.categoryId) : isNull(budgets.categoryId),
    ),
    columns: { id: true },
  });
  if (existing)
    throw conflict('This building already has that budget for the year; change it instead');
  const [row] = await db
    .insert(budgets)
    .values({ ...input, createdBy: actor.type === 'staff' ? actor.id : null })
    .returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'budget.create',
    entityType: 'budget',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateBudget(db: Dbx, actor: AuditActor, id: string, amountFils: number) {
  const before = await db.query.budgets.findFirst({ where: eq(budgets.id, id) });
  if (!before) throw notFound('Budget');
  const [row] = await db
    .update(budgets)
    .set({ amountFils, updatedAt: new Date() })
    .where(eq(budgets.id, id))
    .returning();
  await audit(db, actor, {
    action: 'budget.update',
    entityType: 'budget',
    entityId: id,
    before,
    after: row,
  });
  return row;
}

export async function deleteBudget(db: Dbx, actor: AuditActor, id: string) {
  const before = await db.query.budgets.findFirst({ where: eq(budgets.id, id) });
  if (!before) throw notFound('Budget');
  await db.delete(budgets).where(eq(budgets.id, id));
  await audit(db, actor, { action: 'budget.delete', entityType: 'budget', entityId: id, before });
  return { ok: true as const };
}
