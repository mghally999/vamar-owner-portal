import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, fils, id, instant, plainDate } from './_common.js';
import { attachmentEntityType, disputeStatus, disputeType } from './enums.js';
import { contracts } from './contracts.js';
import { tenants, units } from './properties.js';
import { staffUsers } from './staff.js';

export const disputes = pgTable(
  'disputes',
  {
    id: id(),
    /** Human reference shown to owners and staff, e.g. "D-2026-0007". Assigned by the service. */
    caseNo: text().notNull().unique(),
    unitId: uuid()
      .notNull()
      .references(() => units.id),
    contractId: uuid().references(() => contracts.id),
    tenantId: uuid().references(() => tenants.id),
    type: disputeType().notNull(),
    amountClaimedFils: fils(),
    status: disputeStatus().notNull().default('open'),
    nextHearingDate: plainDate(),
    openedAt: instant().notNull().defaultNow(),
    closedAt: instant(),
    /** Internal notes, never shown to owners. */
    notes: text().notNull().default(''),
    createdBy: uuid().references(() => staffUsers.id),
  },
  (t) => [
    index('disputes_unit_status_idx').on(t.unitId, t.status),
    /** Dispute lists: newest first. */
    index('disputes_opened_idx').on(t.openedAt.desc(), t.id.desc()),
    check(
      'disputes_amount_non_negative',
      sql`${t.amountClaimedFils} IS NULL OR ${t.amountClaimedFils} >= 0`,
    ),
  ],
);

export const disputeUpdates = pgTable(
  'dispute_updates',
  {
    id: id(),
    disputeId: uuid()
      .notNull()
      .references(() => disputes.id),
    note: text().notNull(),
    /** Only rows with true are returned to the owner app. */
    visibleToOwner: boolean().notNull().default(false),
    actorStaffId: uuid().references(() => staffUsers.id),
    at: instant().notNull().defaultNow(),
  },
  (t) => [index('dispute_updates_dispute_idx').on(t.disputeId, t.at)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    entityType: attachmentEntityType().notNull(),
    entityId: uuid().notNull(),
    /** Private R2 object key; served only through the Worker after an auth check. */
    r2Key: text().notNull().unique(),
    mime: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    fileName: text().notNull().default(''),
    uploadedBy: uuid().references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('attachments_entity_idx').on(t.entityType, t.entityId),
    check('attachments_size_limit', sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10485760`),
  ],
);

/** Dispute case numbers: one counter per year, "D-YYYY-NNNN". */
export const disputeCounters = pgTable('dispute_counters', {
  year: integer().primaryKey(),
  last: integer().notNull().default(0),
});
