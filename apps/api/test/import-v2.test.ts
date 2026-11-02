/**
 * The Expenses sheet and the identifier columns of the Buildings and Units sheets: valid rows
 * are created and posted with allocations that add up, bad rows fail on their own with a reason,
 * a repeated batch returns its stored report, and a go-live sized expenses batch lands in budget.
 */
import { and, count, eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let editor: string;

interface Report {
  rowsOk: number;
  rowsFailed: number;
  results: { row: number; ok: boolean; id?: string; errors?: string[]; note?: string }[];
  alreadyDone: boolean;
}

const commit = (
  target: string,
  key: string,
  rows: { row: number; data: Record<string, unknown> }[],
) =>
  w.json<Report>('/api/staff/import/commit', {
    method: 'POST',
    token: editor,
    body: JSON.stringify({ target, fileName: 'vamar-import.xlsx', idempotencyKey: key, rows }),
  });

beforeAll(async () => {
  w = await createWorld();
  editor = await w.staffToken('entry@vamar.test');
});
afterAll(() => w.close());

describe('expenses sheet', () => {
  it('posts valid rows with allocations that add up, defaults VAT from the vendor, and reports the bad rows', async () => {
    const base = {
      building: 'Al Noor Tower',
      category: 'General maintenance',
      reasonAr: 'صيانة عامة',
      reasonEn: 'General maintenance',
      invoiceDate: TODAY,
      amountAed: 1000,
    };
    const r = await commit('expenses', 'import-v2-expenses-1', [
      { row: 2, data: { ...base, vendor: 'Gulf Lifts Technical Services', invoiceNo: 'IMP-1' } },
      {
        row: 3,
        data: {
          ...base,
          category: 'سباكة',
          unitNo: '1204',
          vatAed: 0,
          paidOn: TODAY,
          paymentMethod: 'cash',
          visibleToOwner: 'لا',
        },
      },
      { row: 4, data: { ...base, category: 'Nope' } },
      { row: 5, data: { ...base, vendor: 'Unknown Vendor' } },
      { row: 6, data: { ...base, building: 'Nowhere' } },
      { row: 7, data: { ...base, unitNo: '9999' } },
      { row: 8, data: { ...base, amountAed: -5 } },
      { row: 9, data: { ...base, visibleToOwner: 'maybe' } },
      {
        row: 10,
        data: { ...base, vendor: 'Clean & Shine Services', invoiceNo: 4521, amountAed: 250.5 },
      },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.rowsOk).toBe(3);
    expect(r.body.rowsFailed).toBe(6);
    const by = (row: number) => r.body.results.find((x) => x.row === row)!;
    expect(by(4).errors?.[0]).toContain('category');
    expect(by(4).errors?.[0]).toContain('تصنيف');
    expect(by(5).errors?.[0]).toContain('vendor');
    expect(by(6).errors?.[0]).toContain('no building named');
    expect(by(7).errors?.[0]).toContain('unitNo');
    expect(by(8).errors?.[0]).toContain('amountAed');
    expect(by(9).errors?.[0]).toContain('visibleToOwner');

    // Row 2: vendor with a TRN, so 5 % VAT; building scope, by area over the eight units.
    const first = await w.db.query.expenses.findFirst({ where: eq(schema.expenses.id, by(2).id!) });
    expect(first).toMatchObject({
      status: 'posted',
      scope: 'building',
      kind: 'variable',
      amountFils: 100_000,
      vatFils: 5_000,
      totalFils: 105_000,
      invoiceNo: 'IMP-1',
      allocationMethod: 'by_area',
      visibleToOwner: true,
    });
    const parts = await w.db
      .select({ amountFils: schema.expenseAllocations.amountFils })
      .from(schema.expenseAllocations)
      .where(eq(schema.expenseAllocations.expenseId, first!.id));
    expect(parts.length).toBe(8);
    expect(parts.reduce((a, p) => a + p.amountFils, 0)).toBe(105_000);
    expect(by(2).note).toBe('posted, 8 owner shares');

    // Row 3: unit scope, Arabic category name, explicit VAT 0, hidden from the owner.
    const second = await w.db.query.expenses.findFirst({
      where: eq(schema.expenses.id, by(3).id!),
    });
    expect(second).toMatchObject({
      scope: 'unit',
      vatFils: 0,
      totalFils: 100_000,
      paidOn: TODAY,
      paymentMethod: 'cash',
      visibleToOwner: false,
      allocationMethod: 'single_unit',
    });
    const [cat] = await w.db
      .select({ nameEn: schema.expenseCategories.nameEn })
      .from(schema.expenseCategories)
      .where(eq(schema.expenseCategories.id, second!.categoryId));
    expect(cat!.nameEn).toBe('Plumbing');

    // Row 10: a vendor without a TRN gives no VAT; a numeric invoice number becomes text.
    const third = await w.db.query.expenses.findFirst({
      where: eq(schema.expenses.id, by(10).id!),
    });
    expect(third).toMatchObject({ amountFils: 25_050, vatFils: 0, invoiceNo: '4521' });

    // The same batch again: the stored report, nothing added.
    const [before] = await w.db.select({ n: count() }).from(schema.expenses);
    const again = await commit('expenses', 'import-v2-expenses-1', [{ row: 2, data: base }]);
    expect(again.body.alreadyDone).toBe(true);
    expect(again.body.rowsOk).toBe(3);
    const [after] = await w.db.select({ n: count() }).from(schema.expenses);
    expect(after!.n).toBe(before!.n);
  });

  it('is refused for viewers and for an inactive category', async () => {
    const viewer = await w.staffToken('viewer@vamar.test');
    const denied = await w.request('/api/staff/import/commit', {
      method: 'POST',
      token: viewer,
      body: JSON.stringify({
        target: 'expenses',
        fileName: 'x',
        idempotencyKey: 'import-v2-viewer',
        rows: [{ row: 2, data: {} }],
      }),
    });
    expect(denied.status).toBe(403);
    await w.db
      .update(schema.expenseCategories)
      .set({ active: false })
      .where(eq(schema.expenseCategories.nameEn, 'Painting'));
    const r = await commit('expenses', 'import-v2-inactive', [
      {
        row: 2,
        data: {
          building: 'Al Noor Tower',
          category: 'Painting',
          reasonAr: 'د',
          reasonEn: 'p',
          invoiceDate: TODAY,
          amountAed: 10,
        },
      },
    ]);
    expect(r.body.rowsFailed).toBe(1);
    expect(r.body.results[0]?.errors?.[0]).toContain('no active expense category');
  });
});

describe('identifier columns', () => {
  it('land on new buildings and units and are validated', async () => {
    const b = await commit('buildings', 'import-v2-buildings', [
      {
        row: 2,
        data: {
          nameAr: 'برج الاستيراد',
          nameEn: 'Import Tower',
          area: 'Deira',
          plotNo: '123-4567',
          makaniNo: '1234567890',
          titleDeedNo: 'TD-IMP-1',
          completionYear: 2019,
          floorsCount: 12,
        },
      },
      {
        row: 3,
        data: { nameAr: 'برج خاطئ', nameEn: 'Bad Makani Tower', area: 'Deira', makaniNo: '12' },
      },
      {
        row: 4,
        data: { nameAr: 'برج قديم', nameEn: 'Old Tower', area: 'Deira', completionYear: 1800 },
      },
    ]);
    expect(b.body.rowsOk).toBe(1);
    expect(b.body.results[1]?.errors?.[0]).toContain('makaniNo');
    expect(b.body.results[2]?.errors?.[0]).toContain('completionYear');
    const building = await w.db.query.buildings.findFirst({
      where: eq(schema.buildings.nameEn, 'Import Tower'),
    });
    expect(building).toMatchObject({
      plotNo: '123-4567',
      makaniNo: '1234567890',
      titleDeedNo: 'TD-IMP-1',
      completionYear: 2019,
      floorsCount: 12,
    });

    const u = await commit('units', 'import-v2-units', [
      {
        row: 2,
        data: {
          building: 'Import Tower',
          unitNo: '101',
          type: 'apartment',
          titleDeedNo: 'TD-IMP-101',
          plotNo: '123-4567',
          makaniNo: '2345678901',
          dewaPremiseNo: '600112233',
          municipalityNo: 'M-101',
          handoverDate: '2019-09-01',
        },
      },
      { row: 3, data: { building: 'Import Tower', unitNo: '102', handoverDate: '2019-13-40' } },
      { row: 4, data: { building: 'Import Tower', unitNo: '103' } },
    ]);
    expect(u.body.rowsOk).toBe(2);
    expect(u.body.results[1]?.errors?.[0]).toContain('handoverDate');
    const unit = await w.db.query.units.findFirst({
      where: and(eq(schema.units.buildingId, building!.id), eq(schema.units.unitNo, '101')),
    });
    expect(unit).toMatchObject({
      titleDeedNo: 'TD-IMP-101',
      makaniNo: '2345678901',
      dewaPremiseNo: '600112233',
      municipalityNo: 'M-101',
      handoverDate: '2019-09-01',
    });
    const plain = await w.db.query.units.findFirst({
      where: and(eq(schema.units.buildingId, building!.id), eq(schema.units.unitNo, '103')),
    });
    expect(plain?.titleDeedNo).toBeNull();
  });
});

describe('2,000-row expenses import (four batches of 500)', () => {
  it(
    'lands every valid row with its allocations and reports the bad ones',
    { timeout: 300_000 },
    async () => {
      const TOTAL = 2000;
      const BATCH = 500;
      const buildings = [
        'Al Noor Tower',
        'Al Safa Building',
        'Al Khan Residence',
        'Mamzar Villas',
        'Al Nahda Commercial Centre',
      ];
      const categories = [
        'General maintenance',
        'Plumbing',
        'Electrical',
        'Pest control',
        'Deep cleaning',
      ];
      const rows = Array.from({ length: TOTAL }, (_, i) => {
        const month = String((i % 12) + 1).padStart(2, '0');
        const data: Record<string, unknown> = {
          building: buildings[i % 5],
          category: i % 250 === 249 ? 'No such category' : categories[i % 5],
          reasonAr: `مصروف ${String(i)}`,
          reasonEn: `Expense ${String(i)}`,
          invoiceNo: `BULK-${String(i)}`,
          invoiceDate: `2025-${month}-15`,
          amountAed: 100 + (i % 900),
        };
        if (i % 7 === 0) data['vendor'] = 'Al Hamad Facilities Management LLC';
        return { row: i + 2, data };
      });
      const [before] = await w.db.select({ n: count() }).from(schema.expenses);
      let ok = 0;
      const failed = new Map<number, string>();
      const started = Date.now();
      for (let start = 0; start < TOTAL; start += BATCH) {
        const r = await commit(
          'expenses',
          `golive-test:expenses:Expenses:${String(start)}`,
          rows.slice(start, start + BATCH),
        );
        expect(r.status).toBe(200);
        expect(r.body.results).toHaveLength(BATCH);
        ok += r.body.rowsOk;
        for (const x of r.body.results) if (!x.ok) failed.set(x.row, x.errors?.join('; ') ?? '');
      }
      const elapsed = Date.now() - started;
      expect(ok + failed.size).toBe(TOTAL);
      expect(failed.size).toBe(TOTAL / 250);
      for (const msg of failed.values()) expect(msg).toContain('category');
      const [after] = await w.db.select({ n: count() }).from(schema.expenses);
      expect(after!.n - before!.n).toBe(ok);
      // Every posted expense has allocations that add up to its total.
      const mismatch = await w.db.execute(
        `select count(*)::int as n from expenses x where x.status = 'posted' and x.total_fils <> coalesce((select sum(a.amount_fils) from expense_allocations a where a.expense_id = x.id), 0)` as never,
      );
      const rowsOut = (
        Array.isArray(mismatch) ? mismatch : (mismatch as { rows: { n: number }[] }).rows
      ) as { n: number }[];
      expect(rowsOut[0]?.n ?? 0).toBe(0);
      console.info(`2,000 expense rows in ${String(Math.round(elapsed / 1000))} s`);
    },
  );
});
