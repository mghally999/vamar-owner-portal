import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, instant, plainDate } from './_common.js';
import { calendarEventType } from './enums.js';
import { owners } from './owners.js';
import { buildings, units } from './properties.js';
import { staffUsers } from './staff.js';

/** Manual events staff put on the calendar (inspections, meetings, handovers, reminders). */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: id(),
    titleAr: text().notNull(),
    titleEn: text().notNull(),
    startsAt: instant().notNull(),
    endsAt: instant().notNull(),
    allDay: boolean().notNull().default(false),
    type: calendarEventType().notNull().default('other'),
    buildingId: uuid().references(() => buildings.id),
    unitId: uuid().references(() => units.id),
    ownerId: uuid().references(() => owners.id),
    visibleToOwner: boolean().notNull().default(false),
    notes: text().notNull().default(''),
    createdBy: uuid().references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    /** Every calendar range query. */
    index('calendar_events_starts_idx').on(t.startsAt),
    index('calendar_events_unit_idx')
      .on(t.unitId, t.startsAt)
      .where(sql`${t.unitId} IS NOT NULL`),
    index('calendar_events_owner_idx')
      .on(t.ownerId, t.startsAt)
      .where(sql`${t.ownerId} IS NOT NULL`),
    check('calendar_events_order', sql`${t.endsAt} >= ${t.startsAt}`),
  ],
);

/** Public holidays; religious ones move with the moon sighting, so admins edit them. */
export const holidays = pgTable('holidays', {
  date: plainDate().primaryKey(),
  nameAr: text().notNull(),
  nameEn: text().notNull(),
  tentative: boolean().notNull().default(false),
  updatedBy: uuid().references(() => staffUsers.id),
  updatedAt: instant().notNull().defaultNow(),
});

/** One row per setting (packages/shared settings.ts has the keys and defaults). */
export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid().references(() => staffUsers.id),
  updatedAt: instant().notNull().defaultNow(),
});
