/**
 * The calendar: everything with a date, assembled for a range. Cheques due, contract ends and
 * renewals, hearings, scheduled work orders, manual events and holidays. Staff see all of it;
 * owners see their own units' items, events marked visible to them, and the holidays.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type {
  CalendarItem,
  CalendarItemKind,
  CreateCalendarEventInput,
  HolidayInput,
  PlainDate,
} from '@vamar/shared';
import { orSql, type Dbx } from '../db.js';
import { notFound } from '../errors.js';
import type { Patch } from '../util/types.js';
import { audit, type AuditActor } from './audit.js';
import { ownerUnitsSubquery } from './owner-scope.js';
import { workOrderInOwnerScope } from './work-orders.js';

const {
  cheques,
  contracts,
  units,
  buildings,
  tenants,
  disputes,
  workOrders,
  calendarEvents,
  holidays,
  unitOwnerships,
  disputeCheques,
} = schema;

export interface CalendarRange {
  from: PlainDate;
  to: PlainDate;
  buildingId?: string | undefined;
  unitId?: string | undefined;
  ownerId?: string | undefined;
  kinds?: CalendarItemKind[] | undefined;
}

/** Asia/Dubai calendar date of an instant, for manual events. */
function dubaiDate(at: Date): PlainDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at) as PlainDate;
}

function dubaiTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

interface Scope {
  /** null = staff (everything); otherwise the owner's id. */
  ownerId: string | null;
}

function wants(range: CalendarRange, kind: CalendarItemKind): boolean {
  return range.kinds === undefined || range.kinds.includes(kind);
}

export async function calendarItems(
  db: Dbx,
  range: CalendarRange,
  scope: Scope,
): Promise<CalendarItem[]> {
  const items: CalendarItem[] = [];
  const unitFilter = (col: typeof contracts.unitId | typeof disputes.unitId): SQL[] => {
    const out: SQL[] = [];
    if (range.unitId) out.push(eq(col, range.unitId));
    if (scope.ownerId) out.push(inArray(col, ownerUnitsSubquery(db, scope.ownerId)));
    else if (range.ownerId) out.push(inArray(col, ownerUnitsSubquery(db, range.ownerId)));
    return out;
  };
  const buildingFilter = (): SQL[] =>
    range.buildingId ? [eq(units.buildingId, range.buildingId)] : [];

  const tasks: Promise<void>[] = [];

  if (wants(range, 'cheque_due')) {
    tasks.push(
      db
        .select({
          id: cheques.id,
          dueDate: cheques.dueDate,
          amountFils: cheques.amountFils,
          status: cheques.status,
          chequeNo: cheques.chequeNo,
          unitId: contracts.unitId,
          buildingId: units.buildingId,
          unitNo: units.unitNo,
          bAr: buildings.nameAr,
          bEn: buildings.nameEn,
          tenant: tenants.name,
          // The owner's share valid on the cheque's due date (as in the summary); null when
          // the owner did not hold the unit on that day.
          shareBp: scope.ownerId
            ? sql<
                number | null
              >`(select uo.share_bp from ${unitOwnerships} uo where uo.unit_id = ${contracts.unitId} and uo.owner_id = ${scope.ownerId} and uo.from_date <= ${cheques.dueDate} and (uo.to_date is null or uo.to_date > ${cheques.dueDate}) limit 1)`
            : sql<number | null>`10000`,
        })
        .from(cheques)
        .innerJoin(contracts, eq(contracts.id, cheques.contractId))
        .innerJoin(units, eq(units.id, contracts.unitId))
        .innerJoin(buildings, eq(buildings.id, units.buildingId))
        .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
        .where(
          and(
            gte(cheques.dueDate, range.from),
            lte(cheques.dueDate, range.to),
            sql`${contracts.status} <> 'draft'`,
            sql`${cheques.status} not in ('replaced', 'cancelled')`,
            ...unitFilter(contracts.unitId),
            ...buildingFilter(),
          ),
        )
        .then((rows) => {
          for (const r of rows) {
            // A cheque from before the owner held the unit is not theirs to see.
            if (scope.ownerId && (r.shareBp === null || r.shareBp === 0)) continue;
            const gross = r.amountFils ?? 0;
            const share = r.shareBp ? Math.floor((gross * r.shareBp) / 10_000) : gross;
            items.push({
              kind: 'cheque_due',
              id: `cheque:${r.id}`,
              date: r.dueDate as PlainDate,
              endDate: r.dueDate as PlainDate,
              titleAr: `شيك ${r.chequeNo ?? ''} · ${r.bAr} ${r.unitNo}`.trim(),
              titleEn: `Cheque ${r.chequeNo ?? ''} · ${r.bEn} ${r.unitNo}`.trim(),
              entityType: 'cheque',
              entityId: r.id,
              amountFils: r.amountFils === null ? null : share,
              status: r.status,
              unitId: r.unitId,
              buildingId: r.buildingId,
              allDay: true,
            });
          }
        }),
    );
  }

  if (wants(range, 'contract_end') || wants(range, 'contract_renewal')) {
    tasks.push(
      db
        .select({
          id: contracts.id,
          startDate: contracts.startDate,
          endDate: contracts.endDate,
          status: contracts.status,
          previousContractId: contracts.previousContractId,
          unitId: contracts.unitId,
          buildingId: units.buildingId,
          unitNo: units.unitNo,
          bAr: buildings.nameAr,
          bEn: buildings.nameEn,
          tenant: tenants.name,
        })
        .from(contracts)
        .innerJoin(units, eq(units.id, contracts.unitId))
        .innerJoin(buildings, eq(buildings.id, units.buildingId))
        .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
        .where(
          and(
            or(
              and(
                gte(contracts.endDate, range.from),
                lte(contracts.endDate, range.to),
                sql`${contracts.status} in ('active', 'expired', 'terminated')`,
              ),
              and(
                gte(contracts.startDate, range.from),
                lte(contracts.startDate, range.to),
                isNotNull(contracts.previousContractId),
              ),
            ),
            ...unitFilter(contracts.unitId),
            ...buildingFilter(),
          ),
        )
        .then((rows) => {
          for (const r of rows) {
            const place = (lang: 'ar' | 'en') => `${lang === 'ar' ? r.bAr : r.bEn} ${r.unitNo}`;
            if (
              wants(range, 'contract_end') &&
              r.endDate >= range.from &&
              r.endDate <= range.to &&
              r.status !== 'draft' &&
              r.status !== 'renewed'
            ) {
              items.push({
                kind: 'contract_end',
                id: `contract-end:${r.id}`,
                date: r.endDate as PlainDate,
                endDate: r.endDate as PlainDate,
                titleAr: `نهاية عقد ${r.tenant} · ${place('ar')}`,
                titleEn: `Contract ends: ${r.tenant} · ${place('en')}`,
                entityType: 'contract',
                entityId: r.id,
                status: r.status,
                unitId: r.unitId,
                buildingId: r.buildingId,
                allDay: true,
              });
            }
            if (
              wants(range, 'contract_renewal') &&
              r.previousContractId &&
              r.startDate >= range.from &&
              r.startDate <= range.to
            ) {
              items.push({
                kind: 'contract_renewal',
                id: `contract-renewal:${r.id}`,
                date: r.startDate as PlainDate,
                endDate: r.startDate as PlainDate,
                titleAr: `تجديد عقد ${r.tenant} · ${place('ar')}`,
                titleEn: `Renewal: ${r.tenant} · ${place('en')}`,
                entityType: 'contract',
                entityId: r.id,
                status: r.status,
                unitId: r.unitId,
                buildingId: r.buildingId,
                allDay: true,
              });
            }
          }
        }),
    );
  }

  if (wants(range, 'hearing')) {
    tasks.push(
      db
        .select({
          id: disputes.id,
          caseNo: disputes.caseNo,
          hearing: disputes.nextHearingDate,
          status: disputes.status,
          unitId: disputes.unitId,
          buildingId: units.buildingId,
          unitNo: units.unitNo,
          bAr: buildings.nameAr,
          bEn: buildings.nameEn,
          chequeNos: sql<
            string[]
          >`coalesce((select array_agg(q.cheque_no order by q.due_date) from ${disputeCheques} dc join ${cheques} q on q.id = dc.cheque_id where dc.dispute_id = ${disputes.id} and q.cheque_no is not null), '{}')`,
        })
        .from(disputes)
        .innerJoin(units, eq(units.id, disputes.unitId))
        .innerJoin(buildings, eq(buildings.id, units.buildingId))
        .where(
          and(
            isNotNull(disputes.nextHearingDate),
            gte(disputes.nextHearingDate, range.from),
            lte(disputes.nextHearingDate, range.to),
            ...unitFilter(disputes.unitId),
            ...buildingFilter(),
          ),
        )
        .then((rows) => {
          for (const r of rows) {
            const cheques = r.chequeNos.length ? ` (${r.chequeNos.join(', ')})` : '';
            items.push({
              kind: 'hearing',
              id: `hearing:${r.id}`,
              date: r.hearing as PlainDate,
              endDate: r.hearing as PlainDate,
              titleAr: `جلسة ${r.caseNo}${cheques} · ${r.bAr} ${r.unitNo}`,
              titleEn: `Hearing ${r.caseNo}${cheques} · ${r.bEn} ${r.unitNo}`,
              entityType: 'dispute',
              entityId: r.id,
              status: r.status,
              unitId: r.unitId,
              buildingId: r.buildingId,
              allDay: true,
            });
          }
        }),
    );
  }

  if (wants(range, 'work_order')) {
    const conditions: SQL[] = [
      isNotNull(workOrders.scheduledFor),
      gte(workOrders.scheduledFor, range.from),
      lte(workOrders.scheduledFor, range.to),
      sql`${workOrders.status} <> 'cancelled'`,
    ];
    if (range.unitId) conditions.push(eq(workOrders.unitId, range.unitId));
    if (range.buildingId) conditions.push(eq(workOrders.buildingId, range.buildingId));
    if (scope.ownerId) conditions.push(workOrderInOwnerScope(db, scope.ownerId));
    else if (range.ownerId) conditions.push(workOrderInOwnerScope(db, range.ownerId));
    tasks.push(
      db
        .select({
          id: workOrders.id,
          scheduledFor: workOrders.scheduledFor,
          status: workOrders.status,
          titleAr: workOrders.titleAr,
          titleEn: workOrders.titleEn,
          unitId: workOrders.unitId,
          buildingId: workOrders.buildingId,
          unitNo: units.unitNo,
          bAr: buildings.nameAr,
          bEn: buildings.nameEn,
        })
        .from(workOrders)
        .innerJoin(buildings, eq(buildings.id, workOrders.buildingId))
        .leftJoin(units, eq(units.id, workOrders.unitId))
        .where(and(...conditions))
        .then((rows) => {
          for (const r of rows) {
            items.push({
              kind: 'work_order',
              id: `work-order:${r.id}`,
              date: r.scheduledFor as PlainDate,
              endDate: r.scheduledFor as PlainDate,
              titleAr: `${r.titleAr} · ${r.bAr}${r.unitNo ? ` ${r.unitNo}` : ''}`,
              titleEn: `${r.titleEn} · ${r.bEn}${r.unitNo ? ` ${r.unitNo}` : ''}`,
              entityType: 'work_order',
              entityId: r.id,
              status: r.status,
              unitId: r.unitId,
              buildingId: r.buildingId,
              allDay: true,
            });
          }
        }),
    );
  }

  if (wants(range, 'event')) {
    // Dubai is UTC+4 all year: the range's local days in instants.
    const fromAt = new Date(`${range.from}T00:00:00+04:00`);
    const toAt = new Date(`${range.to}T23:59:59.999+04:00`);
    const conditions: SQL[] = [
      lte(calendarEvents.startsAt, toAt),
      gte(calendarEvents.endsAt, fromAt),
    ];
    if (range.unitId) conditions.push(eq(calendarEvents.unitId, range.unitId));
    if (range.buildingId) conditions.push(eq(calendarEvents.buildingId, range.buildingId));
    if (scope.ownerId) {
      const myUnits = ownerUnitsSubquery(db, scope.ownerId);
      const myBuildings = db
        .select({ b: units.buildingId })
        .from(units)
        .where(inArray(units.id, ownerUnitsSubquery(db, scope.ownerId)));
      conditions.push(eq(calendarEvents.visibleToOwner, true));
      // An event addressed to one owner is that owner's alone, whatever building it is in.
      conditions.push(
        orSql(isNull(calendarEvents.ownerId), eq(calendarEvents.ownerId, scope.ownerId)),
      );
      conditions.push(
        orSql(
          eq(calendarEvents.ownerId, scope.ownerId),
          inArray(calendarEvents.unitId, myUnits),
          and(isNull(calendarEvents.unitId), inArray(calendarEvents.buildingId, myBuildings)),
          and(
            isNull(calendarEvents.unitId),
            isNull(calendarEvents.buildingId),
            isNull(calendarEvents.ownerId),
          ),
        ),
      );
    } else if (range.ownerId) {
      conditions.push(
        orSql(
          eq(calendarEvents.ownerId, range.ownerId),
          inArray(calendarEvents.unitId, ownerUnitsSubquery(db, range.ownerId)),
        ),
      );
    }
    tasks.push(
      db
        .select()
        .from(calendarEvents)
        .where(and(...conditions))
        .orderBy(asc(calendarEvents.startsAt))
        .then((rows) => {
          for (const r of rows) {
            items.push({
              kind: 'event',
              id: `event:${r.id}`,
              date: dubaiDate(r.startsAt),
              endDate: dubaiDate(r.endsAt),
              titleAr: r.titleAr,
              titleEn: r.titleEn,
              entityType: 'calendar_event',
              entityId: r.id,
              status: r.type,
              unitId: r.unitId,
              buildingId: r.buildingId,
              allDay: r.allDay,
              time: r.allDay ? null : dubaiTime(r.startsAt),
            });
          }
        }),
    );
  }

  if (wants(range, 'holiday')) {
    tasks.push(
      db
        .select()
        .from(holidays)
        .where(and(gte(holidays.date, range.from), lte(holidays.date, range.to)))
        .then((rows) => {
          for (const r of rows) {
            items.push({
              kind: 'holiday',
              id: `holiday:${r.date}`,
              date: r.date as PlainDate,
              endDate: r.date as PlainDate,
              titleAr: r.tentative ? `${r.nameAr} (مبدئي)` : r.nameAr,
              titleEn: r.tentative ? `${r.nameEn} (tentative)` : r.nameEn,
              entityType: 'holiday',
              entityId: r.date,
              allDay: true,
            });
          }
        }),
    );
  }

  await Promise.all(tasks);
  return items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? '').localeCompare(b.time ?? '') ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id),
  );
}

// Manual events --------------------------------------------------------------------------------------

export async function createEvent(db: Dbx, actor: AuditActor, input: CreateCalendarEventInput) {
  const [row] = await db
    .insert(calendarEvents)
    .values({
      ...input,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      createdBy: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'calendar_event.create',
    entityType: 'calendar_event',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateEvent(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: Patch<CreateCalendarEventInput>,
) {
  const before = await db.query.calendarEvents.findFirst({ where: eq(calendarEvents.id, id) });
  if (!before) throw notFound('Event');
  const set: Record<string, unknown> = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  if (patch.startsAt !== undefined) set['startsAt'] = new Date(patch.startsAt);
  if (patch.endsAt !== undefined) set['endsAt'] = new Date(patch.endsAt);
  const startsAt = (set['startsAt'] as Date | undefined) ?? before.startsAt;
  const endsAt = (set['endsAt'] as Date | undefined) ?? before.endsAt;
  if (endsAt < startsAt) throw notFound('Event'); // unreachable through the schema; kept for safety
  const [after] = await db
    .update(calendarEvents)
    .set(set)
    .where(eq(calendarEvents.id, id))
    .returning();
  await audit(db, actor, {
    action: 'calendar_event.update',
    entityType: 'calendar_event',
    entityId: id,
    before,
    after,
  });
  return after;
}

export async function deleteEvent(db: Dbx, actor: AuditActor, id: string) {
  const before = await db.query.calendarEvents.findFirst({ where: eq(calendarEvents.id, id) });
  if (!before) throw notFound('Event');
  await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
  await audit(db, actor, {
    action: 'calendar_event.delete',
    entityType: 'calendar_event',
    entityId: id,
    before,
  });
  return { ok: true as const };
}

export async function getEvent(db: Dbx, id: string) {
  const row = await db.query.calendarEvents.findFirst({ where: eq(calendarEvents.id, id) });
  if (!row) throw notFound('Event');
  return row;
}

// Holidays -------------------------------------------------------------------------------------------

export async function listHolidays(db: Dbx, year?: number) {
  return db
    .select()
    .from(holidays)
    .where(
      year
        ? and(gte(holidays.date, `${year}-01-01`), lte(holidays.date, `${year}-12-31`))
        : undefined,
    )
    .orderBy(asc(holidays.date));
}

export async function upsertHoliday(db: Dbx, actor: AuditActor, input: HolidayInput) {
  const before = await db.query.holidays.findFirst({ where: eq(holidays.date, input.date) });
  const [after] = await db
    .insert(holidays)
    .values({
      ...input,
      updatedBy: actor.type === 'staff' ? actor.id : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: holidays.date,
      set: {
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        tentative: input.tentative,
        updatedBy: actor.type === 'staff' ? actor.id : null,
        updatedAt: new Date(),
      },
    })
    .returning();
  await audit(db, actor, {
    action: before ? 'holiday.update' : 'holiday.create',
    entityType: 'holiday',
    entityId: null,
    before: before ?? null,
    after,
  });
  return after;
}

export async function deleteHoliday(db: Dbx, actor: AuditActor, date: PlainDate) {
  const before = await db.query.holidays.findFirst({ where: eq(holidays.date, date) });
  if (!before) throw notFound('Holiday');
  await db.delete(holidays).where(eq(holidays.date, date));
  await audit(db, actor, {
    action: 'holiday.delete',
    entityType: 'holiday',
    entityId: null,
    before,
  });
  return { ok: true as const };
}

/** Holiday dates in a range, for the weekend/holiday warnings on date pickers. */
export async function holidayDates(db: Dbx, from: PlainDate, to: PlainDate): Promise<string[]> {
  const rows = await db
    .select({ date: holidays.date })
    .from(holidays)
    .where(and(gte(holidays.date, from), lte(holidays.date, to)));
  return rows.map((r) => r.date);
}
