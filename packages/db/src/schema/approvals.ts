import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, fils, id, instant, plainDate } from './_common.js';
import { repairApprovalStatus } from './enums.js';
import { expenses } from './expenses.js';
import { owners } from './owners.js';
import { staffUsers } from './staff.js';
import { workOrders } from './work-orders.js';

/**
 * Owner approval of a large repair: one row per owner per work order or per variable expense
 * draft. The job may not start (or the expense be posted) while a row is pending or rejected,
 * unless an admin overrides it with a reason. Every change is also an audit_log row.
 */
export const repairApprovals = pgTable(
  'repair_approvals',
  {
    id: id(),
    workOrderId: uuid().references(() => workOrders.id, { onDelete: 'cascade' }),
    /** A discarded draft takes its approvals with it; the audit log keeps the answers. */
    expenseId: uuid().references(() => expenses.id, { onDelete: 'cascade' }),
    ownerId: uuid()
      .notNull()
      .references(() => owners.id),
    /** The estimate or expense total the owner was asked about. */
    amountFils: fils().notNull(),
    /** The owner's part of it, from the shares on the day asked (the invoice date for an expense). */
    shareFils: fils().notNull(),
    status: repairApprovalStatus().notNull().default('pending'),
    note: text(),
    /** Business date (Dubai) the owner was asked; silent approval counts from here. */
    askedOn: plainDate().notNull(),
    answeredAt: instant(),
    overriddenAt: instant(),
    overriddenBy: uuid().references(() => staffUsers.id),
    overrideReason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('repair_approvals_work_order_owner_uq').on(t.workOrderId, t.ownerId),
    uniqueIndex('repair_approvals_expense_owner_uq').on(t.expenseId, t.ownerId),
    /** The owner's own list. */
    index('repair_approvals_owner_idx').on(t.ownerId, t.status),
    /** The daily job: pending answers by the day they were asked. */
    index('repair_approvals_pending_idx')
      .on(t.askedOn)
      .where(sql`${t.status} = 'pending'`),
    check(
      'repair_approvals_one_subject',
      sql`(${t.workOrderId} IS NULL) <> (${t.expenseId} IS NULL)`,
    ),
    check('repair_approvals_amount_positive', sql`${t.amountFils} > 0`),
    check('repair_approvals_share_non_negative', sql`${t.shareFils} >= 0`),
  ],
);
