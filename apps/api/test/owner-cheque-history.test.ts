/**
 * A sold unit's cheques: the period list shows each cheque to the owners of its due date, so the
 * detail, the image and the message link must open those same cheques, with the share of that
 * day. Another owner, or a later owner for a cheque due before they bought, still gets 404.
 *
 * Al Noor Tower 2001 changes hands three times along its active contract:
 *   seed - d0     Khalid 100 %
 *   d0   - d2     Khalid 75 %, Fatima 25 %
 *   d2   - d4     Mariam 100 %
 *   d4   - now    Rashid 100 %
 * Omar never owned it.
 */
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { ownerShareAmount } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

const PHONES = {
  khalid: '+971500000001',
  fatima: '+971500000002',
  omar: '+971500000003',
  mariam: '+971500000004',
  rashid: '+971500000005',
} as const;
type OwnerKey = keyof typeof PHONES;

interface ChequeRow {
  id: string;
  dueDate: string;
  amountFils: number | null;
  grossAmountFils: number | null;
  shareBp: number;
  shared: boolean;
}

let w: TestWorld;
const tok = {} as Record<OwnerKey, string>;
let unit: string;
let contract: { id: string; start: string; end: string };
let dues: { id: string; due: string; amount: number | null }[];
const IMAGE_KEY = 'cheques/owner-history-test.png';

const detail = (who: OwnerKey, chequeId: string) =>
  w.json<ChequeRow>(`/api/owner/cheques/${chequeId}`, { token: tok[who] });
const image = (who: OwnerKey, chequeId: string) =>
  w.request(`/api/owner/cheques/${chequeId}/image`, { token: tok[who] });
const askAbout = (who: OwnerKey, chequeId: string) =>
  w.json<{ link: { type: string; id: string } | null }>('/api/owner/messages', {
    method: 'POST',
    token: tok[who],
    body: JSON.stringify({
      subject: 'About this cheque',
      body: 'Was it deposited?',
      linkType: 'cheque',
      linkId: chequeId,
    }),
  });
const periodList = (who: OwnerKey) =>
  w.json<{ items: ChequeRow[] }>(
    `/api/owner/cheques?from=${contract.start}&to=${contract.end}&unitId=${unit}&limit=100`,
    { token: tok[who] },
  );
const calendarCheques = async (who: OwnerKey) => {
  const res = await w.json<{
    items: { kind: string; entityId: string | null; unitId: string | null; amountFils: number }[];
  }>(`/api/owner/calendar?from=${contract.start}&to=${contract.end}&kinds=cheque_due`, {
    token: tok[who],
  });
  expect(res.status).toBe(200);
  return res.body.items.filter((i) => i.unitId === unit);
};

beforeAll(async () => {
  w = await createWorld();
  const editor = await w.staffToken('entry@vamar.test');
  for (const k of Object.keys(PHONES) as OwnerKey[]) tok[k] = await w.ownerToken(PHONES[k]);

  const [u] = await w.db
    .select({ id: schema.units.id })
    .from(schema.units)
    .innerJoin(schema.buildings, eq(schema.buildings.id, schema.units.buildingId))
    .where(and(eq(schema.buildings.nameEn, 'Al Noor Tower'), eq(schema.units.unitNo, '2001')));
  unit = u!.id;
  const [c] = await w.db
    .select({
      id: schema.contracts.id,
      start: schema.contracts.startDate,
      end: schema.contracts.endDate,
    })
    .from(schema.contracts)
    .where(and(eq(schema.contracts.unitId, unit), eq(schema.contracts.status, 'active')));
  contract = c!;
  dues = await w.db
    .select({
      id: schema.cheques.id,
      due: schema.cheques.dueDate,
      amount: schema.cheques.amountFils,
    })
    .from(schema.cheques)
    .where(eq(schema.cheques.contractId, contract.id))
    .orderBy(asc(schema.cheques.dueDate));
  expect(dues.length).toBeGreaterThan(4);
  expect(new Set(dues.map((d) => d.due)).size).toBe(dues.length);
  expect(dues.every((d) => d.amount !== null)).toBe(true);

  // Omar must be a stranger to the unit for the 404 checks to mean anything.
  const omarRows = await w.db
    .select({ id: schema.unitOwnerships.id })
    .from(schema.unitOwnerships)
    .where(
      and(
        eq(schema.unitOwnerships.unitId, unit),
        eq(schema.unitOwnerships.ownerId, w.ids.owners[PHONES.omar]!),
      ),
    );
  expect(omarRows).toHaveLength(0);

  const sell = async (fromDate: string, owners: { who: OwnerKey; shareBp: number }[]) => {
    const res = await w.json(`/api/staff/units/${unit}/owners`, {
      method: 'PUT',
      token: editor,
      body: JSON.stringify({
        fromDate,
        owners: owners.map((o) => ({ ownerId: w.ids.owners[PHONES[o.who]], shareBp: o.shareBp })),
      }),
    });
    expect(res.status).toBe(200);
  };
  await sell(dues[0]!.due, [
    { who: 'khalid', shareBp: 7_500 },
    { who: 'fatima', shareBp: 2_500 },
  ]);
  await sell(dues[2]!.due, [{ who: 'mariam', shareBp: 10_000 }]);
  await sell(dues[4]!.due, [{ who: 'rashid', shareBp: 10_000 }]);

  // Every cheque of the contract has an image.
  await w.db
    .update(schema.cheques)
    .set({ imageKey: IMAGE_KEY })
    .where(eq(schema.cheques.contractId, contract.id));
  await w.r2.put(IMAGE_KEY, new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, {
    httpMetadata: { contentType: 'image/png' },
  });
});
afterAll(() => w.close());

describe('a sold unit: the past owner opens what the period list shows', () => {
  it('every row of the seller period list opens, with the share of its due date', async () => {
    const list = await periodList('khalid');
    expect(list.status).toBe(200);
    expect(list.body.items.map((c) => c.id)).toEqual([dues[0]!.id, dues[1]!.id]);
    for (const row of list.body.items) {
      const res = await detail('khalid', row.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: row.id,
        shareBp: 7_500,
        shared: true,
        amountFils: row.amountFils,
        grossAmountFils: row.grossAmountFils,
      });
      expect(res.body.amountFils).toBe(ownerShareAmount(row.grossAmountFils!, 7_500));
    }
    const fatima = await detail('fatima', dues[1]!.id);
    expect(fatima.status).toBe(200);
    expect(fatima.body.shareBp).toBe(2_500);
  });

  it('a middle owner who sold on opens their own cheques with their share', async () => {
    const list = await periodList('mariam');
    expect(list.body.items.map((c) => c.id)).toEqual([dues[2]!.id, dues[3]!.id]);
    const res = await detail('mariam', dues[3]!.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shareBp: 10_000, shared: false, amountFils: dues[3]!.amount });
  });

  it('the image and the message link follow the same rule', async () => {
    const img = await image('khalid', dues[0]!.id);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    const ask = await askAbout('khalid', dues[0]!.id);
    expect(ask.status).toBe(201);
    expect(ask.body.link).toMatchObject({ type: 'cheque', id: dues[0]!.id });
  });

  it('the seller calendar shows the same cheques as the period list, with the same share', async () => {
    const list = await periodList('khalid');
    const cal = await calendarCheques('khalid');
    const byId = (rows: { id: string; amount: number | null }[]) =>
      Object.fromEntries(rows.map((r) => [r.id, r.amount]));
    expect(byId(cal.map((i) => ({ id: i.entityId!, amount: i.amountFils })))).toEqual(
      byId(list.body.items.map((c) => ({ id: c.id, amount: c.amountFils }))),
    );
    const later = await calendarCheques('rashid');
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((i) => dues.findIndex((d) => d.id === i.entityId) >= 4)).toBe(true);
  });
});

describe('everyone else stays out', () => {
  it('an owner who never held the unit gets 404 on detail, image and message link', async () => {
    for (const d of dues) {
      expect((await detail('omar', d.id)).status).toBe(404);
      expect((await image('omar', d.id)).status).toBe(404);
    }
    expect((await askAbout('omar', dues[0]!.id)).status).toBe(404);
    expect((await calendarCheques('omar')).length).toBe(0);
  });

  it('an owner who sold does not see the cheques due after the sale', async () => {
    for (const d of dues.slice(2)) {
      expect((await detail('khalid', d.id)).status).toBe(404);
      expect((await image('khalid', d.id)).status).toBe(404);
    }
    expect((await askAbout('khalid', dues[4]!.id)).status).toBe(404);
  });

  it('a later owner who sold again does not see the cheques due before they bought', async () => {
    for (const d of dues.slice(0, 2)) {
      expect((await detail('mariam', d.id)).status).toBe(404);
      expect((await image('mariam', d.id)).status).toBe(404);
    }
    expect((await askAbout('mariam', dues[0]!.id)).status).toBe(404);
    for (const d of dues.slice(4)) expect((await detail('mariam', d.id)).status).toBe(404);
  });

  it('the current owner keeps the unit screen cheques, priced at the current share', async () => {
    // The unit screen lists every cheque of a unit the owner holds now, also those due before
    // they bought; each row opens.
    const unitScreen = await w.json<{ cheques: ChequeRow[] }>(`/api/owner/units/${unit}`, {
      token: tok.rashid,
    });
    expect(unitScreen.status).toBe(200);
    expect(unitScreen.body.cheques.map((c) => c.id)).toContain(dues[0]!.id);
    const early = await detail('rashid', dues[0]!.id);
    expect(early.status).toBe(200);
    expect(early.body.shareBp).toBe(10_000);
    // The period list and the calendar still give those to the owners of their due date.
    const list = await periodList('rashid');
    expect(list.body.items.map((c) => c.id)).toEqual(dues.slice(4).map((d) => d.id));
  });
});
