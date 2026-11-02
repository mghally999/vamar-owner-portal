/**
 * Edges of the v2 services: subcategories, inactive lists, vendor edits, a unit outside its
 * building, work-order search and paging, cancelled orders, rule validation, event lookups,
 * calendar filters by owner, search by plot and tenant, and the owner's work-order photos.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
let editor: string;
let viewer: string;
let noor: { id: string };
let safa: { id: string };
let cats: { id: string; nameEn: string; kind: string }[];

beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
  editor = await w.staffToken('entry@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  const rows = await w.db
    .select({ id: schema.buildings.id, nameEn: schema.buildings.nameEn })
    .from(schema.buildings);
  noor = rows.find((b) => b.nameEn === 'Al Noor Tower')!;
  safa = rows.find((b) => b.nameEn === 'Al Safa Building')!;
  cats = (await w.json<{ items: typeof cats }>('/api/staff/expense-categories', { token: viewer }))
    .body.items;
});
afterAll(() => w.close());

const cat = (nameEn: string) => cats.find((c) => c.nameEn === nameEn)!;

describe('categories, vendors, rules', () => {
  it('a subcategory takes its parent kind; lists can include inactive rows', async () => {
    const parent = cat('Plumbing');
    const wrongKind = await w.json('/api/staff/expense-categories', {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ nameAr: 'x', nameEn: 'Pipes', kind: 'fixed', parentId: parent.id }),
    });
    expect(wrongKind.status).toBe(422);
    const missingParent = await w.json('/api/staff/expense-categories', {
      method: 'POST',
      token: admin,
      body: JSON.stringify({
        nameAr: 'x',
        nameEn: 'Pipes',
        kind: 'variable',
        parentId: '019a0000-0000-7000-8000-000000000001',
      }),
    });
    expect(missingParent.status).toBe(404);
    const sub = await w.json<{ id: string }>('/api/staff/expense-categories', {
      method: 'POST',
      token: admin,
      body: JSON.stringify({
        nameAr: 'أنابيب',
        nameEn: 'Pipes',
        kind: 'variable',
        parentId: parent.id,
        active: false,
      }),
    });
    expect(sub.status).toBe(201);
    const self = await w.json(`/api/staff/expense-categories/${sub.body.id}`, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ parentId: sub.body.id }),
    });
    expect(self.status).toBe(422);
    const all = await w.json<{ items: { id: string }[] }>(
      '/api/staff/expense-categories?includeInactive=1',
      { token: viewer },
    );
    expect(all.body.items.some((c) => c.id === sub.body.id)).toBe(true);
    expect(
      (
        await w.json('/api/staff/expense-categories/019a0000-0000-7000-8000-000000000001', {
          method: 'PATCH',
          token: admin,
          body: JSON.stringify({ sort: 1 }),
        })
      ).status,
    ).toBe(404);
  });

  it('vendors can be deactivated and still listed on request', async () => {
    const v = await w.json<{ id: string }>('/api/staff/vendors', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ name: 'Gone LLC' }),
    });
    const off = await w.json<{ active: boolean }>(`/api/staff/vendors/${v.body.id}`, {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ active: false }),
    });
    expect(off.body.active).toBe(false);
    const visible = await w.json<{ items: { id: string }[] }>('/api/staff/vendors', {
      token: viewer,
    });
    expect(visible.body.items.some((x) => x.id === v.body.id)).toBe(false);
    const all = await w.json<{ items: { id: string }[] }>(
      '/api/staff/vendors?includeInactive=true',
      { token: viewer },
    );
    expect(all.body.items.some((x) => x.id === v.body.id)).toBe(true);
    expect(
      (
        await w.json('/api/staff/vendors/019a0000-0000-7000-8000-000000000001', {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
  });

  it('a unit outside its building, an unknown vendor and dispute are 404s; rules are validated on update', async () => {
    const [safaUnit] = await w.db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.buildingId, safa.id));
    const wrong = await w.json('/api/staff/expenses/preview-allocation', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'unit',
        buildingId: noor.id,
        unitId: safaUnit!.id,
        invoiceDate: TODAY,
        totalFils: 100,
      }),
    });
    expect(wrong.status).toBe(404);
    const base = {
      scope: 'building',
      buildingId: noor.id,
      categoryId: cat('Painting').id,
      reasonAr: 'x',
      reasonEn: 'x',
      invoiceDate: TODAY,
      amountFils: 100,
    };
    expect(
      (
        await w.json('/api/staff/expenses', {
          method: 'POST',
          token: editor,
          body: JSON.stringify({ ...base, vendorId: '019a0000-0000-7000-8000-000000000001' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/expenses', {
          method: 'POST',
          token: editor,
          body: JSON.stringify({ ...base, disputeId: '019a0000-0000-7000-8000-000000000001' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/expenses', {
          method: 'POST',
          token: editor,
          body: JSON.stringify({ ...base, buildingId: '019a0000-0000-7000-8000-000000000001' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/expenses', {
          method: 'POST',
          token: editor,
          body: JSON.stringify({ ...base, workOrderId: '019a0000-0000-7000-8000-000000000001' }),
        })
      ).status,
    ).toBe(404);

    const rules = await w.json<{ items: { id: string; active: boolean }[] }>(
      '/api/staff/recurring-rules?includeInactive=1',
      { token: viewer },
    );
    const rule = rules.body.items[0]!;
    expect(
      (
        await w.json(`/api/staff/recurring-rules/${rule.id}`, {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ scope: 'unit', unitId: null }),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await w.json(`/api/staff/recurring-rules/${rule.id}`, {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ endDate: '2000-01-01' }),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await w.json(`/api/staff/recurring-rules/${rule.id}`, {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ categoryId: cat('Painting').id }),
        })
      ).status,
    ).toBe(422);
    const vendorChange = await w.json<{ vatFils: number; amountFils: number }>(
      `/api/staff/recurring-rules/${rule.id}`,
      {
        method: 'PATCH',
        token: editor,
        body: JSON.stringify({ vendorId: null, amountFils: 1_000 }),
      },
    );
    expect(vendorChange.body.vatFils).toBe(0);
    expect(
      (
        await w.json('/api/staff/recurring-rules/019a0000-0000-7000-8000-000000000001', {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ active: false }),
        })
      ).status,
    ).toBe(404);
    const byBuilding = await w.json<{ items: { buildingId: string }[] }>(
      `/api/staff/recurring-rules?buildingId=${noor.id}`,
      { token: viewer },
    );
    expect(byBuilding.body.items.every((r) => r.buildingId === noor.id)).toBe(true);
  });

  it('an expense draft can change vendor and VAT follows; a draft on a unit keeps single_unit', async () => {
    const [unit] = await w.db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.buildingId, noor.id));
    const [gulf] = await w.db
      .select({ id: schema.vendors.id })
      .from(schema.vendors)
      .where(eq(schema.vendors.name, 'Gulf Lifts Technical Services'));
    const draft = await w.json<{ id: string; allocationMethod: string }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'unit',
        buildingId: noor.id,
        unitId: unit!.id,
        categoryId: cat('Plumbing').id,
        reasonAr: 'x',
        reasonEn: 'x',
        invoiceDate: TODAY,
        amountFils: 10_000,
      }),
    });
    expect(draft.body.allocationMethod).toBe('single_unit');
    const withVendor = await w.json<{ vatFils: number }>(`/api/staff/expenses/${draft.body.id}`, {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ vendorId: gulf!.id }),
    });
    expect(withVendor.body.vatFils).toBe(500);
    const noUnit = await w.json(`/api/staff/expenses/${draft.body.id}`, {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ unitId: null }),
    });
    expect(noUnit.status).toBe(422);
    expect(
      (
        await w.json('/api/staff/expenses/019a0000-0000-7000-8000-000000000001', {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ amountFils: 1 }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/expenses/019a0000-0000-7000-8000-000000000001', {
          method: 'DELETE',
          token: editor,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/expenses/019a0000-0000-7000-8000-000000000001/post', {
          method: 'POST',
          token: editor,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/expenses/019a0000-0000-7000-8000-000000000001/void', {
          method: 'POST',
          token: admin,
          body: JSON.stringify({ reason: 'none' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.request('/api/staff/expenses/019a0000-0000-7000-8000-000000000001', {
          token: viewer,
        })
      ).status,
    ).toBe(404);
  });
});

describe('work orders', () => {
  it('search, paging, cancelled orders and 404s', async () => {
    const found = await w.json<{ items: { titleEn: string }[] }>(
      '/api/staff/work-orders?search=Lift',
      { token: viewer },
    );
    expect(found.body.items.some((x) => x.titleEn.includes('Lift'))).toBe(true);
    const page1 = await w.json<{ items: { id: string }[]; nextCursor: string | null }>(
      '/api/staff/work-orders?limit=2',
      { token: viewer },
    );
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await w.json<{ items: { id: string }[] }>(
      `/api/staff/work-orders?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor!)}`,
      { token: viewer },
    );
    expect(page2.body.items.some((x) => page1.body.items.some((y) => y.id === x.id))).toBe(false);
    const [cancelled] = await w.db
      .select({ id: schema.workOrders.id })
      .from(schema.workOrders)
      .where(eq(schema.workOrders.status, 'cancelled'));
    expect(
      (
        await w.json(`/api/staff/work-orders/${cancelled!.id}`, {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ status: 'open' }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await w.request('/api/staff/work-orders/019a0000-0000-7000-8000-000000000001', {
          token: viewer,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/work-orders', {
          method: 'POST',
          token: editor,
          body: JSON.stringify({
            buildingId: '019a0000-0000-7000-8000-000000000001',
            titleAr: 'x',
            titleEn: 'x',
          }),
        })
      ).status,
    ).toBe(404);
    const [safaUnit] = await w.db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.buildingId, safa.id));
    expect(
      (
        await w.json('/api/staff/work-orders', {
          method: 'POST',
          token: editor,
          body: JSON.stringify({
            buildingId: noor.id,
            unitId: safaUnit!.id,
            titleAr: 'x',
            titleEn: 'x',
          }),
        })
      ).status,
    ).toBe(404);
    const doneAtOnce = await w.json<{ completedAt: string | null }>('/api/staff/work-orders', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        buildingId: noor.id,
        titleAr: 'تم',
        titleEn: 'Done at once',
        status: 'done',
        reportedOn: addDays(TODAY, -1),
        vendorId: null,
        visibleToOwner: false,
      }),
    });
    expect(doneAtOnce.body.completedAt).not.toBeNull();
    await w.flush();
  });

  it('owners page their work orders, read the photos, and never see hidden ones', async () => {
    const fatima = await w.ownerToken('+971500000002');
    const page1 = await w.json<{
      items: { id: string; status: string; photoCount: number }[];
      nextCursor: string | null;
    }>('/api/owner/work-orders?limit=1', { token: fatima });
    expect(page1.body.items.length).toBe(1);
    if (page1.body.nextCursor) {
      const page2 = await w.json<{ items: { id: string }[] }>(
        `/api/owner/work-orders?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
        { token: fatima },
      );
      expect(page2.body.items[0]?.id).not.toBe(page1.body.items[0]!.id);
    }
    const done = await w.json<{ items: { id: string; status: string }[] }>(
      '/api/owner/work-orders?status=done',
      { token: fatima },
    );
    expect(done.body.items.every((x) => x.status === 'done')).toBe(true);
    const ac = (
      await w.json<{ items: { id: string; titleEn: string }[] }>('/api/owner/work-orders', {
        token: fatima,
      })
    ).body.items.find((x) => x.titleEn === 'AC not cooling')!;
    const detail = await w.json<{ attachments: { id: string }[] }>(
      `/api/owner/work-orders/${ac.id}`,
      { token: fatima },
    );
    const photo = await w.request(`/api/owner/attachments/${detail.body.attachments[0]!.id}`, {
      token: fatima,
    });
    expect(photo.status).toBe(200);
    const khalid = await w.ownerToken('+971500000001');
    expect(
      (
        await w.request(`/api/owner/attachments/${detail.body.attachments[0]!.id}`, {
          token: khalid,
        })
      ).status,
    ).toBe(404);
    const [hidden] = await w.db
      .select({ id: schema.workOrders.id })
      .from(schema.workOrders)
      .where(eq(schema.workOrders.visibleToOwner, false));
    expect(
      (await w.request(`/api/owner/work-orders/${hidden!.id}`, { token: khalid })).status,
    ).toBe(404);
    expect(
      (
        await w.request('/api/owner/attachments/019a0000-0000-7000-8000-000000000001', {
          token: khalid,
        })
      ).status,
    ).toBe(404);
  });
});

describe('calendar, search, records', () => {
  it('events are looked up and the staff calendar filters by owner and unit', async () => {
    expect(
      (
        await w.request('/api/staff/calendar-events/019a0000-0000-7000-8000-000000000001', {
          token: viewer,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/calendar-events/019a0000-0000-7000-8000-000000000001', {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ notes: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/calendar-events/019a0000-0000-7000-8000-000000000001', {
          method: 'DELETE',
          token: editor,
        })
      ).status,
    ).toBe(404);
    const khalidId = w.ids.owners['+971500000001']!;
    const [unit] = await w.db
      .select({ unitId: schema.unitOwnerships.unitId })
      .from(schema.unitOwnerships)
      .where(
        and(eq(schema.unitOwnerships.ownerId, khalidId), isNull(schema.unitOwnerships.toDate)),
      );
    const byOwner = await w.json<{ items: { kind: string; unitId: string | null }[] }>(
      `/api/staff/calendar?from=2026-01-01&to=2026-12-31&ownerId=${khalidId}&kinds=cheque_due,event,work_order,hearing,contract_end`,
      { token: viewer },
    );
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.items.length).toBeGreaterThan(0);
    const byUnit = await w.json<{ items: { kind: string; unitId: string | null }[] }>(
      `/api/staff/calendar?from=2026-01-01&to=2026-12-31&unitId=${unit!.unitId}`,
      { token: viewer },
    );
    expect(
      byUnit.body.items
        .filter((i) => i.kind === 'cheque_due')
        .every((i) => i.unitId === unit!.unitId),
    ).toBe(true);
    const ev = (
      await w.json<{ items: { kind: string; entityId: string }[] }>(
        '/api/staff/calendar?from=2026-01-01&to=2027-01-31&kinds=event',
        { token: viewer },
      )
    ).body.items[0]!;
    const got = await w.json<{ id: string }>(`/api/staff/calendar-events/${ev.entityId}`, {
      token: viewer,
    });
    expect(got.body.id).toBe(ev.entityId);
    const all = await w.json<{ items: unknown[] }>('/api/staff/holidays', { token: viewer });
    expect(all.body.items.length).toBeGreaterThanOrEqual(29);
  });

  it('search by plot, building name and tenant; unit status history of an untouched unit is empty', async () => {
    const byPlot = await w.json<{ items: { type: string }[] }>('/api/staff/search?q=346-1180', {
      token: viewer,
    });
    expect(byPlot.body.items.some((h) => h.type === 'building' || h.type === 'unit')).toBe(true);
    const byTenant = await w.json<{ items: { type: string }[] }>(
      '/api/staff/search?q=Ahmed Saeed',
      { token: viewer },
    );
    expect(byTenant.body.items.some((h) => h.type === 'tenant')).toBe(true);
    const short = await w.json<{ items: { type: string }[] }>('/api/staff/search?q=ab&limit=3', {
      token: viewer,
    });
    expect(short.body.items.length).toBeLessThanOrEqual(3);
    const [unit] = await w.db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.buildingId, noor.id));
    const history = await w.json<{ items: unknown[] }>(
      `/api/staff/units/${unit!.id}/status-history`,
      { token: viewer },
    );
    expect(history.body.items).toEqual([]);
    expect(
      (
        await w.json('/api/staff/units/019a0000-0000-7000-8000-000000000001/status', {
          method: 'POST',
          token: editor,
          body: JSON.stringify({ status: 'reserved', reason: 'deposit' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/units/019a0000-0000-7000-8000-000000000001/identifiers', {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ plotNo: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.json('/api/staff/buildings/019a0000-0000-7000-8000-000000000001/identifiers', {
          method: 'PATCH',
          token: editor,
          body: JSON.stringify({ plotNo: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.request('/api/staff/units/019a0000-0000-7000-8000-000000000001/timeline', {
          token: viewer,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.request('/api/staff/buildings/019a0000-0000-7000-8000-000000000001/timeline', {
          token: viewer,
        })
      ).status,
    ).toBe(404);
    const noKinds = await w.json<{ items: unknown[] }>(
      `/api/staff/units/${unit!.id}/timeline?kinds=`,
      { token: viewer },
    );
    expect(noKinds.status).toBe(200);
  });
});
