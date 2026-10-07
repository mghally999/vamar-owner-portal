import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, fils, id, instant, plainDate } from './_common.js';
import { chequeStatus, contractStatus } from './enums.js';
import { tenants, units } from './properties.js';
import { staffUsers } from './staff.js';

export const contracts = pgTable(
  'contracts',
  {
    id: id(),
    unitId: uuid()
      .notNull()
      .references(() => units.id),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    startDate: plainDate().notNull(),
    endDate: plainDate().notNull(),
    annualRentFils: fils().notNull(),
    chequeCount: integer().notNull(),
    status: contractStatus().notNull().default('draft'),
    /** Set on a renewal; the old contract becomes `renewed` when this one is activated. */
    previousContractId: uuid().references((): AnyPgColumn => contracts.id),
    ejariNo: text(),
    notes: text().notNull().default(''),
    createdBy: uuid().references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('contracts_unit_status_idx').on(t.unitId, t.status),
    index('contracts_active_end_date_idx')
      .on(t.endDate)
      .where(sql`${t.status} = 'active'`),
    index('contracts_tenant_idx').on(t.tenantId),
    check('contracts_dates_order', sql`${t.endDate} >= ${t.startDate}`),
    check('contracts_cheque_count_range', sql`${t.chequeCount} BETWEEN 1 AND 12`),
    check('contracts_annual_rent_positive', sql`${t.annualRentFils} > 0`),
  ],
);

export const cheques = pgTable(
  'cheques',
  {
    id: id(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id),
    /** 1-based position in the contract schedule. */
    seq: integer().notNull(),
    dueDate: plainDate().notNull(),
    /** Null while the contract is a draft and staff have not typed the amount yet. */
    amountFils: fils(),
    chequeNo: text(),
    bankName: text(),
    status: chequeStatus().notNull().default('upcoming'),
    statusChangedAt: instant().notNull().defaultNow(),
    depositedAt: instant(),
    clearedAt: instant(),
    bouncedAt: instant(),
    bounceReason: text(),
    /** For a replacement cheque: the bounced cheque it replaces. */
    replacesChequeId: uuid().references((): AnyPgColumn => cheques.id),
    /** R2 object key of the cheque image, if uploaded. */
    imageKey: text(),
  },
  (t) => [
    uniqueIndex('cheques_contract_seq_uq').on(t.contractId, t.seq),
    index('cheques_due_date_idx').on(t.dueDate),
    index('cheques_contract_idx').on(t.contractId),
    index('cheques_pending_due_date_idx')
      .on(t.dueDate)
      .where(sql`${t.status} IN ('upcoming', 'deposited')`),
    check('cheques_amount_positive', sql`${t.amountFils} IS NULL OR ${t.amountFils} > 0`),
    check('cheques_seq_range', sql`${t.seq} BETWEEN 1 AND 12`),
  ],
);

/** Append-only timeline of status changes; powers the cheque detail timeline in the app. */
export const chequeEvents = pgTable(
  'cheque_events',
  {
    id: id(),
    chequeId: uuid()
      .notNull()
      .references(() => cheques.id),
    fromStatus: chequeStatus(),
    toStatus: chequeStatus().notNull(),
    note: text().notNull().default(''),
    actorStaffId: uuid().references(() => staffUsers.id),
    at: instant().notNull().defaultNow(),
  },
  (t) => [index('cheque_events_cheque_idx').on(t.chequeId, t.at)],
);
