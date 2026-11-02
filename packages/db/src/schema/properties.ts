import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, instant, plainDate } from './_common.js';
import { unitStatus, unitType } from './enums.js';
import { owners } from './owners.js';
import { staffUsers } from './staff.js';

export const buildings = pgTable('buildings', {
  id: id(),
  nameAr: text().notNull(),
  nameEn: text().notNull(),
  /** Area / community, e.g. "Al Nahda" or "Business Bay". */
  area: text().notNull(),
  address: text().notNull().default(''),
  notes: text().notNull().default(''),
  /** Property record (v2): land department and municipality identifiers. */
  plotNo: text(),
  makaniNo: text(),
  titleDeedNo: text(),
  completionYear: integer(),
  floorsCount: integer(),
});

export const units = pgTable(
  'units',
  {
    id: id(),
    buildingId: uuid()
      .notNull()
      .references(() => buildings.id),
    unitNo: text().notNull(),
    type: unitType().notNull(),
    bedrooms: integer(),
    sizeSqft: integer(),
    active: boolean().notNull().default(true),
    /**
     * The status staff set by hand. `occupied` is never stored: it is derived from an active
     * contract when the unit is read, and wins over this value while the contract runs.
     */
    status: unitStatus().notNull().default('vacant_ready'),
    titleDeedNo: text(),
    plotNo: text(),
    makaniNo: text(),
    /** DEWA or SEWA account / premise number. */
    dewaPremiseNo: text(),
    municipalityNo: text(),
    handoverDate: plainDate(),
  },
  (t) => [
    uniqueIndex('units_building_unit_no_uq').on(t.buildingId, t.unitNo),
    index('units_building_idx').on(t.buildingId),
    /** Dashboard search by deed or Makani number (exact match). */
    index('units_title_deed_idx').on(t.titleDeedNo),
    index('units_makani_idx').on(t.makaniNo),
    check('units_status_manual', sql`${t.status} <> 'occupied'`),
  ],
);

/** Append-only history of the manual status changes of a unit. */
export const unitStatusEvents = pgTable(
  'unit_status_events',
  {
    id: id(),
    unitId: uuid()
      .notNull()
      .references(() => units.id),
    fromStatus: unitStatus(),
    toStatus: unitStatus().notNull(),
    reason: text().notNull().default(''),
    actorStaffId: uuid().references(() => staffUsers.id),
    at: instant().notNull().defaultNow(),
  },
  (t) => [index('unit_status_events_unit_idx').on(t.unitId, t.at.desc())],
);

/**
 * Who owns a unit and how much. Shares of the current owners (to_date is null) must sum to
 * exactly 10000 bp; enforced by the service inside the same transaction.
 */
export const unitOwnerships = pgTable(
  'unit_ownerships',
  {
    id: id(),
    unitId: uuid()
      .notNull()
      .references(() => units.id),
    ownerId: uuid()
      .notNull()
      .references(() => owners.id),
    shareBp: integer().notNull(),
    fromDate: plainDate().notNull(),
    toDate: plainDate(),
  },
  (t) => [
    index('unit_ownerships_owner_idx').on(t.ownerId),
    index('unit_ownerships_unit_idx').on(t.unitId),
    check('unit_ownerships_share_bp_range', sql`${t.shareBp} BETWEEN 1 AND 10000`),
    check('unit_ownerships_dates_order', sql`${t.toDate} IS NULL OR ${t.toDate} >= ${t.fromDate}`),
  ],
);

export const tenants = pgTable('tenants', {
  id: id(),
  name: text().notNull(),
  phone: text(),
  email: text(),
  company: text(),
  notes: text().notNull().default(''),
});
