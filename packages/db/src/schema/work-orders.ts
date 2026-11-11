import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, fils, id, instant, plainDate } from './_common.js';
import { workOrderPriority, workOrderStatus } from './enums.js';
import { expenses, vendors } from './expenses.js';
import { buildings, units } from './properties.js';
import { staffUsers } from './staff.js';

/** Maintenance and breakdowns: what is broken, what was done, and (through the expense) what it cost. */
export const workOrders = pgTable(
  'work_orders',
  {
    id: id(),
    buildingId: uuid()
      .notNull()
      .references(() => buildings.id),
    unitId: uuid().references(() => units.id),
    titleAr: text().notNull(),
    titleEn: text().notNull(),
    description: text().notNull().default(''),
    priority: workOrderPriority().notNull().default('normal'),
    status: workOrderStatus().notNull().default('open'),
    reportedOn: plainDate().notNull(),
    scheduledFor: plainDate(),
    completedAt: instant(),
    vendorId: uuid().references(() => vendors.id),
    /** The invoice that paid for the job, once posted. */
    expenseId: uuid().references(() => expenses.id),
    visibleToOwner: boolean().notNull().default(true),
    /** Expected cost; at or above the approval threshold the owners are asked before work starts. */
    estimateFils: fils(),
    createdBy: uuid().references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    /** Owner unit screen and the unit timeline. */
    index('work_orders_unit_status_idx').on(t.unitId, t.status),
    /** Staff board per building. */
    index('work_orders_building_status_idx').on(t.buildingId, t.status),
    /** The calendar. */
    index('work_orders_scheduled_idx')
      .on(t.scheduledFor)
      .where(sql`${t.scheduledFor} IS NOT NULL`),
    /** Staff list: newest first. */
    index('work_orders_reported_idx').on(t.reportedOn.desc(), t.id.desc()),
    check('work_orders_estimate_positive', sql`${t.estimateFils} IS NULL OR ${t.estimateFils} > 0`),
  ],
);
