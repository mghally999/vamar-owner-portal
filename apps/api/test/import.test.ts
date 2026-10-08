import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let editor: string;
beforeAll(async () => {
  w = await createWorld();
  editor = await w.staffToken('entry@vamar.test');
});
afterAll(() => w.close());

describe('excel import commit', () => {
  it('inserts valid rows, reports per-row errors, and is idempotent', async () => {
    const body = {
      target: 'owners',
      fileName: 'owners.xlsx',
      idempotencyKey: 'import-test-0001',
      rows: [
        { row: 2, data: { nameAr: 'حمد الشامسي', nameEn: 'Hamad Al Shamsi', phoneE164: '+971508000001' } },
        { row: 3, data: { nameAr: 'x', nameEn: 'Bad Phone', phoneE164: '050123' } },
        { row: 4, data: { nameAr: 'خالد', nameEn: 'Dup Phone', phoneE164: '+971500000001' } },
      ],
    };
    const r = await w.json<{ rowsOk: number; rowsFailed: number; results: { row: number; ok: boolean; errors?: string[] }[]; alreadyDone: boolean }>('/api/staff/import/commit', { method: 'POST', token: editor, body: JSON.stringify(body) });
    expect(r.status).toBe(200);
    expect(r.body.rowsOk).toBe(1);
    expect(r.body.rowsFailed).toBe(2);
    expect(r.body.results.find((x) => x.row === 3)?.errors?.[0]).toContain('phoneE164');
    expect(r.body.results.find((x) => x.row === 4)?.errors?.[0]).toContain('already exists');

    const again = await w.json<{ alreadyDone: boolean; rowsOk: number }>('/api/staff/import/commit', { method: 'POST', token: editor, body: JSON.stringify(body) });
    expect(again.body.alreadyDone).toBe(true);
    expect(again.body.rowsOk).toBe(1);
  });

  it('imports units by building name', async () => {
    const r = await w.json<{ rowsOk: number; results: { ok: boolean; errors?: string[] }[] }>('/api/staff/import/commit', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        target: 'units',
        fileName: 'units.xlsx',
        idempotencyKey: 'import-test-0002',
        rows: [
          { row: 2, data: { building: 'Al Noor Tower', unitNo: '3001', type: 'apartment', bedrooms: 2 } },
          { row: 3, data: { building: 'برج النور', unitNo: '3002', type: 'apartment' } },
          { row: 4, data: { building: 'Nowhere', unitNo: '1' } },
        ],
      }),
    });
    expect(r.body.rowsOk).toBe(2);
    expect(r.body.results[2]?.errors?.[0]).toContain('no building named');
  });

  it('viewer cannot import', async () => {
    const viewer = await w.staffToken('viewer@vamar.test');
    const r = await w.request('/api/staff/import/commit', { method: 'POST', token: viewer, body: JSON.stringify({ target: 'tenants', fileName: 'x', idempotencyKey: 'import-test-0003', rows: [{ row: 1, data: { name: 'A' } }] }) });
    expect(r.status).toBe(403);
  });
});
