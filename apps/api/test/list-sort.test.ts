/**
 * Server-side sorting of the staff lists: every allow-listed column in both directions pages with
 * keyset cursors that match one unpaged read, rows written in the same transaction (same
 * microsecond timestamp) are never skipped, and anything outside the allow-list is refused.
 */
import { schema } from '@vamar/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHEQUE_SORT } from '../src/services/cheques.js';
import { CONTRACT_SORT } from '../src/services/contracts.js';
import { DISPUTE_SORT } from '../src/services/disputes.js';
import { EXPENSE_SORT, VENDOR_SORT } from '../src/services/expenses.js';
import { OWNER_SORT } from '../src/services/owners.js';
import { AUDIT_SORT } from '../src/services/staff.js';
import { WORK_ORDER_SORT } from '../src/services/work-orders.js';
import { rowsOf } from '../src/db.js';
import { base64url } from '../src/util/crypto.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
});
afterAll(() => w.close());

interface Page {
  items: { id: string }[];
  nextCursor: string | null;
}

const LISTS: [string, Record<string, unknown>][] = [
  ['/api/staff/cheques', CHEQUE_SORT.columns],
  ['/api/staff/contracts', CONTRACT_SORT.columns],
  ['/api/staff/owners', OWNER_SORT.columns],
  ['/api/staff/disputes', DISPUTE_SORT.columns],
  ['/api/staff/expenses', EXPENSE_SORT.columns],
  ['/api/staff/work-orders', WORK_ORDER_SORT.columns],
  ['/api/staff/audit', AUDIT_SORT.columns],
  ['/api/staff/vendors', VENDOR_SORT.columns],
];

async function get(path: string): Promise<Page> {
  const r = await w.json<Page>(path, { token: admin });
  expect(r.status, path).toBe(200);
  return r.body;
}

/** Ids of the first `want` rows read `size` at a time through the cursors. */
async function paged(base: string, size: number, want: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page: Page = await get(`${base}&limit=${size}${cursor ? `&cursor=${cursor}` : ''}`);
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
  } while (cursor && ids.length < want);
  return ids.slice(0, want);
}

describe('sorted lists', () => {
  it('give the same rows paged as unpaged, for every column and direction', async () => {
    for (const [path, columns] of LISTS) {
      for (const sort of Object.keys(columns)) {
        for (const dir of ['asc', 'desc']) {
          const base = `${path}?sort=${sort}&dir=${dir}`;
          const whole = (await get(`${base}&limit=40`)).items.map((i) => i.id);
          const byPages = await paged(base, 7, whole.length);
          expect(byPages, base).toEqual(whole);
          expect(new Set(byPages).size).toBe(byPages.length);
        }
      }
    }
  });

  it('order by the chosen column', async () => {
    const amounts = await w.json<{ items: { amountFils: number | null }[] }>(
      '/api/staff/cheques?sort=amount&dir=desc&limit=30',
      { token: admin },
    );
    const values = amounts.body.items.map((i) => i.amountFils ?? -1);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    const names = await w.json<{ items: { nameEn: string }[] }>(
      '/api/staff/owners?sort=nameEn&limit=30',
      { token: admin },
    );
    const n = names.body.items.map((i) => i.nameEn);
    const sorted = rowsOf<{ name_en: string }>(
      await w.db.execute(sql`select name_en from owners order by name_en asc, id asc limit 30`),
    );
    expect(n).toEqual(sorted.map((r) => r.name_en));
  });

  it('refuse a column or direction outside the allow-list, and a cursor of another order', async () => {
    const bad = await w.json<{ error: { code: string } }>('/api/staff/cheques?sort=bounce_reason', {
      token: admin,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('validation');
    expect((await w.request('/api/staff/owners?dir=sideways', { token: admin })).status).toBe(422);
    expect(
      (await w.request('/api/staff/owners?sort=createdAt;drop table owners', { token: admin }))
        .status,
    ).toBe(422);
    const first = await get('/api/staff/contracts?sort=endDate&limit=2');
    expect(first.nextCursor).toBeTruthy();
    const other = await w.request(
      `/api/staff/contracts?sort=startDate&limit=2&cursor=${first.nextCursor}`,
      { token: admin },
    );
    expect(other.status).toBe(422);
    const forged = base64url(
      new TextEncoder().encode(JSON.stringify(["x' or 1=1", crypto.randomUUID(), 'endDate.asc'])),
    );
    // A text key is bound as a parameter; a date key must look like a date.
    expect(
      (await w.request(`/api/staff/contracts?sort=endDate&cursor=${forged}`, { token: admin }))
        .status,
    ).toBe(422);
  });

  it('accept a cursor made before sorting existed for the default order', async () => {
    const whole = (await get('/api/staff/contracts?limit=4')).items as {
      id: string;
      createdAt: string;
    }[];
    const second = whole[1]!;
    const legacy = base64url(
      new TextEncoder().encode(JSON.stringify([second.createdAt, second.id])),
    );
    const next = await get(`/api/staff/contracts?limit=2&cursor=${legacy}`);
    expect(next.items[0]?.id).toBe(whole[2]?.id);
  });
});

describe('rows written in one transaction', () => {
  it('are all reached through the cursors (microsecond timestamps)', async () => {
    const before = (await get('/api/staff/owners?limit=100')).items.length;
    await w.db.transaction(async (tx) => {
      for (let i = 0; i < 7; i++) {
        await tx.insert(schema.owners).values({
          nameAr: `مالك ${i}`,
          nameEn: `Batch owner ${i}`,
          phoneE164: `+97150999000${i}`,
        });
      }
    });
    const all = await paged('/api/staff/owners?dir=desc', 2, 1000);
    expect(all.length).toBe(before + 7);
    expect(new Set(all).size).toBe(all.length);
  });

  it('audit rows of one bulk action page completely', async () => {
    await w.db.transaction(async (tx) => {
      for (let i = 0; i < 9; i++) {
        await tx.insert(schema.auditLog).values({
          actorType: 'system',
          action: 'test.batch',
          entityType: 'test',
        });
      }
    });
    const ids = await paged('/api/staff/audit?action=test.batch', 2, 100);
    expect(ids).toHaveLength(9);
  });
});

describe('lists past 100 rows', () => {
  it('disputes page beyond the first 100', async () => {
    const [unit] = await w.db.select({ id: schema.units.id }).from(schema.units).limit(1);
    await w.db.insert(schema.disputes).values(
      Array.from({ length: 105 }, (_, i) => ({
        caseNo: `T-${String(i).padStart(4, '0')}`,
        unitId: unit!.id,
        type: 'other' as const,
      })),
    );
    const total = await w.db.$count(schema.disputes);
    const ids = await paged('/api/staff/disputes?dir=desc', 100, 10_000);
    expect(total).toBeGreaterThan(105);
    expect(ids).toHaveLength(total);
    const byHearing = await paged('/api/staff/disputes?sort=hearing', 100, 10_000);
    expect(new Set(byHearing).size).toBe(total);
  });

  it("a unit's cheques page through to the last one", async () => {
    const [unit] = rowsOf<{ unit_id: string; n: number }>(
      await w.db.execute(sql`
        select c.unit_id, count(*)::int as n from cheques q join contracts c on c.id = q.contract_id
        where c.status <> 'draft' group by c.unit_id order by n desc limit 1`),
    );
    if (!unit) throw new Error('no cheques in the seed');
    const ids = await paged(`/api/staff/cheques?unitId=${unit.unit_id}`, 3, 10_000);
    expect(ids).toHaveLength(unit.n);
  });
});

describe('expense list', () => {
  it('sends the totals with the first page only', async () => {
    const first = await w.json<{ nextCursor: string | null; totals: unknown }>(
      '/api/staff/expenses?limit=2',
      { token: admin },
    );
    expect(first.body.totals).not.toBeNull();
    const next = await w.json<{ totals: unknown }>(
      `/api/staff/expenses?limit=2&cursor=${first.body.nextCursor}`,
      { token: admin },
    );
    expect(next.status).toBe(200);
    expect(next.body.totals).toBeNull();
  });
});
