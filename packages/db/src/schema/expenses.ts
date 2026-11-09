import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, fils, id, instant, plainDate } from './_common.js';
import { disputes } from './disputes.js';
import {
  allocationMethod,
  expenseKind,
  expenseScope,
  expenseStatus,
  paymentMethod,
  recurringFrequency,
} from './enums.js';
import { owners } from './owners.js';
import { buildings, units } from './properties.js';
import { staffUsers } from './staff.js';

/** Fixed (salaries, DEWA, insurance...) and variable (repairs, legal fees...) cost categories. */
export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: id(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    kind: expenseKind().notNull(),
    parentId: uuid().references((): AnyPgColumn => expenseCategories.id),
    sort: integer().notNull().default(0),
    active: boolean().notNull().default(true),
  },
  (t) => [index('expense_categories_kind_sort_idx').on(t.kind, t.sort)],
);

export const vendors = pgTable(
  'vendors',
  {
    id: id(),
    name: text().notNull(),
    phone: text(),
    email: text(),
    /** UAE VAT registration number, 15 digits; null for an unregistered supplier. */
    trn: text(),
    notes: text().notNull().default(''),
    active: boolean().notNull().default(true),
  },
  (t) => [index('vendors_name_idx').on(t.name)],
);

/** Fixed costs that recur; the daily cron turns each due date into a draft expense. */
export const recurringExpenseRules = pgTable(
  'recurring_expense_rules',
  {
    id: id(),
    scope: expenseScope().notNull(),
    buildingId: uuid()
      .notNull()
      .references(() => buildings.id),
    unitId: uuid().references(() => units.id),
    categoryId: uuid()
      .notNull()
      .references(() => expenseCategories.id),
    vendorId: uuid().references(() => vendors.id),
    reasonAr: text().notNull(),
    reasonEn: text().notNull(),
    amountFils: fils().notNull(),
    vatFils: fils().notNull().default(0),
    frequency: recurringFrequency().notNull(),
    dayOfMonth: integer().notNull(),
    startDate: plainDate().notNull(),
    endDate: plainDate(),
    allocationMethod: allocationMethod().notNull(),
    visibleToOwner: boolean().notNull().default(true),
    active: boolean().notNull().default(true),
    createdBy: uuid().references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    /** The cron and the projections only look at active rules. */
    index('recurring_rules_active_idx').on(t.active, t.startDate),
    index('recurring_rules_building_idx').on(t.buildingId),
    check('recurring_rules_day_range', sql`${t.dayOfMonth} BETWEEN 1 AND 31`),
    check('recurring_rules_amount_positive', sql`${t.amountFils} > 0`),
    check('recurring_rules_vat_non_negative', sql`${t.vatFils} >= 0`),
    check('recurring_rules_scope_unit', sql`${t.scope} = 'building' OR ${t.unitId} IS NOT NULL`),
  ],
);

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    scope: expenseScope().notNull(),
    buildingId: uuid()
      .notNull()
      .references(() => buildings.id),
    unitId: uuid().references(() => units.id),
    categoryId: uuid()
      .notNull()
      .references(() => expenseCategories.id),
    /** Snapshot of the category's kind when the expense was created. */
    kind: expenseKind().notNull(),
    vendorId: uuid().references(() => vendors.id),
    /** The "why", in both languages: shown to owners on every row. */
    reasonAr: text().notNull(),
    reasonEn: text().notNull(),
    invoiceNo: text(),
    invoiceDate: plainDate().notNull(),
    /** The period a fixed expense covers (the month of a salary, the year of an insurance). */
    coversFrom: plainDate(),
    coversTo: plainDate(),
    amountFils: fils().notNull(),
    vatFils: fils().notNull().default(0),
    totalFils: fils().notNull(),
    paidOn: plainDate(),
    paymentMethod: paymentMethod(),
    status: expenseStatus().notNull().default('draft'),
    voidReason: text(),
    allocationMethod: allocationMethod().notNull(),
    visibleToOwner: boolean().notNull().default(true),
    recurringRuleId: uuid().references(() => recurringExpenseRules.id),
    disputeId: uuid().references(() => disputes.id),
    /** A corrected copy points at the voided expense it replaces; history is never rewritten. */
    correctsExpenseId: uuid().references((): AnyPgColumn => expenses.id),
    createdBy: uuid().references(() => staffUsers.id),
    createdAt: createdAt(),
    postedAt: instant(),
    postedBy: uuid().references(() => staffUsers.id),
    voidedAt: instant(),
    voidedBy: uuid().references(() => staffUsers.id),
  },
  (t) => [
    /** Building P&L, expenses by category and the staff list all cut by building and date. */
    index('expenses_building_date_idx').on(t.buildingId, t.invoiceDate),
    index('expenses_unit_date_idx')
      .on(t.unitId, t.invoiceDate)
      .where(sql`${t.unitId} IS NOT NULL`),
    /** Staff list: newest invoice first within a status (the drafts queue, posted lists). */
    index('expenses_status_date_idx').on(t.status, t.invoiceDate.desc(), t.id.desc()),
    index('expenses_category_date_idx').on(t.categoryId, t.invoiceDate),
    /** Duplicate-invoice warning: same vendor, same invoice number. */
    index('expenses_vendor_invoice_idx')
      .on(t.vendorId, t.invoiceNo)
      .where(sql`${t.invoiceNo} IS NOT NULL`),
    /** The cron checks whether a rule already produced the expense of a due date. */
    index('expenses_rule_date_idx')
      .on(t.recurringRuleId, t.invoiceDate)
      .where(sql`${t.recurringRuleId} IS NOT NULL`),
    index('expenses_dispute_idx')
      .on(t.disputeId)
      .where(sql`${t.disputeId} IS NOT NULL`),
    /**
     * Owner totals join their allocations to the posted, owner-visible expenses for the kind: this
     * small partial index answers that join by itself (index-only), without reading the table.
     */
    index('expenses_posted_visible_kind_idx')
      .on(t.id, t.kind)
      .where(sql`${t.status} = 'posted' AND ${t.visibleToOwner}`),
    check('expenses_amount_positive', sql`${t.amountFils} > 0`),
    check('expenses_vat_non_negative', sql`${t.vatFils} >= 0`),
    check('expenses_total_is_sum', sql`${t.totalFils} = ${t.amountFils} + ${t.vatFils}`),
    check('expenses_scope_unit', sql`${t.scope} = 'building' OR ${t.unitId} IS NOT NULL`),
    check(
      'expenses_covers_order',
      sql`${t.coversFrom} IS NULL OR ${t.coversTo} IS NULL OR ${t.coversTo} >= ${t.coversFrom}`,
    ),
  ],
);

/**
 * The owner's share of a posted expense. Written once when the expense is posted, from the
 * ownership valid on the invoice date, with the largest-remainder method; never updated.
 */
export const expenseAllocations = pgTable(
  'expense_allocations',
  {
    id: id(),
    expenseId: uuid()
      .notNull()
      .references(() => expenses.id),
    unitId: uuid()
      .notNull()
      .references(() => units.id),
    ownerId: uuid()
      .notNull()
      .references(() => owners.id),
    amountFils: fils().notNull(),
    /** The expense's invoice date, copied so owner queries need no join. */
    onDate: plainDate().notNull(),
  },
  (t) => [
    /** Every owner total, bucket and list starts here. */
    index('expense_allocations_owner_date_idx').on(t.ownerId, t.onDate),
    /** The owner summary and lists read the expense and amount too: index-only for an owner. */
    index('expense_allocations_owner_date_cover_idx').on(
      t.ownerId,
      t.onDate,
      t.expenseId,
      t.amountFils,
    ),
    index('expense_allocations_expense_idx').on(t.expenseId),
    /** The unit history timeline. */
    index('expense_allocations_unit_date_idx').on(t.unitId, t.onDate),
    check('expense_allocations_amount_non_negative', sql`${t.amountFils} >= 0`),
  ],
);
