import { sql } from 'drizzle-orm';
import { check, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { MAX_BUDGET_YEAR, MIN_BUDGET_YEAR } from '@vamar/shared';
import { createdAt, fils, id, instant } from './_common.js';
import { expenseCategories } from './expenses.js';
import { buildings } from './properties.js';
import { staffUsers } from './staff.js';

/**
 * A building's budget for one calendar year: one row per expense category the admin budgets,
 * and at most one row without a category for the building's total. Actuals are never stored
 * here; they are summed from the posted expenses whenever a screen asks.
 */
export const budgets = pgTable(
  'budgets',
  {
    id: id(),
    buildingId: uuid()
      .notNull()
      .references(() => buildings.id),
    year: integer().notNull(),
    /** null: the building's total for the year. */
    categoryId: uuid().references(() => expenseCategories.id),
    amountFils: fils().notNull(),
    createdBy: uuid().references(() => staffUsers.id),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    // Postgres treats nulls as distinct in a unique index, so the total row (no category) gets
    // its own partial index; the category rows are unique on the three columns.
    uniqueIndex('budgets_building_year_category_uq')
      .on(t.buildingId, t.year, t.categoryId)
      .where(sql`${t.categoryId} IS NOT NULL`),
    uniqueIndex('budgets_building_year_total_uq')
      .on(t.buildingId, t.year)
      .where(sql`${t.categoryId} IS NULL`),
    check('budgets_amount_positive', sql`${t.amountFils} > 0`),
    check(
      'budgets_year_range',
      sql`${t.year} BETWEEN ${sql.raw(String(MIN_BUDGET_YEAR))} AND ${sql.raw(String(MAX_BUDGET_YEAR))}`,
    ),
  ],
);
