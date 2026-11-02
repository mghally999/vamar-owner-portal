/**
 * Property records: the manual unit status with its append-only history, the identifiers on
 * units and buildings, and the computed history timeline of a unit (status changes, contracts,
 * tenants, cheques, expenses, work orders, disputes, ownership), newest first.
 */
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type {
  BuildingIdentifiersInput,
  PlainDate,
  SetUnitStatusInput,
  TimelineKind,
  UnitIdentifiersInput,
  UnitStatus,
} from '@vamar/shared';
import { rowsOf, type Dbx } from '../db.js';
import { conflict, notFound, validation } from '../errors.js';
import { base64url, fromBase64 } from '../util/crypto.js';
import { audit, type AuditActor } from './audit.js';
import { ownerUnitsSubquery } from './owner-scope.js';

const {
  units,
  buildings,
  unitStatusEvents,
  contracts,
  tenants,
  cheques,
  chequeEvents,
  expenses,
  expenseAllocations,
  workOrders,
  disputes,
  disputeUpdates,
  unitOwnerships,
  owners,
  staffUsers,
} = schema;

/** `occupied` while an active contract runs today, otherwise the manual status. */
export function effectiveStatus(manual: UnitStatus, occupied: boolean): UnitStatus {
  return occupied ? 'occupied' : manual;
}

export async function setUnitStatus(
  db: Dbx,
  actor: AuditActor,
  unitId: string,
  input: SetUnitStatusInput,
) {
  const before = await db.query.units.findFirst({ where: eq(units.id, unitId) });
  if (!before) throw notFound('Unit');
  if (before.status === input.status) throw conflict('The unit already has this status');
  const [after] = await db
    .update(units)
    .set({ status: input.status })
    .where(eq(units.id, unitId))
    .returning();
  const [event] = await db
    .insert(unitStatusEvents)
    .values({
      unitId,
      fromStatus: before.status,
      toStatus: input.status,
      reason: input.reason,
      actorStaffId: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  await audit(db, actor, {
    action: 'unit.set_status',
    entityType: 'unit',
    entityId: unitId,
    before: { status: before.status },
    after: { status: input.status, reason: input.reason, eventId: event?.id },
  });
  return after;
}

export async function setUnitIdentifiers(
  db: Dbx,
  actor: AuditActor,
  unitId: string,
  input: UnitIdentifiersInput,
) {
  const before = await db.query.units.findFirst({ where: eq(units.id, unitId) });
  if (!before) throw notFound('Unit');
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [after] = await db.update(units).set(set).where(eq(units.id, unitId)).returning();
  await audit(db, actor, {
    action: 'unit.set_identifiers',
    entityType: 'unit',
    entityId: unitId,
    before,
    after,
  });
  return after;
}

export async function setBuildingIdentifiers(
  db: Dbx,
  actor: AuditActor,
  buildingId: string,
  input: BuildingIdentifiersInput,
) {
  const before = await db.query.buildings.findFirst({ where: eq(buildings.id, buildingId) });
  if (!before) throw notFound('Building');
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [after] = await db
    .update(buildings)
    .set(set)
    .where(eq(buildings.id, buildingId))
    .returning();
  await audit(db, actor, {
    action: 'building.set_identifiers',
    entityType: 'building',
    entityId: buildingId,
    before,
    after,
  });
  return after;
}

export async function unitStatusHistory(db: Dbx, unitId: string) {
  return db
    .select({
      id: unitStatusEvents.id,
      fromStatus: unitStatusEvents.fromStatus,
      toStatus: unitStatusEvents.toStatus,
      reason: unitStatusEvents.reason,
      at: unitStatusEvents.at,
      actorName: staffUsers.name,
    })
    .from(unitStatusEvents)
    .leftJoin(staffUsers, eq(staffUsers.id, unitStatusEvents.actorStaffId))
    .where(eq(unitStatusEvents.unitId, unitId))
    .orderBy(desc(unitStatusEvents.at));
}

// Timeline -------------------------------------------------------------------------------------------

export interface TimelineEntry {
  kind: TimelineKind;
  /** Stable id for keys and cursors: `<kind>:<row id>`. */
  id: string;
  /** Instant of the event (ISO). Calendar-dated events are stamped at 08:00 Dubai. */
  at: string;
  /** The business date in Asia/Dubai. */
  date: PlainDate;
  titleAr: string;
  titleEn: string;
  detailAr: string;
  detailEn: string;
  entityType: string;
  entityId: string;
  amountFils: number | null;
  status: string | null;
}

export interface TimelineQuery {
  kinds?: TimelineKind[] | undefined;
  cursor?: string | undefined;
  limit: number;
  /** Owner view: amounts are the owner's share, hidden rows are left out. */
  ownerId?: string | undefined;
}

const AT_08 = 'T08:00:00+04:00';
const dateOf = (iso: string): PlainDate =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso)) as PlainDate;

/**
 * One UNION ALL over the unit's history, ordered newest first with keyset pagination on
 * (at, id). Every branch is a cheap index scan on the unit, so a long history still pages
 * without reading it all.
 */
export async function unitTimeline(
  db: Dbx,
  unitId: string,
  q: TimelineQuery,
): Promise<{ items: TimelineEntry[]; nextCursor: string | null }> {
  const unit = await db.query.units.findFirst({
    where: eq(units.id, unitId),
    columns: { id: true },
  });
  if (!unit) throw notFound('Unit');
  const want = (k: TimelineKind) => q.kinds === undefined || q.kinds.includes(k);
  const owner = q.ownerId ?? null;
  const share = owner
    ? sql`coalesce((select uo.share_bp from ${unitOwnerships} uo where uo.unit_id = ${unitId} and uo.owner_id = ${owner} and uo.from_date <= d.on_date and (uo.to_date is null or uo.to_date > d.on_date) limit 1), 0)`
    : sql`10000`;
  const branches: SQL[] = [];

  if (want('status')) {
    branches.push(sql`
      select 'status'::text as kind, e.id::text as rid, e.at as at, 'status'::text as title_ar, e.to_status::text as title_en,
             e.reason as detail_ar, coalesce(e.from_status::text, '') as detail_en, 'unit'::text as entity_type, e.unit_id::text as entity_id,
             null::bigint as amount_fils, e.to_status::text as status
      from ${unitStatusEvents} e where e.unit_id = ${unitId}`);
  }
  if (want('contract')) {
    branches.push(sql`
      select 'contract'::text, c.id::text, (c.start_date::text || ${AT_08})::timestamptz, 'contract_start'::text, t.name,
             c.ejari_no, '', 'contract', c.id::text, c.annual_rent_fils, c.status::text
      from ${contracts} c join ${tenants} t on t.id = c.tenant_id where c.unit_id = ${unitId} and c.status <> 'draft'`);
    branches.push(sql`
      select 'contract'::text, c.id::text || ':end', (c.end_date::text || ${AT_08})::timestamptz,
             case when c.status = 'terminated' then 'contract_terminated' when c.status = 'renewed' then 'contract_renewed' else 'contract_end' end, t.name,
             '', '', 'contract', c.id::text, null::bigint, c.status::text
      from ${contracts} c join ${tenants} t on t.id = c.tenant_id
      where c.unit_id = ${unitId} and c.status in ('expired', 'terminated', 'renewed')`);
  }
  if (want('tenant')) {
    branches.push(sql`
      select 'tenant'::text, c.id::text || ':tenant', (c.start_date::text || ${AT_08})::timestamptz, 'tenant_moved_in'::text, t.name,
             coalesce(t.company, ''), '', 'tenant', t.id::text, null::bigint, null::text
      from ${contracts} c join ${tenants} t on t.id = c.tenant_id where c.unit_id = ${unitId} and c.status in ('active', 'expired', 'terminated', 'renewed')`);
  }
  if (want('cheque')) {
    branches.push(sql`
      select 'cheque'::text, ev.id::text, ev.at, 'cheque_' || ev.to_status::text, coalesce(q.cheque_no, ''),
             coalesce(ev.note, ''), '', 'cheque', q.id::text,
             case when q.amount_fils is null then null else (q.amount_fils * (${share}) / 10000)::bigint end, ev.to_status::text
      from ${chequeEvents} ev join ${cheques} q on q.id = ev.cheque_id join ${contracts} c on c.id = q.contract_id
      cross join lateral (select q.due_date as on_date) d
      where c.unit_id = ${unitId} and c.status <> 'draft' and ev.to_status <> 'upcoming'`);
    branches.push(sql`
      select 'cheque'::text, q.id::text || ':due', (q.due_date::text || ${AT_08})::timestamptz, 'cheque_due'::text, coalesce(q.cheque_no, ''),
             coalesce(q.bank_name, ''), '', 'cheque', q.id::text,
             case when q.amount_fils is null then null else (q.amount_fils * (${share}) / 10000)::bigint end, q.status::text
      from ${cheques} q join ${contracts} c on c.id = q.contract_id
      cross join lateral (select q.due_date as on_date) d
      where c.unit_id = ${unitId} and c.status <> 'draft' and q.status in ('upcoming', 'deposited')`);
  }
  if (want('expense')) {
    branches.push(
      owner
        ? sql`
      select 'expense'::text, x.id::text, (x.invoice_date::text || ${AT_08})::timestamptz, 'expense_' || x.kind::text, x.reason_en,
             x.reason_ar, coalesce(x.invoice_no, ''), 'expense', x.id::text, (select sum(a.amount_fils) from ${expenseAllocations} a where a.expense_id = x.id and a.owner_id = ${owner} and a.unit_id = ${unitId})::bigint, x.status::text
      from ${expenses} x
      where x.status = 'posted' and x.visible_to_owner and exists (select 1 from ${expenseAllocations} a where a.expense_id = x.id and a.owner_id = ${owner} and a.unit_id = ${unitId})`
        : sql`
      select 'expense'::text, x.id::text, (x.invoice_date::text || ${AT_08})::timestamptz, 'expense_' || x.kind::text, x.reason_en,
             x.reason_ar, coalesce(x.invoice_no, ''), 'expense', x.id::text,
             case when x.scope = 'unit' then x.total_fils else (select sum(a.amount_fils) from ${expenseAllocations} a where a.expense_id = x.id and a.unit_id = ${unitId})::bigint end, x.status::text
      from ${expenses} x
      where x.status <> 'void' and (x.unit_id = ${unitId} or exists (select 1 from ${expenseAllocations} a where a.expense_id = x.id and a.unit_id = ${unitId}))`,
    );
  }
  if (want('work_order')) {
    branches.push(sql`
      select 'work_order'::text, w.id::text, (w.reported_on::text || ${AT_08})::timestamptz, 'work_order_' || w.status::text, w.title_en,
             w.title_ar, w.description, 'work_order', w.id::text, null::bigint, w.status::text
      from ${workOrders} w where w.unit_id = ${unitId} ${owner ? sql`and w.visible_to_owner` : sql``}`);
    branches.push(sql`
      select 'work_order'::text, w.id::text || ':done', w.completed_at, 'work_order_completed'::text, w.title_en,
             w.title_ar, '', 'work_order', w.id::text, null::bigint, w.status::text
      from ${workOrders} w where w.unit_id = ${unitId} and w.completed_at is not null ${owner ? sql`and w.visible_to_owner` : sql``}`);
  }
  if (want('dispute')) {
    branches.push(sql`
      select 'dispute'::text, dp.id::text, dp.opened_at, 'dispute_opened'::text, dp.case_no,
             dp.type::text, '', 'dispute', dp.id::text, dp.amount_claimed_fils, dp.status::text
      from ${disputes} dp where dp.unit_id = ${unitId}`);
    branches.push(sql`
      select 'dispute'::text, du.id::text, du.at, 'dispute_update'::text, dp.case_no,
             du.note, '', 'dispute', dp.id::text, null::bigint, dp.status::text
      from ${disputeUpdates} du join ${disputes} dp on dp.id = du.dispute_id where dp.unit_id = ${unitId} ${owner ? sql`and du.visible_to_owner` : sql``}`);
    branches.push(sql`
      select 'dispute'::text, dp.id::text || ':closed', dp.closed_at, 'dispute_closed'::text, dp.case_no,
             '', '', 'dispute', dp.id::text, null::bigint, dp.status::text
      from ${disputes} dp where dp.unit_id = ${unitId} and dp.closed_at is not null`);
  }
  if (want('ownership')) {
    branches.push(sql`
      select 'ownership'::text, uo.id::text, (uo.from_date::text || ${AT_08})::timestamptz, 'ownership_from'::text, o.name_en,
             o.name_ar, uo.share_bp::text, 'owner', o.id::text, null::bigint, null::text
      from ${unitOwnerships} uo join ${owners} o on o.id = uo.owner_id where uo.unit_id = ${unitId}`);
  }
  if (branches.length === 0) return { items: [], nextCursor: null };

  const cursorSql = q.cursor ? parseCursor(q.cursor) : null;
  const union = sql.join(branches, sql` union all `);
  const result: unknown = await db.execute(sql`
    select * from (${union}) as h(kind, rid, at, title_ar, title_en, detail_ar, detail_en, entity_type, entity_id, amount_fils, status)
    where h.at is not null ${cursorSql ? sql`and (h.at < ${cursorSql.at}::timestamptz or (h.at = ${cursorSql.at}::timestamptz and h.rid < ${cursorSql.id}))` : sql``}
    order by h.at desc, h.rid desc
    limit ${q.limit + 1}`);
  const rows = rowsOf<RawRow>(result);
  const items = rows.slice(0, q.limit).map(toEntry);
  const last = items[items.length - 1];
  const nextCursor =
    rows.length > q.limit && last
      ? encodeTimelineCursor(last.at, last.id.split(':').slice(1).join(':'))
      : null;
  return { items, nextCursor };
}

interface RawRow {
  kind: TimelineKind;
  rid: string;
  at: string | Date;
  title_ar: string;
  title_en: string;
  detail_ar: string;
  detail_en: string;
  entity_type: string;
  entity_id: string;
  amount_fils: string | number | null;
  status: string | null;
}

function encodeTimelineCursor(at: string, id: string): string {
  return base64url(new TextEncoder().encode(JSON.stringify([at, id])));
}

function parseCursor(raw: string): { at: string; id: string } {
  try {
    const [at, id] = JSON.parse(new TextDecoder().decode(fromBase64(raw))) as [string, string];
    if (
      typeof at !== 'string' ||
      typeof id !== 'string' ||
      Number.isNaN(Date.parse(at)) ||
      id.length > 120
    )
      throw new Error('bad');
    return { at, id };
  } catch {
    throw validation('Invalid cursor');
  }
}

/** Titles are keys the clients translate; the raw columns carry the names, numbers and notes. */
function toEntry(r: RawRow): TimelineEntry {
  const at = r.at instanceof Date ? r.at.toISOString() : new Date(r.at).toISOString();
  return {
    kind: r.kind,
    id: `${r.kind}:${r.rid}`,
    at,
    date: dateOf(at),
    titleAr: r.title_ar,
    titleEn: r.title_en,
    detailAr: r.detail_ar,
    detailEn: r.detail_en,
    entityType: r.entity_type,
    entityId: r.entity_id,
    amountFils: r.amount_fils === null ? null : Number(r.amount_fils),
    status: r.status,
  };
}

/** Owners read the timeline of their own units only. */
export async function ownerUnitTimeline(
  db: Dbx,
  ownerId: string,
  unitId: string,
  q: Omit<TimelineQuery, 'ownerId'>,
) {
  const [row] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, unitId), inArray(units.id, ownerUnitsSubquery(db, ownerId))))
    .limit(1);
  if (!row) throw notFound('Unit');
  return unitTimeline(db, unitId, { ...q, ownerId });
}

/** The building timeline: the newest entries across its units, with the unit number attached. */
export async function buildingTimeline(db: Dbx, buildingId: string, q: TimelineQuery) {
  const building = await db.query.buildings.findFirst({
    where: eq(buildings.id, buildingId),
    columns: { id: true },
  });
  if (!building) throw notFound('Building');
  const unitRows = await db
    .select({ id: units.id, unitNo: units.unitNo })
    .from(units)
    .where(eq(units.buildingId, buildingId));
  const perUnit = await Promise.all(
    unitRows.map((u) =>
      unitTimeline(db, u.id, { kinds: q.kinds, limit: q.limit, cursor: undefined }).then((t) =>
        t.items.map((e) => ({ ...e, unitId: u.id, unitNo: u.unitNo })),
      ),
    ),
  );
  const all = perUnit.flat().sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const cursor = q.cursor ? parseCursor(q.cursor) : null;
  const after = cursor
    ? all.filter((e) => e.at < cursor.at || (e.at === cursor.at && e.id < cursor.id))
    : all;
  const items = after.slice(0, q.limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: after.length > q.limit && last ? encodeTimelineCursor(last.at, last.id) : null,
  };
}
