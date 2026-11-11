/**
 * Owner approval of large repairs: the threshold, who is asked (shares on the date), answers,
 * the blocked start and post, the admin override with its reason, approval by silence through
 * the daily cron, owner isolation and the roles.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays, type PlainDate } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyJobs } from '../src/cron.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
let editor: string;
let viewer: string;
const tok: Record<'khalid' | 'fatima' | 'omar' | 'mariam' | 'rashid', string> = {
  khalid: '',
  fatima: '',
  omar: '',
  mariam: '',
  rashid: '',
};
const oid: Record<keyof typeof tok, string> = { ...tok };
const PHONES = {
  khalid: '+971500000001',
  fatima: '+971500000002',
  omar: '+971500000003',
  mariam: '+971500000004',
  rashid: '+971500000005',
} as const;
let b: Record<'noor' | 'safa' | 'khan' | 'mamzar', string>;
let unitIds: Record<string, string>;
let plumbing: string;
let salaries: string;

interface StaffApproval {
  id: string;
  ownerId: string;
  nameEn: string;
  amountFils: number;
  shareFils: number;
  status: string;
  note: string | null;
  askedOn: string;
  deadline: string | null;
  overriddenAt: string | null;
  overrideReason: string | null;
  overriddenByName: string | null;
}
interface Approvals {
  source: 'work_order' | 'expense' | null;
  state: string;
  items: StaffApproval[];
}
interface OwnerApproval {
  id: string;
  kind: string;
  titleEn: string;
  amountFils: number;
  shareFils: number;
  status: string;
  note: string | null;
  deadline: string | null;
  canAnswer: boolean;
  vendorName: string | null;
  description?: string;
  attachments?: { id: string }[];
}

async function createJob(body: Record<string, unknown>, token = editor) {
  return w.json<{ id: string; status: string; estimateFils: number | null }>(
    '/api/staff/work-orders',
    {
      method: 'POST',
      token,
      body: JSON.stringify({ titleAr: 'إصلاح', titleEn: 'Repair', ...body }),
    },
  );
}
const job = (id: string) =>
  w.json<{ status: string; estimateFils: number | null; approvals: Approvals }>(
    `/api/staff/work-orders/${id}`,
    { token: viewer },
  );
const patchJob = (id: string, body: Record<string, unknown>, token = editor) =>
  w.json<{ status: string; error?: { code: string } }>(`/api/staff/work-orders/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  });
const answer = (id: string, token: string, decision: 'approve' | 'reject', note?: string) =>
  w.json<OwnerApproval & { error?: { code: string } }>(`/api/owner/approvals/${id}`, {
    method: 'POST',
    token,
    body: JSON.stringify(note === undefined ? { decision } : { decision, note }),
  });
const mine = async (token: string) =>
  (await w.json<{ items: OwnerApproval[] }>('/api/owner/approvals', { token })).body.items;
const approvalIdFor = async (jobId: string, owner: keyof typeof tok) =>
  (await job(jobId)).body.approvals.items.find((a) => a.ownerId === oid[owner])!.id;
const auditRows = (action: string) =>
  w.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action));

beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
  editor = await w.staffToken('entry@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  for (const k of Object.keys(PHONES) as (keyof typeof PHONES)[]) {
    tok[k] = await w.ownerToken(PHONES[k]);
    oid[k] = w.ids.owners[PHONES[k]]!;
  }
  const buildings = await w.db
    .select({ id: schema.buildings.id, nameEn: schema.buildings.nameEn })
    .from(schema.buildings);
  const byName = (n: string) => buildings.find((x) => x.nameEn === n)!.id;
  b = {
    noor: byName('Al Noor Tower'),
    safa: byName('Al Safa Building'),
    khan: byName('Al Khan Residence'),
    mamzar: byName('Mamzar Villas'),
  };
  const units = await w.db
    .select({
      id: schema.units.id,
      unitNo: schema.units.unitNo,
      buildingId: schema.units.buildingId,
    })
    .from(schema.units);
  unitIds = Object.fromEntries(
    units.map((u) => [`${buildings.find((x) => x.id === u.buildingId)!.nameEn}/${u.unitNo}`, u.id]),
  );
  const cats = await w.db.select().from(schema.expenseCategories);
  plumbing = cats.find((c) => c.nameEn === 'Plumbing')!.id;
  salaries = cats.find((c) => c.nameEn.startsWith('Building staff salaries'))!.id;
  // Every owner has a phone that accepts pushes, so the request push is recorded as sent.
  for (const id of Object.values(oid))
    await w.db.insert(schema.devices).values({
      ownerId: id,
      deviceId: `a-${id.slice(0, 8)}`,
      platform: 'android',
      pushToken: 'ExponentPushToken[approvals]',
    });
});
afterAll(() => w.close());

describe('who is asked, and when', () => {
  it('asks at or above the AED 5,000 threshold, every owner of the unit with their share', async () => {
    const below = await createJob({
      buildingId: b.safa,
      unitId: unitIds['Al Safa Building/302'],
      estimateFils: 499_999,
    });
    expect(below.status).toBe(201);
    expect((await job(below.body.id)).body.approvals).toEqual({
      source: null,
      state: 'none',
      items: [],
    });

    const at = await createJob({
      buildingId: b.safa,
      unitId: unitIds['Al Safa Building/302'],
      titleEn: 'Replace water heater',
      titleAr: 'تبديل سخان الماء',
      estimateFils: 500_000,
    });
    expect(at.status).toBe(201);
    expect(at.body.estimateFils).toBe(500_000);
    const detail = (await job(at.body.id)).body.approvals;
    expect(detail.source).toBe('work_order');
    expect(detail.state).toBe('pending');
    // Fatima 60 %, Omar 40 %.
    expect(
      detail.items.map((a) => [
        a.nameEn,
        a.shareFils,
        a.amountFils,
        a.status,
        a.askedOn,
        a.deadline,
      ]),
    ).toEqual([
      ['Fatima Al Suwaidi', 300_000, 500_000, 'pending', TODAY, addDays(TODAY, 3)],
      ['Omar Haddad', 200_000, 500_000, 'pending', TODAY, addDays(TODAY, 3)],
    ]);
    expect(
      (await auditRows('repair_approval.request')).some((r) => r.entityId === at.body.id),
    ).toBe(true);

    await w.flush();
    const pushes = await w.db
      .select()
      .from(schema.notificationLog)
      .where(eq(schema.notificationLog.type, 'repair_approval_needed'));
    const ids = detail.items.map((a) => a.id);
    expect(
      pushes.filter((p) => ids.includes(p.entityId)).map((p) => [p.ownerId, p.result]),
    ).toEqual(
      expect.arrayContaining([
        [oid.fatima, 'ok'],
        [oid.omar, 'ok'],
      ]),
    );
  });

  it('a building-wide job asks the owners of the whole building by their share of it', async () => {
    const res = await createJob({ buildingId: b.mamzar, estimateFils: 1_000_000 });
    const items = (await job(res.body.id)).body.approvals.items;
    // Four villas of the same size, each 50 / 30 / 20.
    expect(Object.fromEntries(items.map((a) => [a.nameEn, a.shareFils]))).toEqual({
      'Rashid Bin Touq': 500_000,
      'Khalid Al Mansoori': 300_000,
      'Omar Haddad': 200_000,
    });
    expect(items.reduce((s, a) => s + a.shareFils, 0)).toBe(1_000_000);
  });

  it('asks the owners on the day: after a sale the buyer, and an expense the owners on its invoice date', async () => {
    const unitId = unitIds['Al Safa Building/301']!;
    const saleDate = addDays(TODAY, -10);
    await w.db
      .update(schema.unitOwnerships)
      .set({ toDate: saleDate })
      .where(eq(schema.unitOwnerships.unitId, unitId));
    await w.db.insert(schema.unitOwnerships).values({
      unitId,
      ownerId: oid.mariam,
      shareBp: 10_000,
      fromDate: saleDate,
      toDate: null,
    });
    const res = await createJob({ buildingId: b.safa, unitId, estimateFils: 800_000 });
    expect((await job(res.body.id)).body.approvals.items.map((a) => a.nameEn)).toEqual([
      'Mariam Al Qasimi',
    ]);

    // An expense invoiced before the sale is shared (and asked) by the sellers, 60 / 40.
    const x = await w.json<{ id: string }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'unit',
        buildingId: b.safa,
        unitId,
        categoryId: plumbing,
        reasonAr: 'تبديل أنابيب الحمام',
        reasonEn: 'Bathroom pipes replaced',
        invoiceDate: addDays(TODAY, -20),
        amountFils: 600_000,
      }),
    });
    expect(x.status).toBe(201);
    const xd = await w.json<{ approvals: Approvals }>(`/api/staff/expenses/${x.body.id}`, {
      token: viewer,
    });
    expect(xd.body.approvals.source).toBe('expense');
    expect(xd.body.approvals.items.map((a) => [a.nameEn, a.shareFils])).toEqual([
      ['Fatima Al Suwaidi', 360_000],
      ['Omar Haddad', 240_000],
    ]);
  });

  it('fixed costs, hidden jobs and amounts under the threshold never ask', async () => {
    const fixed = await w.json<{ id: string }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: b.khan,
        categoryId: salaries,
        reasonAr: 'رواتب',
        reasonEn: 'Salaries',
        invoiceDate: TODAY,
        amountFils: 2_000_000,
      }),
    });
    expect(fixed.status).toBe(201);
    const fd = await w.json<{ approvals: Approvals }>(`/api/staff/expenses/${fixed.body.id}`, {
      token: viewer,
    });
    expect(fd.body.approvals.state).toBe('none');
    const hidden = await createJob({
      buildingId: b.khan,
      estimateFils: 2_000_000,
      visibleToOwner: false,
    });
    expect((await job(hidden.body.id)).body.approvals.items).toEqual([]);
  });
});

describe('the gate', () => {
  it('a job cannot start or be marked done while an answer is pending or rejected', async () => {
    const res = await createJob({
      buildingId: b.safa,
      unitId: unitIds['Al Safa Building/302'],
      estimateFils: 900_000,
    });
    const id = res.body.id;
    const start = await patchJob(id, { status: 'in_progress' });
    expect(start.status).toBe(409);
    expect(start.body.error?.code).toBe('approval_required');
    expect((await patchJob(id, { status: 'done' })).status).toBe(409);
    // Scheduling is not starting.
    expect((await patchJob(id, { status: 'scheduled' })).status).toBe(200);
    expect((await job(id)).body.status).toBe('scheduled');

    const fatima = await approvalIdFor(id, 'fatima');
    const omar = await approvalIdFor(id, 'omar');
    const yes = await answer(fatima, tok.fatima, 'approve', 'تمام');
    expect(yes.status).toBe(200);
    expect(yes.body.status).toBe('approved');
    expect(yes.body.canAnswer).toBe(false);
    expect((await patchJob(id, { status: 'in_progress' })).status).toBe(409);
    const no = await answer(omar, tok.omar, 'reject', 'Too expensive, get a second quote');
    expect(no.body.status).toBe('rejected');
    expect((await job(id)).body.approvals.state).toBe('rejected');
    expect((await patchJob(id, { status: 'in_progress' })).body.error?.code).toBe(
      'approval_required',
    );
    // Every answer is an audit row by the owner.
    const answers = (await auditRows('repair_approval.answer')).filter((r) =>
      [fatima, omar].includes(r.entityId ?? ''),
    );
    expect(answers.map((r) => [r.actorType, r.actorId])).toEqual(
      expect.arrayContaining([
        ['owner', oid.fatima],
        ['owner', oid.omar],
      ]),
    );
    // An answer is final.
    expect((await answer(omar, tok.omar, 'approve')).status).toBe(409);
  });

  it('all approvals let the job start without an override', async () => {
    const res = await createJob({
      buildingId: b.mamzar,
      unitId: unitIds['Mamzar Villas/V1'],
      estimateFils: 600_000,
    });
    for (const o of ['rashid', 'khalid', 'omar'] as const)
      expect((await answer(await approvalIdFor(res.body.id, o), tok[o], 'approve')).status).toBe(
        200,
      );
    expect((await job(res.body.id)).body.approvals.state).toBe('approved');
    expect((await patchJob(res.body.id, { status: 'in_progress' })).status).toBe(200);
  });

  it('the question cannot be skipped by creating the job started or saving the estimate with the start', async () => {
    const before = (await w.db.select({ id: schema.workOrders.id }).from(schema.workOrders)).length;
    const started = await createJob({
      buildingId: b.khan,
      unitId: unitIds['Al Khan Residence/101'],
      status: 'in_progress',
      estimateFils: 700_000,
    });
    expect(started.status).toBe(409);
    expect((await w.db.select({ id: schema.workOrders.id }).from(schema.workOrders)).length).toBe(
      before,
    );

    const open = await createJob({ buildingId: b.khan, unitId: unitIds['Al Khan Residence/101'] });
    const both = await patchJob(open.body.id, { estimateFils: 700_000, status: 'in_progress' });
    expect(both.status).toBe(409);
    // Nothing of that request was kept: no estimate, nobody asked.
    const after = await job(open.body.id);
    expect(after.body.estimateFils).toBeNull();
    expect(after.body.approvals.items).toEqual([]);
    // Saving the estimate alone asks the owner.
    expect((await patchJob(open.body.id, { estimateFils: 700_000 })).status).toBe(200);
    expect((await job(open.body.id)).body.approvals.items.map((a) => a.nameEn)).toEqual([
      'Mariam Al Qasimi',
    ]);
  });

  it('a higher estimate than the one approved asks again', async () => {
    const res = await createJob({
      buildingId: b.khan,
      unitId: unitIds['Al Khan Residence/102'],
      estimateFils: 500_000,
    });
    const first = await approvalIdFor(res.body.id, 'mariam');
    await answer(first, tok.mariam, 'approve');
    // Lower or equal: the approval stands.
    await patchJob(res.body.id, { estimateFils: 450_000 });
    expect((await job(res.body.id)).body.approvals.state).toBe('approved');
    await patchJob(res.body.id, { estimateFils: 650_000 });
    const again = (await job(res.body.id)).body.approvals;
    expect(again.state).toBe('pending');
    expect(again.items.map((a) => [a.amountFils, a.status])).toEqual([[650_000, 'pending']]);
    expect((await auditRows('repair_approval.reask')).some((r) => r.entityId === res.body.id)).toBe(
      true,
    );
  });

  it('an admin overrides with a written reason; editors cannot', async () => {
    const res = await createJob({
      buildingId: b.safa,
      unitId: unitIds['Al Safa Building/302'],
      estimateFils: 1_200_000,
    });
    await answer(await approvalIdFor(res.body.id, 'omar'), tok.omar, 'reject');
    const url = `/api/staff/work-orders/${res.body.id}/approvals/override`;
    const body = JSON.stringify({ reason: 'Water leaking into the unit below; cannot wait' });
    expect((await w.json(url, { method: 'POST', token: editor, body })).status).toBe(403);
    expect(
      (await w.json(url, { method: 'POST', token: admin, body: JSON.stringify({ reason: 'x' }) }))
        .status,
    ).toBe(422);
    const ok = await w.json<{ items: { overrideReason: string }[] }>(url, {
      method: 'POST',
      token: admin,
      body,
    });
    expect(ok.status).toBe(200);
    // Fatima (pending) and Omar (rejected) both overridden; the answers themselves stay.
    expect(ok.body.items).toHaveLength(2);
    const d = (await job(res.body.id)).body.approvals;
    expect(d.state).toBe('overridden');
    expect(d.items.map((a) => [a.nameEn, a.status, a.overrideReason, a.overriddenByName])).toEqual([
      [
        'Fatima Al Suwaidi',
        'pending',
        'Water leaking into the unit below; cannot wait',
        'Salem Al Marri',
      ],
      [
        'Omar Haddad',
        'rejected',
        'Water leaking into the unit below; cannot wait',
        'Salem Al Marri',
      ],
    ]);
    const audit = (await auditRows('repair_approval.override')).find(
      (r) => r.entityId === res.body.id,
    );
    expect(audit?.actorType).toBe('staff');
    expect(audit?.after).toMatchObject({
      reason: 'Water leaking into the unit below; cannot wait',
    });
    expect((await patchJob(res.body.id, { status: 'in_progress' })).status).toBe(200);
    // Nothing left to override.
    expect((await w.json(url, { method: 'POST', token: admin, body })).status).toBe(409);
    expect(
      (
        await w.json(
          '/api/staff/work-orders/019a0000-0000-7000-8000-000000000001/approvals/override',
          {
            method: 'POST',
            token: admin,
            body,
          },
        )
      ).status,
    ).toBe(404);
  });

  it('a variable expense draft cannot be posted until approved; one paying for an asked job uses its answers', async () => {
    const create = (extra: Record<string, unknown>) =>
      w.json<{ id: string }>('/api/staff/expenses', {
        method: 'POST',
        token: editor,
        body: JSON.stringify({
          scope: 'unit',
          buildingId: b.khan,
          unitId: unitIds['Al Khan Residence/201'],
          categoryId: plumbing,
          reasonAr: 'استبدال مضخة المياه',
          reasonEn: 'Water pump replaced',
          invoiceDate: TODAY,
          amountFils: 550_000,
          ...extra,
        }),
      });
    const post = (id: string) =>
      w.json<{ error?: { code: string } }>(`/api/staff/expenses/${id}/post`, {
        method: 'POST',
        token: editor,
      });
    const x = await create({});
    const blocked = await post(x.body.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.code).toBe('approval_required');
    const [mariamAsk] = (await mine(tok.mariam)).filter((a) => a.titleEn === 'Water pump replaced');
    expect(mariamAsk?.kind).toBe('expense');
    expect(mariamAsk?.canAnswer).toBe(true);
    await answer(mariamAsk!.id, tok.mariam, 'approve');
    expect((await post(x.body.id)).status).toBe(200);
    // A posted expense is no longer waiting: answering is closed.
    expect((await answer(mariamAsk!.id, tok.mariam, 'reject')).status).toBe(409);

    // The expense of a job the owners were asked about is not asked again; their answers decide.
    const wo = await createJob({
      buildingId: b.khan,
      unitId: unitIds['Al Khan Residence/202'],
      estimateFils: 600_000,
    });
    const linked = await create({
      unitId: unitIds['Al Khan Residence/202'],
      workOrderId: wo.body.id,
    });
    const ld = await w.json<{ approvals: Approvals }>(`/api/staff/expenses/${linked.body.id}`, {
      token: viewer,
    });
    expect(ld.body.approvals.source).toBe('work_order');
    expect((await post(linked.body.id)).status).toBe(409);
    await answer(await approvalIdFor(wo.body.id, 'mariam'), tok.mariam, 'approve');
    expect((await post(linked.body.id)).status).toBe(200);

    // Under the threshold: posted straight away.
    const small = await create({ amountFils: 100_000 });
    expect((await post(small.body.id)).status).toBe(200);
  });
});

describe('silence', () => {
  it('the daily job approves answers left N days, notes it for staff, and 0 days turns it off', async () => {
    const res = await createJob({
      buildingId: b.safa,
      unitId: unitIds['Al Safa Building/302'],
      estimateFils: 1_500_000,
    });
    const fatima = await approvalIdFor(res.body.id, 'fatima');
    const omar = await approvalIdFor(res.body.id, 'omar');
    // Fatima was asked 3 days ago (due today), Omar 2 days ago (due tomorrow).
    await w.db
      .update(schema.repairApprovals)
      .set({ askedOn: addDays(TODAY, -3) })
      .where(eq(schema.repairApprovals.id, fatima));
    await w.db
      .update(schema.repairApprovals)
      .set({ askedOn: addDays(TODAY, -2) })
      .where(eq(schema.repairApprovals.id, omar));

    // Off: nothing changes.
    expect(
      (
        await w.json('/api/staff/settings', {
          method: 'PATCH',
          token: admin,
          body: JSON.stringify({ repairApprovalSilenceDays: 0 }),
        })
      ).status,
    ).toBe(200);
    expect((await runDailyJobs(w.env)).silentApprovals).toBe(0);
    expect((await job(res.body.id)).body.approvals.items.every((a) => a.deadline === null)).toBe(
      true,
    );

    await w.json('/api/staff/settings', {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ repairApprovalSilenceDays: 3 }),
    });
    const summary = await runDailyJobs(w.env);
    expect(summary.errors).toEqual([]);
    expect(summary.silentApprovals).toBeGreaterThanOrEqual(1);
    const items = (await job(res.body.id)).body.approvals.items;
    expect(items.map((a) => [a.nameEn, a.status])).toEqual([
      ['Fatima Al Suwaidi', 'approved_by_silence'],
      ['Omar Haddad', 'pending'],
    ]);
    const audit = (await auditRows('repair_approval.silence')).find((r) => r.entityId === fatima);
    expect(audit?.actorType).toBe('system');
    // Staff see it on the Today panel.
    const today = await w.json<{
      ownerApprovals: { workOrders: number; silentLast7Days: number; rejected: number };
    }>('/api/staff/today', { token: viewer });
    expect(today.body.ownerApprovals.silentLast7Days).toBeGreaterThanOrEqual(1);
    expect(today.body.ownerApprovals.workOrders).toBeGreaterThanOrEqual(1);

    // The next day Omar's silence counts too, and the job may start.
    const next = await runDailyJobs({ ...w.env, TEST_TODAY: addDays(TODAY, 1) });
    expect(next.silentApprovals).toBeGreaterThanOrEqual(1);
    expect((await job(res.body.id)).body.approvals.state).toBe('approved');
    expect((await patchJob(res.body.id, { status: 'in_progress' })).status).toBe(200);
    // A re-run changes nothing.
    expect((await runDailyJobs({ ...w.env, TEST_TODAY: addDays(TODAY, 1) })).silentApprovals).toBe(
      0,
    );
  });
});

describe('owners', () => {
  it('see their own requests with share, vendor, reason, photos and the silence deadline', async () => {
    // The seeded fire inspection at Al Noor waits for Khalid, asked yesterday.
    const list = await mine(tok.khalid);
    const fire = list.find((a) => a.titleEn === 'Annual fire system inspection');
    expect(fire).toMatchObject({
      kind: 'work_order',
      status: 'pending',
      amountFils: 1_850_000,
      shareFils: 1_850_000,
      canAnswer: true,
      deadline: addDays(addDays(TODAY, -1), 3) as PlainDate,
      vendorName: 'Al Hamad Facilities Management LLC',
    });
    // Pending first.
    expect(list[0]?.status).toBe('pending');

    const [woRow] = await w.db
      .select({ id: schema.workOrders.id })
      .from(schema.workOrders)
      .where(eq(schema.workOrders.titleEn, 'Annual fire system inspection'));
    const key = `work_order/${woRow!.id}/quote.jpeg`;
    await w.r2.put(key, new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const [att] = await w.db
      .insert(schema.attachments)
      .values({
        entityType: 'work_order',
        entityId: woRow!.id,
        r2Key: key,
        mime: 'image/jpeg',
        sizeBytes: 3,
        fileName: 'quote.jpg',
      })
      .returning();
    const detail = await w.json<OwnerApproval>(`/api/owner/approvals/${fire!.id}`, {
      token: tok.khalid,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.description).toContain('الدفاع المدني');
    expect(detail.body.attachments?.map((a) => a.id)).toEqual([att!.id]);
    expect(
      (await w.request(`/api/owner/attachments/${att!.id}`, { token: tok.khalid })).status,
    ).toBe(200);
  });

  it('owner A gets 404 on owner B’s request, for reading and answering', async () => {
    const [fireAsk] = (await mine(tok.khalid)).filter(
      (a) => a.titleEn === 'Annual fire system inspection',
    );
    expect(
      (await w.request(`/api/owner/approvals/${fireAsk!.id}`, { token: tok.mariam })).status,
    ).toBe(404);
    const res = await answer(fireAsk!.id, tok.mariam, 'approve');
    expect(res.status).toBe(404);
    expect((await mine(tok.mariam)).some((a) => a.id === fireAsk!.id)).toBe(false);
    // Still pending: Mariam's attempt changed nothing.
    const [row] = await w.db
      .select({ status: schema.repairApprovals.status })
      .from(schema.repairApprovals)
      .where(eq(schema.repairApprovals.id, fireAsk!.id));
    expect(row?.status).toBe('pending');
  });

  it('a draft expense photo opens for the owners asked about it and no one else', async () => {
    const x = await w.json<{ id: string }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'unit',
        buildingId: b.noor,
        unitId: unitIds['Al Noor Tower/801'],
        categoryId: plumbing,
        reasonAr: 'تبديل خط المياه الرئيسي',
        reasonEn: 'Main water line replaced',
        invoiceDate: TODAY,
        amountFils: 700_000,
      }),
    });
    const key = `expense/${x.body.id}/quote.jpeg`;
    await w.r2.put(key, new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const [att] = await w.db
      .insert(schema.attachments)
      .values({
        entityType: 'expense',
        entityId: x.body.id,
        r2Key: key,
        mime: 'image/jpeg',
        sizeBytes: 3,
        fileName: 'quote.jpg',
      })
      .returning();
    expect(
      (await w.request(`/api/owner/attachments/${att!.id}`, { token: tok.khalid })).status,
    ).toBe(200);
    expect((await w.request(`/api/owner/attachments/${att!.id}`, { token: tok.omar })).status).toBe(
      404,
    );
  });
});

describe('staff lists, settings and roles', () => {
  it('filters the lists to jobs awaiting approval, with the state on every row', async () => {
    const wos = await w.json<{
      items: { id: string; titleEn: string; approvalState: string; status: string }[];
    }>('/api/staff/work-orders?approval=awaiting&limit=100', { token: viewer });
    expect(wos.status).toBe(200);
    expect(wos.body.items.length).toBeGreaterThan(0);
    expect(wos.body.items.every((r) => ['pending', 'rejected'].includes(r.approvalState))).toBe(
      true,
    );
    expect(wos.body.items.every((r) => ['open', 'scheduled'].includes(r.status))).toBe(true);
    expect(wos.body.items.some((r) => r.titleEn === 'Annual fire system inspection')).toBe(true);
    const all = await w.json<{ items: { titleEn: string; approvalState: string }[] }>(
      '/api/staff/work-orders?limit=100',
      { token: viewer },
    );
    expect(
      all.body.items.find((r) => r.titleEn === 'Refurbishment before letting')?.approvalState,
    ).toBe('approved');
    expect(all.body.items.find((r) => r.titleEn === 'AC not cooling')?.approvalState).toBe('none');

    const xs = await w.json<{
      items: { reasonEn: string; approvalState: string; status: string }[];
    }>('/api/staff/expenses?approval=awaiting&limit=100', { token: viewer });
    expect(xs.status).toBe(200);
    expect(xs.body.items.map((r) => r.reasonEn)).toEqual(
      expect.arrayContaining(['Main water line replaced', 'Bathroom pipes replaced']),
    );
    expect(xs.body.items.every((r) => r.status === 'draft' && r.approvalState === 'pending')).toBe(
      true,
    );
  });

  it('the threshold is an admin setting and applies to the next job', async () => {
    const forbidden = await w.json('/api/staff/settings', {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ repairApprovalThresholdFils: 1_000_000 }),
    });
    expect(forbidden.status).toBe(403);
    const ok = await w.json<{ repairApprovalThresholdFils: number }>('/api/staff/settings', {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ repairApprovalThresholdFils: 1_000_000 }),
    });
    expect(ok.body.repairApprovalThresholdFils).toBe(1_000_000);
    const res = await createJob({
      buildingId: b.khan,
      unitId: unitIds['Al Khan Residence/301'],
      estimateFils: 900_000,
    });
    expect((await job(res.body.id)).body.approvals.items).toEqual([]);
    await w.json('/api/staff/settings', {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ repairApprovalThresholdFils: 500_000 }),
    });
  });

  it('viewers read but do not write; owners and staff stay on their own side', async () => {
    expect((await createJob({ buildingId: b.khan, estimateFils: 900_000 }, viewer)).status).toBe(
      403,
    );
    const [any] = await w.db
      .select({ id: schema.repairApprovals.id, workOrderId: schema.repairApprovals.workOrderId })
      .from(schema.repairApprovals)
      .where(
        and(
          eq(schema.repairApprovals.ownerId, oid.khalid),
          inArray(schema.repairApprovals.status, ['pending']),
        ),
      )
      .limit(1);
    expect((await w.request('/api/owner/approvals', { token: editor })).status).toBe(403);
    expect(
      (
        await w.json(`/api/owner/approvals/${any!.id}`, {
          method: 'POST',
          token: admin,
          body: JSON.stringify({ decision: 'approve' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await w.request(`/api/staff/work-orders/${any!.workOrderId}`, { token: tok.khalid })).status,
    ).toBe(403);
    expect(
      (
        await w.json(`/api/staff/work-orders/${any!.workOrderId}/approvals/override`, {
          method: 'POST',
          token: viewer,
          body: JSON.stringify({ reason: 'trying' }),
        })
      ).status,
    ).toBe(403);
    expect((await w.request('/api/owner/approvals')).status).toBe(401);
  });
});
