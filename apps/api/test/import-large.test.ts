/**
 * Go-live sized import: 5,000 owner rows sent the way the dashboard sends them (batches of 500,
 * one idempotency key per batch), with bad rows mixed in. Every good row lands, every bad row is
 * reported with its own row number, and re-sending a batch changes nothing.
 */
import { count } from 'drizzle-orm';
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
