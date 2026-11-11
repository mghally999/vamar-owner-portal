/**
 * Staff side of v2: property records (status with history, identifiers, timelines), work orders
 * with the "done" push, the calendar with events and holidays, the reports, search, the dispute
 * to cheque links, settings and the hearing and monthly cron steps.
 */
import { and, eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyJobs } from '../src/cron.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
let editor: string;
let viewer: string;
let noor: { id: string };
let unit2002: { id: string };

beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
  editor = await w.staffToken('entry@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  const [b] = await w.db
    .select({ id: schema.buildings.id })
    .from(schema.buildings)
    .where(eq(schema.buildings.nameEn, 'Al Noor Tower'));
  noor = b!;
  const [u] = await w.db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(and(eq(schema.units.buildingId, noor.id), eq(schema.units.unitNo, '2002')));
  unit2002 = u!;
});
afterAll(() => w.close());

describe('property records', () => {
  it('occupied is derived; staff set the other statuses with a reason and the history is kept', async () => {
    const before = await w.json<{ status: string; effectiveStatus: string; occupied: boolean }>(
      `/api/staff/units/${unit2002.id}`,
      { token: viewer },
    );
    expect(before.body.occupied).toBe(false);
    expect(before.body.effectiveStatus).toBe('vacant_ready');
    const occupied = await w.json('/api/staff/units/' + unit2002.id + '/status', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ status: 'occupied', reason: 'tenant moved in' }),
    });
    expect(occupied.status).toBe(422);
    const set = await w.json<{ status: string }>('/api/staff/units/' + unit2002.id + '/status', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        status: 'under_maintenance',
        reason: 'Repainting before the next tenant',
      }),
    });
    expect(set.status).toBe(200);
    expect(set.body.status).toBe('under_maintenance');
    const same = await w.json('/api/staff/units/' + unit2002.id + '/status', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ status: 'under_maintenance', reason: 'again' }),
    });
    expect(same.status).toBe(409);
    const history = await w.json<{
      items: { fromStatus: string; toStatus: string; reason: string; actorName: string }[];
    }>(`/api/staff/units/${unit2002.id}/status-history`, { token: viewer });
    expect(history.body.items[0]).toMatchObject({
      fromStatus: 'vacant_ready',
      toStatus: 'under_maintenance',
      actorName: 'Noura Al Hammadi',
    });
    const denied = await w.json('/api/staff/units/' + unit2002.id + '/status', {
      method: 'POST',
      token: viewer,
      body: JSON.stringify({ status: 'reserved', reason: 'x' }),
    });
    expect(denied.status).toBe(403);
    // An occupied unit reports occupied whatever staff set.
    const [occupiedUnit] = await w.db
      .select({ unitId: schema.contracts.unitId })
      .from(schema.contracts)
      .where(eq(schema.contracts.status, 'active'))
      .limit(1);
    const occ = await w.json<{ effectiveStatus: string }>(
      `/api/staff/units/${occupiedUnit!.unitId}`,
      { token: viewer },
    );
    expect(occ.body.effectiveStatus).toBe('occupied');
  });

  it('identifiers on units and buildings are validated and searchable', async () => {
    const bad = await w.json(`/api/staff/units/${unit2002.id}/identifiers`, {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ makaniNo: '123' }),
    });
    expect(bad.status).toBe(422);
    const ok = await w.json<{ titleDeedNo: string; makaniNo: string; dewaPremiseNo: string }>(
      `/api/staff/units/${unit2002.id}/identifiers`,
      {
        method: 'PATCH',
        token: editor,
        body: JSON.stringify({
          titleDeedNo: 'TD-TEST-777',
          makaniNo: '9876543210',
          dewaPremiseNo: '123456789',
          handoverDate: '2016-05-01',
        }),
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.makaniNo).toBe('9876543210');
    const building = await w.json<{ plotNo: string; floorsCount: number }>(
      `/api/staff/buildings/${noor.id}/identifiers`,
      {
        method: 'PATCH',
        token: editor,
        body: JSON.stringify({ plotNo: '346-9999', floorsCount: 25 }),
      },
    );
    expect(building.body.floorsCount).toBe(25);
    const search = await w.json<{ items: { type: string; id: string; detail: string }[] }>(
      '/api/staff/search?q=9876543210',
      { token: viewer },
    );
    expect(search.body.items.some((h) => h.type === 'unit' && h.id === unit2002.id)).toBe(true);
    const deed = await w.json<{ items: { type: string; id: string }[] }>(
      '/api/staff/search?q=TD-TEST',
      { token: viewer },
    );
    expect(deed.body.items.some((h) => h.id === unit2002.id)).toBe(true);
  });

  it('the unit and building timelines list status changes, contracts, cheques, expenses, work orders and disputes newest first', async () => {
    const t = await w.json<{ items: { kind: string; titleEn: string; at: string }[] }>(
      `/api/staff/units/${unit2002.id}/timeline?limit=20`,
      { token: viewer },
    );
    expect(t.status).toBe(200);
    expect(t.body.items[0]).toMatchObject({ kind: 'status', titleEn: 'under_maintenance' });
    const b = await w.json<{
      items: { kind: string; unitNo: string; at: string }[];
      nextCursor: string | null;
    }>(`/api/staff/buildings/${noor.id}/timeline?limit=15&kinds=expense,work_order`, {
      token: viewer,
    });
    expect(b.body.items.length).toBe(15);
    expect(b.body.items.every((e) => e.kind === 'expense' || e.kind === 'work_order')).toBe(true);
    const ats = b.body.items.map((e) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(b.body.nextCursor).not.toBeNull();
  });
});

describe('work orders', () => {
  it('editors create, update and finish them; finishing notifies the owners once', async () => {
    const created = await w.json<{ id: string; status: string; reportedOn: string }>(
      '/api/staff/work-orders',
      {
        method: 'POST',
        token: editor,
        body: JSON.stringify({
          buildingId: noor.id,
          unitId: unit2002.id,
          titleAr: 'تسريب',
          titleEn: 'Leak under the sink',
          priority: 'urgent',
        }),
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.reportedOn).toBe(TODAY);
    const owners = await w.db.select({ id: schema.owners.id }).from(schema.owners);
    for (const o of owners)
      await w.db
        .insert(schema.devices)
        .values({
          ownerId: o.id,
          deviceId: `wo-${o.id.slice(0, 8)}`,
          platform: 'android',
          pushToken: 'ExponentPushToken[x]',
        })
        .onConflictDoNothing();
    const scheduled = await w.json<{ status: string; scheduledFor: string }>(
      `/api/staff/work-orders/${created.body.id}`,
      {
        method: 'PATCH',
        token: editor,
        body: JSON.stringify({ status: 'scheduled', scheduledFor: addDays(TODAY, 2) }),
      },
    );
    expect(scheduled.body.status).toBe('scheduled');
    const done = await w.json<{ status: string; completedAt: string | null }>(
      `/api/staff/work-orders/${created.body.id}`,
      {
        method: 'PATCH',
        token: editor,
        body: JSON.stringify({ status: 'done' }),
      },
    );
    expect(done.body.completedAt).not.toBeNull();
    await w.flush();
    const pushed = await w.db
      .select()
      .from(schema.notificationLog)
      .where(
        and(
          eq(schema.notificationLog.type, 'work_order_done'),
          eq(schema.notificationLog.entityId, created.body.id),
        ),
      );
    expect(pushed.length).toBe(1); // one owner of unit 2002
    const again = await w.json(`/api/staff/work-orders/${created.body.id}`, {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ description: 'fixed' }),
    });
    expect(again.status).toBe(200);
    await w.flush();
    const still = await w.db
      .select()
      .from(schema.notificationLog)
      .where(eq(schema.notificationLog.type, 'work_order_done'));
    expect(still.length).toBe(1);
    const list = await w.json<{ items: { id: string }[] }>(
      `/api/staff/work-orders?status=done&buildingId=${noor.id}`,
      { token: viewer },
    );
    expect(list.body.items.some((x) => x.id === created.body.id)).toBe(true);
    const denied = await w.json('/api/staff/work-orders', {
      method: 'POST',
      token: viewer,
      body: JSON.stringify({}),
    });
    expect(denied.status).toBe(403);
  });
});

describe('calendar', () => {
  it('a year of items for staff, filtered by building and kind; events are created, moved and deleted by editors', async () => {
    const all = await w.json<{
      items: { kind: string; buildingId: string | null; date: string }[];
    }>('/api/staff/calendar?from=2026-01-01&to=2026-12-31', { token: viewer });
    expect(all.status).toBe(200);
    const kinds = new Set(all.body.items.map((i) => i.kind));
    for (const k of ['cheque_due', 'contract_end', 'hearing', 'work_order', 'event', 'holiday'])
      expect(kinds.has(k)).toBe(true);
    const onlyNoor = await w.json<{ items: { kind: string; buildingId: string | null }[] }>(
      `/api/staff/calendar?from=2026-01-01&to=2026-12-31&buildingId=${noor.id}&kinds=cheque_due,event`,
      { token: viewer },
    );
    expect(onlyNoor.body.items.every((i) => i.buildingId === noor.id)).toBe(true);
    expect(onlyNoor.body.items.every((i) => i.kind === 'cheque_due' || i.kind === 'event')).toBe(
      true,
    );

    const created = await w.json<{ id: string; startsAt: string }>('/api/staff/calendar-events', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        titleAr: 'معاينة',
        titleEn: 'Inspection',
        startsAt: `${TODAY}T10:00:00+04:00`,
        endsAt: `${TODAY}T11:00:00+04:00`,
        type: 'inspection',
        buildingId: noor.id,
      }),
    });
    expect(created.status).toBe(201);
    const moved = await w.json<{ startsAt: string }>(
      `/api/staff/calendar-events/${created.body.id}`,
      {
        method: 'PATCH',
        token: editor,
        body: JSON.stringify({
          startsAt: `${addDays(TODAY, 1)}T10:00:00+04:00`,
          endsAt: `${addDays(TODAY, 1)}T11:00:00+04:00`,
        }),
      },
    );
    expect(moved.status).toBe(200);
    const day = await w.json<{ items: { kind: string; entityId: string; time: string | null }[] }>(
      `/api/staff/calendar?from=${addDays(TODAY, 1)}&to=${addDays(TODAY, 1)}&kinds=event`,
      { token: viewer },
    );
    expect(day.body.items.some((i) => i.entityId === created.body.id && i.time === '10:00')).toBe(
      true,
    );
    expect(
      (
        await w.json(`/api/staff/calendar-events/${created.body.id}`, {
          method: 'DELETE',
          token: viewer,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await w.json(`/api/staff/calendar-events/${created.body.id}`, {
          method: 'DELETE',
          token: editor,
        })
      ).status,
    ).toBe(200);
  });

  it('holidays are seeded for 2026 and 2027 and only admins edit them', async () => {
    const list = await w.json<{ items: { date: string; tentative: boolean }[] }>(
      '/api/staff/holidays?year=2026',
      { token: viewer },
    );
    expect(list.body.items.map((h) => h.date)).toContain('2026-12-02');
    expect(list.body.items.find((h) => h.date === '2026-03-20')?.tentative).toBe(true);
    const denied = await w.json('/api/staff/holidays', {
      method: 'PUT',
      token: editor,
      body: JSON.stringify({ date: '2026-07-01', nameAr: 'x', nameEn: 'x' }),
    });
    expect(denied.status).toBe(403);
    const added = await w.json<{ date: string }>('/api/staff/holidays', {
      method: 'PUT',
      token: admin,
      body: JSON.stringify({
        date: '2026-03-23',
        nameAr: 'عطلة عيد الفطر',
        nameEn: 'Eid Al Fitr holiday (extended)',
        tentative: false,
      }),
    });
    expect(added.status).toBe(200);
    expect(
      (await w.json('/api/staff/holidays/2026-03-23', { method: 'DELETE', token: admin })).status,
    ).toBe(200);
    expect(
      (await w.json('/api/staff/holidays/2026-03-23', { method: 'DELETE', token: admin })).status,
    ).toBe(404);
  });
});

describe('reports, settings, search', () => {
  it('the summary holds the rent identity, compares with the previous period and buckets by month', async () => {
    const r = await w.json<{
      preset: string;
      rent: {
        expectedFils: number;
        collectedFils: number;
        outstandingFils: number;
        atRiskFils: number;
        collectionRatePct: number;
      };
      expenses: { totalFils: number; fixedFils: number; variableFils: number };
      previous: { rent: { expectedFils: number } } | null;
      change: { expectedPct: number | null } | null;
      buckets: {
        key: string;
        expectedFils: number;
        totalFils: number;
        occupiedUnits: number;
        totalUnits: number;
      }[];
      byCategory: { nameEn: string; totalFils: number }[];
      occupancy: { totalUnits: number };
    }>('/api/staff/reports/summary?preset=this_year&compare=1', { token: viewer });
    expect(r.status).toBe(200);
    expect(r.body.rent.collectedFils + r.body.rent.outstandingFils + r.body.rent.atRiskFils).toBe(
      r.body.rent.expectedFils,
    );
    expect(r.body.buckets.length).toBe(12);
    expect(r.body.buckets.reduce((a, b) => a + b.expectedFils, 0)).toBe(r.body.rent.expectedFils);
    expect(r.body.buckets.reduce((a, b) => a + b.totalFils, 0)).toBe(r.body.expenses.totalFils);
    expect(r.body.expenses.fixedFils + r.body.expenses.variableFils).toBe(
      r.body.expenses.totalFils,
    );
    expect(r.body.byCategory.reduce((a, c) => a + c.totalFils, 0)).toBe(r.body.expenses.totalFils);
    expect(r.body.previous).not.toBeNull();
    expect(r.body.occupancy.totalUnits).toBe(32);
    expect(r.body.buckets[9]!.totalUnits).toBe(32);
    expect(r.body.rent.collectionRatePct).toBeGreaterThan(0);
    const owner = await w.json<{ rent: { expectedFils: number }; expenses: { totalFils: number } }>(
      `/api/staff/reports/summary?preset=this_year&ownerId=${w.ids.owners['+971500000004']}`,
      { token: viewer },
    );
    expect(owner.body.rent.expectedFils).toBeLessThan(r.body.rent.expectedFils);
    const byKind = await w.json<{ expenses: { variableFils: number; fixedFils: number } }>(
      `/api/staff/reports/summary?preset=last_6_months&kind=fixed&buildingId=${noor.id}`,
      { token: viewer },
    );
    expect(byKind.body.expenses.variableFils).toBe(0);
    expect(byKind.body.expenses.fixedFils).toBeGreaterThan(0);
  });

  it('settings are read by everyone and changed by admins, with an audit row', async () => {
    const before = await w.json<{ weekStart: string; largeExpenseAlertFils: number }>(
      '/api/staff/settings',
      { token: viewer },
    );
    expect(before.body).toMatchObject({ weekStart: 'monday', largeExpenseAlertFils: 500_000 });
    expect(
      (
        await w.json('/api/staff/settings', {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ weekStart: 'sunday' }),
        })
      ).status,
    ).toBe(403);
    const after = await w.json<{ weekStart: string; hijriDisplay: boolean }>(
      '/api/staff/settings',
      {
        method: 'PATCH',
        token: admin,
        body: JSON.stringify({ weekStart: 'sunday', hijriDisplay: true }),
      },
    );
    expect(after.body).toMatchObject({ weekStart: 'sunday', hijriDisplay: true });
    const audit = await w.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'settings.update'));
    expect(audit.length).toBe(1);
    // The week preset follows the setting.
    const week = await w.json<{ period: { from: string } }>(
      '/api/staff/reports/summary?preset=this_week',
      { token: viewer },
    );
    expect(week.body.period.from).toBe('2026-10-04'); // TODAY is Wednesday 7 Oct 2026
    await w.json('/api/staff/settings', {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ weekStart: 'monday', hijriDisplay: false }),
    });
  });

  it('search finds owners, phones, cheques, cases, invoices and tenants', async () => {
    const [cheque] = await w.db
      .select({ chequeNo: schema.cheques.chequeNo, id: schema.cheques.id })
      .from(schema.cheques)
      .where(eq(schema.cheques.status, 'bounced'));
    const byCheque = await w.json<{ items: { type: string; id: string }[] }>(
      `/api/staff/search?q=${cheque!.chequeNo}`,
      { token: viewer },
    );
    expect(byCheque.body.items.some((h) => h.type === 'cheque' && h.id === cheque!.id)).toBe(true);
    expect(byCheque.body.items.some((h) => h.type === 'dispute')).toBe(true); // the case about that cheque
    const byCase = await w.json<{ items: { type: string }[] }>('/api/staff/search?q=D-2026-0002', {
      token: viewer,
    });
    expect(byCase.body.items[0]?.type).toBe('dispute');
    const byPhone = await w.json<{ items: { type: string; titleEn: string }[] }>(
      '/api/staff/search?q=0500000001',
      { token: viewer },
    );
    expect(
      byPhone.body.items.some((h) => h.type === 'owner' && h.titleEn === 'Khalid Al Mansoori'),
    ).toBe(true);
    const byInvoice = await w.json<{ items: { type: string }[] }>(
      '/api/staff/search?q=GL-2026-0417',
      { token: viewer },
    );
    expect(byInvoice.body.items.some((h) => h.type === 'expense')).toBe(true);
    expect((await w.request('/api/staff/search?q=', { token: viewer })).status).toBe(422);
  });
});

describe('disputes and cheques', () => {
  it('lists carry the cheque numbers, a bounced-cheque case needs a cheque, links are replaced as a set, search by cheque number', async () => {
    const list = await w.json<{
      items: { id: string; type: string; caseNo: string; chequeNos: string[]; unitId: string }[];
    }>('/api/staff/disputes', { token: viewer });
    const bounced = list.body.items.find((d) => d.type === 'bounced_cheque');
    expect(bounced).toBeDefined();
    expect(bounced!.chequeNos.length).toBeGreaterThan(0);
    const detail = await w.json<{
      cheques: {
        chequeNo: string;
        bankName: string;
        amountFils: number;
        dueDate: string;
        bouncedAt: string;
        bounceReason: string;
      }[];
    }>(`/api/staff/disputes/${bounced!.id}`, { token: viewer });
    expect(detail.body.cheques[0]).toMatchObject({ bounceReason: 'رصيد غير كافٍ' });
    expect(detail.body.cheques[0]!.bankName.length).toBeGreaterThan(0);

    const noCheques = await w.json<{ error: { details: { path: string }[] } }>(
      '/api/staff/disputes',
      {
        method: 'POST',
        token: editor,
        body: JSON.stringify({ unitId: bounced!.unitId, type: 'bounced_cheque' }),
      },
    );
    expect(noCheques.status).toBe(422);
    expect(noCheques.body.error.details.some((d) => d.path === 'chequeIds')).toBe(true);

    const [otherUnitCheque] = await w.db
      .select({ id: schema.cheques.id })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .where(and(eq(schema.contracts.unitId, unit2002.id)))
      .limit(1);
    const [unitCheque] = await w.db
      .select({ id: schema.cheques.id, chequeNo: schema.cheques.chequeNo })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .where(
        and(eq(schema.contracts.unitId, bounced!.unitId), eq(schema.contracts.status, 'active')),
      )
      .limit(1);
    const wrongUnit = await w.json(`/api/staff/disputes/${bounced!.id}/cheques`, {
      method: 'PUT',
      token: editor,
      body: JSON.stringify({
        chequeIds: otherUnitCheque ? [otherUnitCheque.id] : [unitCheque!.id],
      }),
    });
    expect(wrongUnit.status).toBe(otherUnitCheque ? 422 : 200);
    const empty = await w.json(`/api/staff/disputes/${bounced!.id}/cheques`, {
      method: 'PUT',
      token: editor,
      body: JSON.stringify({ chequeIds: [] }),
    });
    expect(empty.status).toBe(422);
    const set = await w.json<{ items: { id: string }[] }>(
      `/api/staff/disputes/${bounced!.id}/cheques`,
      {
        method: 'PUT',
        token: editor,
        body: JSON.stringify({ chequeIds: [unitCheque!.id] }),
      },
    );
    expect(set.status).toBe(200);
    expect(set.body.items.map((c) => c.id)).toEqual([unitCheque!.id]);
    const found = await w.json<{ items: { id: string }[] }>(
      `/api/staff/disputes?search=${unitCheque!.chequeNo}`,
      { token: viewer },
    );
    expect(found.body.items.some((d) => d.id === bounced!.id)).toBe(true);
    const owner = await w.json<{ chequeNos: string[]; cheques: { chequeNo: string }[] }>(
      `/api/owner/disputes/${bounced!.id}`,
      {
        token: await w.ownerToken(await ownerPhoneOfUnit(bounced!.unitId)),
      },
    );
    expect(owner.status).toBe(200);
    expect(owner.body.cheques.map((c) => c.chequeNo)).toEqual([unitCheque!.chequeNo]);
    expect(owner.body.chequeNos).toEqual([unitCheque!.chequeNo]);
  });

  it('the hearing reminder goes out three days before, once; the monthly summary goes out on the 1st', async () => {
    const [arrears] = await w.db
      .select({ id: schema.disputes.id })
      .from(schema.disputes)
      .where(eq(schema.disputes.type, 'rent_arrears'));
    await w.db
      .update(schema.disputes)
      .set({ nextHearingDate: addDays(TODAY, 3) })
      .where(eq(schema.disputes.id, arrears!.id));
    const owners = await w.db.select({ id: schema.owners.id }).from(schema.owners);
    for (const o of owners)
      await w.db
        .insert(schema.devices)
        .values({
          ownerId: o.id,
          deviceId: `h-${o.id.slice(0, 8)}`,
          platform: 'android',
          pushToken: 'ExponentPushToken[x]',
        })
        .onConflictDoNothing();
    const first = await runDailyJobs(w.env);
    expect(first.hearingReminders).toBe(1);
    expect(first.monthlySummaries).toBe(0);
    const second = await runDailyJobs(w.env);
    expect(second.hearingReminders).toBe(1);
    const sent = await w.db
      .select()
      .from(schema.notificationLog)
      .where(eq(schema.notificationLog.type, 'hearing_soon'));
    expect(sent.length).toBe(1);
    expect(sent[0]!.result).toBe('ok');

    const firstOfMonth = await runDailyJobs({ ...w.env, TEST_TODAY: '2026-11-01' });
    // Only owners with something in October (the seed's "today" is 7 Oct) get a summary.
    expect(firstOfMonth.monthlySummaries).toBeGreaterThanOrEqual(2);
    const expectedSummaries = firstOfMonth.monthlySummaries;
    const summaries = await w.db
      .select()
      .from(schema.notificationLog)
      .where(eq(schema.notificationLog.type, 'monthly_summary'));
    expect(summaries.length).toBe(expectedSummaries);
    const again = await runDailyJobs({ ...w.env, TEST_TODAY: '2026-11-01' });
    expect(again.monthlySummaries).toBe(expectedSummaries);
    expect(
      (
        await w.db
          .select()
          .from(schema.notificationLog)
          .where(eq(schema.notificationLog.type, 'monthly_summary'))
      ).length,
    ).toBe(expectedSummaries);
  });
});

async function ownerPhoneOfUnit(unitId: string): Promise<string> {
  const [row] = await w.db
    .select({ phone: schema.owners.phoneE164 })
    .from(schema.unitOwnerships)
    .innerJoin(schema.owners, eq(schema.owners.id, schema.unitOwnerships.ownerId))
    .where(eq(schema.unitOwnerships.unitId, unitId))
    .limit(1);
  return row!.phone;
}
