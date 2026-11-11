/**
 * Bulk actions on expenses: post and discard drafts, show and hide posted ones. All or nothing,
 * with every refused expense listed (an approval-blocked draft among them), the roles, and the
 * same allocations, audit rows and push as the single actions. Discarded recurring drafts are
 * not made again by the daily job.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyJobs } from '../src/cron.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
let editor: string;
let viewer: string;
let noor: string;
let khan: string;
let khan201: string;
let cat: (nameEn: string) => string;

interface Rejection {
  id: string;
  invoiceNo: string | null;
  reasonEn: string | null;
  status: string | null;
  code: string;
}
interface BulkBody {
  updated: string[];
  unchanged: string[];
  notified: number;
  error?: { code: string; details?: { rejected: Rejection[] } };
}

const MISSING = '018f3f1e-7b4a-7c1d-9a2b-3c4d5e6f7a8b';

const draft = async (extra: Record<string, unknown> = {}) => {
  const res = await w.json<{ id: string; status: string }>('/api/staff/expenses', {
    method: 'POST',
    token: editor,
    body: JSON.stringify({
      scope: 'building',
      buildingId: noor,
      categoryId: cat('Internet and intercom'),
      reasonAr: 'اشتراك الإنترنت',
      reasonEn: 'Internet subscription',
      invoiceDate: TODAY,
      amountFils: 30_000,
      ...extra,
    }),
  });
  expect(res.status).toBe(201);
  return res.body.id;
};
const bulk = (body: Record<string, unknown>, token = editor) =>
  w.json<BulkBody>('/api/staff/expenses/bulk', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
const row = async (id: string) =>
  (await w.db.select().from(schema.expenses).where(eq(schema.expenses.id, id)))[0];
const allocations = (id: string) =>
  w.db
    .select({
      ownerId: schema.expenseAllocations.ownerId,
      unitId: schema.expenseAllocations.unitId,
      amountFils: schema.expenseAllocations.amountFils,
    })
    .from(schema.expenseAllocations)
    .where(eq(schema.expenseAllocations.expenseId, id));
const auditFor = (action: string, ids: string[]) =>
  w.db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, action), inArray(schema.auditLog.entityId, ids)));
const sorted = <T extends { unitId: string }>(xs: T[]) =>
  [...xs].sort((a, b) => a.unitId.localeCompare(b.unitId));

beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
  editor = await w.staffToken('entry@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  const buildings = await w.db
    .select({ id: schema.buildings.id, nameEn: schema.buildings.nameEn })
    .from(schema.buildings);
  noor = buildings.find((b) => b.nameEn === 'Al Noor Tower')!.id;
  khan = buildings.find((b) => b.nameEn === 'Al Khan Residence')!.id;
  const [u] = await w.db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(and(eq(schema.units.buildingId, khan), eq(schema.units.unitNo, '201')));
  khan201 = u!.id;
  const cats = await w.db.select().from(schema.expenseCategories);
  cat = (nameEn) => cats.find((c) => c.nameEn.startsWith(nameEn))!.id;
});
afterAll(() => w.close());

describe('post', () => {
  const posted: string[] = [];

  it('posts several drafts with the allocations, audit rows and push a single post makes', async () => {
    const small = await draft();
    const large = await draft({
      categoryId: cat('Building staff salaries'),
      reasonAr: 'رواتب الحارس',
      reasonEn: 'Guard salary',
      amountFils: 600_000,
    });
    // The same small draft posted on its own, to compare against.
    const single = await draft();
    const one = await w.json(`/api/staff/expenses/${single}/post`, {
      method: 'POST',
      token: editor,
    });
    expect(one.status).toBe(200);

    const res = await bulk({ ids: [small, large, small], action: 'post', note: 'Month end' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual([small, large]);
    expect(res.body.notified).toBe(1);
    expect((await row(small))?.status).toBe('posted');
    expect((await row(large))?.status).toBe('posted');
    posted.push(small, large);

    const bulkParts = await allocations(small);
    expect(bulkParts.length).toBeGreaterThan(0);
    expect(sorted(bulkParts)).toEqual(sorted(await allocations(single)));
    expect((await allocations(large)).reduce((a, p) => a + p.amountFils, 0)).toBe(
      (await row(large))!.totalFils,
    );

    // Each expense has the single post's audit row, with the same shape; the batch has its own.
    const [bulkAudit] = await auditFor('expense.post', [small]);
    const [singleAudit] = await auditFor('expense.post', [single]);
    expect(Object.keys(bulkAudit!.after as object).sort()).toEqual(
      Object.keys(singleAudit!.after as object).sort(),
    );
    expect((await auditFor('expense.post', [large])).length).toBe(1);
    const batch = await w.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'expense.bulk'));
    expect(batch.at(-1)?.after).toMatchObject({
      action: 'post',
      ids: [small, large],
      note: 'Month end',
    });

    await w.flush();
    const pushed = await w.db
      .select()
      .from(schema.notificationLog)
      .where(
        and(
          eq(schema.notificationLog.type, 'large_expense'),
          inArray(schema.notificationLog.entityId, [small, large]),
        ),
      );
    expect(pushed.map((p) => p.entityId)).toEqual([large]);
  });

  it('all or nothing: an approval-blocked draft, a posted one and a missing id change nothing', async () => {
    const fine = await draft({ invoiceNo: 'BULK-OK-1' });
    const blocked = await draft({
      scope: 'unit',
      buildingId: khan,
      unitId: khan201,
      categoryId: cat('Plumbing'),
      reasonAr: 'استبدال مضخة المياه',
      reasonEn: 'Water pump replaced',
      amountFils: 550_000,
    });
    const single = await w.json<{ error?: { code: string } }>(
      `/api/staff/expenses/${blocked}/post`,
      { method: 'POST', token: editor },
    );
    expect(single.status).toBe(409);
    expect(single.body.error?.code).toBe('approval_required');

    const res = await bulk({ ids: [fine, blocked, posted[0], MISSING], action: 'post' });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('invalid_transition');
    expect(res.body.error?.details?.rejected.map((r) => [r.id, r.code, r.status])).toEqual([
      [blocked, 'approval_required', 'draft'],
      [posted[0], 'not_draft', 'posted'],
      [MISSING, 'not_found', null],
    ]);
    expect(res.body.error?.details?.rejected[0]?.reasonEn).toBe('Water pump replaced');

    // The draft that could have been posted was rolled back with the rest.
    expect((await row(fine))?.status).toBe('draft');
    expect(await allocations(fine)).toEqual([]);
    expect(await auditFor('expense.post', [fine])).toEqual([]);

    const ok = await bulk({ ids: [fine], action: 'post' });
    expect(ok.status).toBe(200);
    expect((await row(fine))?.status).toBe('posted');
    expect((await row(blocked))?.status).toBe('draft');
  });

  it('roles and limits: viewers cannot, at most 200 ids, at least one', async () => {
    const d = await draft();
    expect((await bulk({ ids: [d], action: 'post' }, viewer)).status).toBe(403);
    expect((await bulk({ ids: [d], action: 'discard' }, viewer)).status).toBe(403);
    expect((await bulk({ ids: Array(201).fill(d), action: 'post' })).status).toBe(422);
    expect((await bulk({ ids: [], action: 'post' })).status).toBe(422);
    expect((await bulk({ ids: [d], action: 'void' })).status).toBe(422);
    expect((await row(d))?.status).toBe('draft');
    expect((await bulk({ ids: [d], action: 'post' }, admin)).status).toBe(200);
  });
});

describe('discard', () => {
  it('removes plain drafts, keeps recurring ones as void, and the daily job does not make them again', async () => {
    const rule = await w.json<{ id: string }>('/api/staff/recurring-rules', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: noor,
        categoryId: cat('Internet and intercom'),
        reasonAr: 'اشتراك',
        reasonEn: 'Bulk subscription',
        amountFils: 20_000,
        frequency: 'monthly',
        dayOfMonth: Number(TODAY.slice(8, 10)),
        startDate: addDays(TODAY, -40),
      }),
    });
    expect(rule.status).toBe(201);
    await runDailyJobs(w.env);
    const ruleRows = () =>
      w.db.select().from(schema.expenses).where(eq(schema.expenses.recurringRuleId, rule.body.id));
    const [fromRule] = await ruleRows();
    expect(fromRule?.status).toBe('draft');
    const plain = await draft();

    const refused = await bulk({ ids: [fromRule!.id, plain, MISSING], action: 'discard' });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.details?.rejected.map((r) => r.code)).toEqual(['not_found']);
    expect((await row(plain))?.status).toBe('draft');
    expect((await row(fromRule!.id))?.status).toBe('draft');

    const res = await bulk({ ids: [fromRule!.id, plain], action: 'discard' });
    expect(res.status).toBe(200);
    expect(await row(plain)).toBeUndefined();
    const kept = await row(fromRule!.id);
    expect(kept?.status).toBe('void');
    expect(kept?.voidReason).toBe('discarded draft');
    expect((await auditFor('expense.discard_draft', [fromRule!.id])).length).toBe(1);
    expect((await auditFor('expense.delete_draft', [plain])).length).toBe(1);

    const again = await runDailyJobs(w.env);
    expect(again.recurringDrafts).toBe(0);
    expect((await ruleRows()).map((r) => r.status)).toEqual(['void']);
  });

  it('a posted expense is not discarded', async () => {
    const d = await draft();
    await bulk({ ids: [d], action: 'post' });
    const res = await bulk({ ids: [d], action: 'discard' });
    expect(res.status).toBe(422);
    expect(res.body.error?.details?.rejected.map((r) => r.code)).toEqual(['not_draft']);
    expect((await row(d))?.status).toBe('posted');
  });
});

describe('show and hide', () => {
  it('admins hide and show posted expenses; owners follow; drafts are refused; no-ops write nothing', async () => {
    const a = await draft({ reasonEn: 'Hide me' });
    const b = await draft({ reasonEn: 'Hide me too' });
    expect((await bulk({ ids: [a, b], action: 'post' })).status).toBe(200);
    const [part] = await allocations(a);
    const [owner] = await w.db
      .select({ phone: schema.owners.phoneE164 })
      .from(schema.owners)
      .where(eq(schema.owners.id, part!.ownerId));
    const ownerTok = await w.ownerToken(owner!.phone);
    expect((await w.json(`/api/owner/expenses/${a}`, { token: ownerTok })).status).toBe(200);

    expect((await bulk({ ids: [a, b], action: 'hide' })).status).toBe(403);
    expect((await bulk({ ids: [a, b], action: 'show' }, viewer)).status).toBe(403);

    const hidden = await bulk({ ids: [a, b], action: 'hide', note: 'Internal cost' }, admin);
    expect(hidden.status).toBe(200);
    expect(hidden.body.updated).toEqual([a, b]);
    expect(hidden.body.unchanged).toEqual([]);
    expect((await row(a))?.visibleToOwner).toBe(false);
    expect((await row(b))?.visibleToOwner).toBe(false);
    expect((await w.json(`/api/owner/expenses/${a}`, { token: ownerTok })).status).toBe(404);
    const [audited] = await auditFor('expense.visibility', [a]);
    expect(audited?.before).toEqual({ visibleToOwner: true });
    expect(audited?.after).toEqual({ visibleToOwner: false, note: 'Internal cost' });

    // A draft cannot be shown or hidden here, and then nothing changes for the posted one.
    const d = await draft();
    const refused = await bulk({ ids: [a, d], action: 'show' }, admin);
    expect(refused.status).toBe(422);
    expect(refused.body.error?.details?.rejected.map((r) => [r.id, r.code])).toEqual([
      [d, 'not_posted'],
    ]);
    expect((await row(a))?.visibleToOwner).toBe(false);

    const again = await bulk({ ids: [a], action: 'hide' }, admin);
    expect(again.body.unchanged).toEqual([a]);
    expect((await auditFor('expense.visibility', [a])).length).toBe(1);

    const shown = await bulk({ ids: [a], action: 'show' }, admin);
    expect(shown.status).toBe(200);
    expect((await row(a))?.visibleToOwner).toBe(true);
    expect((await w.json(`/api/owner/expenses/${a}`, { token: ownerTok })).status).toBe(200);
    // Allocations are untouched by visibility.
    expect((await allocations(a)).length).toBeGreaterThan(0);
  });

  it('the single visibility route is the same function, for admins', async () => {
    const a = await draft();
    await bulk({ ids: [a], action: 'post' });
    const asEditor = await w.json(`/api/staff/expenses/${a}/visibility`, {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ visibleToOwner: false }),
    });
    expect(asEditor.status).toBe(403);
    const res = await w.json<{ changed: boolean; expense: { visibleToOwner: boolean } }>(
      `/api/staff/expenses/${a}/visibility`,
      { method: 'POST', token: admin, body: JSON.stringify({ visibleToOwner: false }) },
    );
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.expense.visibleToOwner).toBe(false);
    const d = await draft();
    const onDraft = await w.json<{ error?: { code: string } }>(
      `/api/staff/expenses/${d}/visibility`,
      { method: 'POST', token: admin, body: JSON.stringify({ visibleToOwner: false }) },
    );
    expect(onDraft.status).toBe(409);
  });
});
