/**
 * Go-live sized import: 5,000 owner rows sent the way the dashboard sends them (batches of 500,
 * one idempotency key per batch), with bad rows mixed in. Every good row lands, every bad row is
 * reported with its own row number, and re-sending a batch changes nothing.
 */
import { count, eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let editor: string;
const owners = async () => (await w.db.select({ n: count() }).from(schema.owners))[0]!.n;
beforeAll(async () => {
  w = await createWorld();
  editor = await w.staffToken('entry@vamar.test');
});
afterAll(() => w.close());

const TOTAL = 5000;
const BATCH = 500;

interface Report {
  rowsOk: number;
  rowsFailed: number;
  results: { row: number; ok: boolean; errors?: string[] }[];
  alreadyDone: boolean;
}

/** Sheet row n (data starts on row 2). Every 50th row has a bad phone, every 97th repeats one. */
function sheetRow(i: number) {
  const row = i + 2;
  const phone = `+97155${String(1_000_000 + i).padStart(7, '0')}`;
  if (i % 50 === 49)
    return { row, data: { nameAr: 'مالك', nameEn: `Owner ${i}`, phoneE164: '05' } };
  if (i % 97 === 96) {
    return {
      row,
      data: {
        nameAr: 'مالك',
        nameEn: `Owner ${i}`,
        phoneE164: `+97155${String(1_000_000).padStart(7, '0')}`,
      },
    };
  }
  return { row, data: { nameAr: `مالك ${i}`, nameEn: `Owner ${i}`, phoneE164: phone } };
}

describe('5,000-row import', () => {
  it('lands every valid row and reports every bad one', { timeout: 300_000 }, async () => {
    const rows = Array.from({ length: TOTAL }, (_, i) => sheetRow(i));
    const badPhone = new Set(rows.filter((_, i) => i % 50 === 49).map((r) => r.row));
    const duplicate = new Set(
      rows.filter((_, i) => i % 97 === 96 && i % 50 !== 49).map((r) => r.row),
    );
    const before = await owners();

    let ok = 0;
    const failed = new Map<number, string>();
    for (let start = 0; start < TOTAL; start += BATCH) {
      const r = await w.json<Report>('/api/staff/import/commit', {
        method: 'POST',
        token: editor,
        body: JSON.stringify({
          target: 'owners',
          fileName: 'vamar-owners.xlsx',
          idempotencyKey: `golive-test:owners:Owners:${start}`,
          rows: rows.slice(start, start + BATCH),
        }),
      });
      expect(r.status).toBe(200);
      expect(r.body.results).toHaveLength(BATCH);
      ok += r.body.rowsOk;
      for (const x of r.body.results) if (!x.ok) failed.set(x.row, x.errors?.join('; ') ?? '');
    }

    expect(ok + failed.size).toBe(TOTAL);
    expect(failed.size).toBe(badPhone.size + duplicate.size);
    for (const row of badPhone) expect(failed.get(row)).toContain('phoneE164');
    for (const row of duplicate) expect(failed.get(row)).toContain('already exists');

    const after = await owners();
    expect(after - before).toBe(ok);

    // A retried batch (lost response, double click) returns the stored report and adds nothing.
    const again = await w.json<Report>('/api/staff/import/commit', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        target: 'owners',
        fileName: 'vamar-owners.xlsx',
        idempotencyKey: 'golive-test:owners:Owners:0',
        rows: rows.slice(0, BATCH),
      }),
    });
    expect(again.body.alreadyDone).toBe(true);
    const final = await owners();
    expect(final).toBe(after);
  });
});

/**
 * The rest of a go-live import on top of those owners: buildings, 1,000 units and tenants, then
 * ownership shares (some units shared 50/50), 1,000 contracts and 2,000 cheques, with bad rows of
 * every new kind mixed in. Sent again under new keys (an edited file), nothing is duplicated.
 */
describe('go-live import of shares, contracts and cheques', () => {
  const UNITS = 1000;
  const unitNo = (i: number) => `U-${String(i).padStart(4, '0')}`;
  const building = (i: number) => `Tower ${String(i % 10)}`;
  const ownerPhone = (i: number) => `+97155${String(1_000_000 + i).padStart(7, '0')}`;
  /** Owner indexes that the first test imported (not a bad or repeated phone). */
  const goodOwner = (n: number) => {
    let i = n;
    while (i % 50 === 49 || i % 97 === 96) i += 1;
    return i;
  };
  interface Sheet {
    row: number;
    data: Record<string, unknown>;
  }
  type Result = Report['results'][number] & { note?: string };

  /** Batches of up to 500 rows, as the dashboard sends them; one unit's rows stay together. */
  async function send(target: string, rows: Sheet[], key: string): Promise<Result[]> {
    const batches: Sheet[][] = [];
    let current: Sheet[] = [];
    let lastUnit = '';
    for (const r of rows) {
      const unit = `${String(r.data['building'])}|${String(r.data['unitNo'])}`;
      if (current.length >= BATCH && unit !== lastUnit) {
        batches.push(current);
        current = [];
      }
      current.push(r);
      lastUnit = unit;
    }
    if (current.length) batches.push(current);
    const out: Result[] = [];
    for (const [i, batch] of batches.entries()) {
      const r = await w.json<{ results: Result[] }>('/api/staff/import/commit', {
        method: 'POST',
        token: editor,
        body: JSON.stringify({
          target,
          fileName: 'vamar-import.xlsx',
          idempotencyKey: `${key}:${target}:${String(i)}`,
          rows: batch,
        }),
      });
      expect(r.status).toBe(200);
      out.push(...r.body.results);
    }
    return out;
  }
  const numbered = (rows: Omit<Sheet, 'row'>[]): Sheet[] =>
    rows.map((r, k) => ({ row: k + 2, data: r.data }));
  const tally = async () => ({
    ownerships: (await w.db.select({ n: count() }).from(schema.unitOwnerships))[0]!.n,
    contracts: (await w.db.select({ n: count() }).from(schema.contracts))[0]!.n,
    cheques: (await w.db.select({ n: count() }).from(schema.cheques))[0]!.n,
  });

  it('imports a portfolio and refuses the bad rows', { timeout: 900_000 }, async () => {
    const buildings = numbered(
      Array.from({ length: 10 }, (_, i) => ({
        data: { nameAr: `برج ${String(i)}`, nameEn: `Tower ${String(i)}`, area: 'Deira' },
      })),
    );
    const units = numbered(
      Array.from({ length: UNITS }, (_, i) => ({
        data: { building: building(i), unitNo: unitNo(i), type: 'apartment' },
      })),
    );
    const tenants = numbered(
      Array.from({ length: UNITS }, (_, i) => ({
        data: {
          name: `Tenant ${String(i)}`,
          phone: `+97156${String(1_000_000 + i).padStart(7, '0')}`,
        },
      })),
    );
    for (const [target, rows] of [
      ['buildings', buildings],
      ['units', units],
      ['tenants', tenants],
    ] as const) {
      const res = await send(target, rows, 'portfolio');
      expect(
        res.every((x) => x.ok),
        target,
      ).toBe(true);
    }

    // Shares: every third unit shared 50/50, the rest 100 %; units 50, 150, ... add up to 90 %.
    const badShareUnits = new Set<number>();
    const shareRows: Omit<Sheet, 'row'>[] = [];
    for (let i = 0; i < UNITS; i++) {
      const base = { building: building(i), unitNo: unitNo(i) };
      const share = (owner: number, sharePct: number) =>
        shareRows.push({ data: { ...base, ownerPhone: ownerPhone(goodOwner(owner)), sharePct } });
      if (i % 100 === 50) {
        badShareUnits.add(i);
        share(i, 60);
        share(i + 1000, 30);
      } else if (i % 3 === 0) {
        share(i, 50);
        share(i + 2000, 50);
      } else share(i, 100);
    }
    const shares = numbered(shareRows);
    const shareRes = await send('shares', shares, 'portfolio');
    const failedShares = shareRes.filter((x) => !x.ok);
    expect(failedShares).toHaveLength(badShareUnits.size * 2);
    for (const f of failedShares) expect(f.errors?.join(';')).toContain('not 100 %');

    // Contracts: one per unit; units 0, 125, ... also get a second, overlapping one (refused).
    const contractRows: Omit<Sheet, 'row'>[] = [];
    for (let i = 0; i < UNITS; i++) {
      const base = { building: building(i), unitNo: unitNo(i), tenantName: `Tenant ${String(i)}` };
      contractRows.push({
        data: {
          ...base,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          annualRentAed: 60000,
          chequeCount: 2,
        },
      });
      if (i % 125 === 0)
        contractRows.push({
          data: {
            ...base,
            startDate: '2026-06-01',
            endDate: '2027-05-31',
            annualRentAed: 70000,
            chequeCount: 2,
          },
        });
    }
    const contracts = numbered(contractRows);
    const contractRes = await send('contracts', contracts, 'portfolio');
    const overlaps = contractRes.filter((x) => !x.ok);
    expect(overlaps).toHaveLength(UNITS / 125);
    for (const f of overlaps) expect(f.errors?.join(';')).toContain('overlaps');

    // Cheques: two per contract of 30,000 AED; unit 7's second is 29,000 (total differs from the
    // rent); units 0, 200, ... also send a cheque for a contract that does not exist.
    const chequeRows: Omit<Sheet, 'row'>[] = [];
    for (let i = 0; i < UNITS; i++) {
      const base = { building: building(i), unitNo: unitNo(i), contractStart: '2026-01-01' };
      const cheque = (extra: Record<string, unknown>) =>
        chequeRows.push({ data: { ...base, bankName: 'Emirates NBD', ...extra } });
      cheque({ seq: 1, dueDate: '2026-01-01', amountAed: 30000, chequeNo: `A${String(i)}` });
      cheque({
        seq: 2,
        dueDate: '2026-07-01',
        amountAed: i === 7 ? 29000 : 30000,
        chequeNo: `B${String(i)}`,
      });
      if (i % 200 === 0)
        cheque({
          contractStart: '2025-01-01',
          seq: 1,
          dueDate: '2025-01-01',
          amountAed: 1,
          chequeNo: 'X',
        });
    }
    const cheques = numbered(chequeRows);
    const chequeRes = await send('cheques', cheques, 'portfolio');
    const orphans = chequeRes.filter((x) => !x.ok);
    expect(orphans).toHaveLength(UNITS / 200);
    for (const f of orphans) expect(f.errors?.join(';')).toContain('no contract');
    const notes = chequeRes.map((x) => x.note ?? '');
    expect(notes.filter((x) => x === 'contract activated')).toHaveLength(UNITS - 1);
    expect(notes.filter((x) => x.includes('stays a draft'))).toHaveLength(1);
    const [active] = await w.db
      .select({ n: count() })
      .from(schema.contracts)
      .where(eq(schema.contracts.status, 'active'));
    expect(active!.n).toBeGreaterThanOrEqual(UNITS - 1);

    // The same rows again under new keys (an edited file): nothing is added.
    const before = await tally();
    const sharesAgain = await send('shares', shares, 'portfolio-edited');
    expect(sharesAgain.filter((x) => x.note === 'already set; unchanged')).toHaveLength(
      shares.length - badShareUnits.size * 2,
    );
    expect((await send('contracts', contracts, 'portfolio-edited')).some((x) => x.ok)).toBe(false);
    // Only the draft contract's two cheques are accepted again: rewritten in place, not added.
    const chequesAgain = await send('cheques', cheques, 'portfolio-edited');
    expect(chequesAgain.filter((x) => x.ok)).toHaveLength(2);
    expect(await tally()).toEqual(before);
  });
});
