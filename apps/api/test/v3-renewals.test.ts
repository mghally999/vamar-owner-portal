/**
 * Renewal suggestions (GET /api/staff/contracts/:id/renewal-suggestion) against the seed, with
 * today pinned by the harness (TEST_TODAY = 2026-10-07). The seed's contracts that end within
 * 90 days are Al Safa 201 (Dubai), Mamzar V1 (Sharjah) and Al Noor 801 (renewal already drafted).
 * The market figures are re-derived here with a plainly written query and plain arithmetic.
 */
import { and, eq, gt, lte, ne } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addMonthsClamped } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RenewalSuggestion } from '../src/services/renewals.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

const { contracts, units, buildings, tenants } = schema;

let w: TestWorld;
let viewer: string;
let editor: string;

beforeAll(async () => {
  w = await createWorld();
  viewer = await w.staffToken('viewer@vamar.test');
  editor = await w.staffToken('entry@vamar.test');
});
afterAll(() => w.close());

async function activeContractOf(buildingEn: string, unitNo: string) {
  const [row] = await w.db
    .select({ id: contracts.id, rent: contracts.annualRentFils, endDate: contracts.endDate })
    .from(contracts)
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(
      and(
        eq(buildings.nameEn, buildingEn),
        eq(units.unitNo, unitNo),
        eq(contracts.status, 'active'),
      ),
    );
  if (!row) throw new Error(`no active contract for ${buildingEn} ${unitNo}`);
  return row;
}

const suggestion = (id: string, token = viewer) =>
  w.json<RenewalSuggestion>(`/api/staff/contracts/${id}/renewal-suggestion`, { token });

/** Every non-draft contract on another unit of this type and bedroom count, started in the window. */
async function plainComparables(opts: {
  type: 'apartment' | 'villa' | 'other';
  bedrooms: number;
  exceptUnitNo: string;
  areaLike: (area: string) => boolean;
}) {
  const from = addMonthsClamped(TODAY, -12);
  const rows = await w.db
    .select({
      unitId: units.id,
      unitNo: units.unitNo,
      size: units.sizeSqft,
      area: buildings.area,
      start: contracts.startDate,
      rent: contracts.annualRentFils,
      bedrooms: units.bedrooms,
    })
    .from(contracts)
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(
      and(
        eq(units.type, opts.type),
        ne(contracts.status, 'draft'),
        gt(contracts.startDate, from),
        lte(contracts.startDate, TODAY),
      ),
    );
  return rows.filter(
    (r) => r.bedrooms === opts.bedrooms && r.unitNo !== opts.exceptUnitNo && opts.areaLike(r.area),
  );
}

const perSqft = (rent: number, size: number) => Math.round(rent / size);
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

describe('renewal suggestion on the seed', () => {
  it('Dubai apartment: widens to the emirate, gives median, range, comparables and the cap', async () => {
    const c = await activeContractOf('Al Safa Building', '201');
    const r = await suggestion(c.id);
    expect(r.status).toBe(200);
    const s = r.body;
    expect(s.emirate).toBe('dubai');
    expect(s.dueInDays).toBe(60); // ends 6 Dec 2026
    expect(s.due).toBe(true);
    expect(s.windowDays).toBe(90);
    expect(s.currentRentFils).toBe(c.rent);
    expect(s.market.minComparables).toBe(3);
    expect(s.market.startedAfter).toBe('2025-10-07');

    // Al Safa has only two other 2-bed units let this year and Al Barsha has no other building,
    // so the reference comes from every 2-bed apartment in Dubai.
    const comps = await plainComparables({
      type: 'apartment',
      bedrooms: 2,
      exceptUnitNo: '201',
      areaLike: (a) => a.endsWith('Dubai'),
    });
    expect(comps).toHaveLength(6);
    expect(s.market.status).toBe('ok');
    if (s.market.status !== 'ok') return;
    expect(s.market.scope).toBe('emirate');
    expect(s.market.comparables.map((x) => x.unitNo).sort()).toEqual(
      comps.map((x) => x.unitNo).sort(),
    );
    const values = comps.map((x) => perSqft(x.rent, x.size ?? 0));
    expect(s.market.medianFilsPerSqft).toBe(median(values));
    expect(s.market.minFilsPerSqft).toBe(Math.min(...values));
    expect(s.market.maxFilsPerSqft).toBe(Math.max(...values));
    expect(s.market.referenceRentFils).toBe(median(values) * 1200);
    for (const x of s.market.comparables) {
      expect(x.startDate > '2025-10-07' && x.startDate <= TODAY).toBe(true);
      expect(x.annualRentFils).toBeGreaterThan(0);
    }

    expect(s.cap.kind).toBe('dubai');
    if (s.cap.kind !== 'dubai') return;
    const gapPct = ((s.market.referenceRentFils - c.rent) / s.market.referenceRentFils) * 100;
    const pct = gapPct <= 10 ? 0 : gapPct <= 20 ? 5 : gapPct <= 30 ? 10 : gapPct <= 40 ? 15 : 20;
    expect(s.cap.increasePct).toBe(pct);
    expect(s.cap.maxRentFils).toBe(c.rent + Math.floor((c.rent * pct) / 100));
    expect(s.suggestedRentFils).toBe(s.cap.maxRentFils);
    expect(s.renewal).toBeNull();
  });

  it('Sharjah villa: three comparables in the building, no cap, current rent suggested', async () => {
    const c = await activeContractOf('Mamzar Villas', 'V1');
    const s = (await suggestion(c.id)).body;
    expect(s.emirate).toBe('sharjah');
    expect(s.building.area).toBe('Al Mamzar, Sharjah');
    expect(s.dueInDays).toBe(30); // ends 6 Nov 2026
    expect(s.market.status).toBe('ok');
    expect(s.market.status === 'ok' && s.market.scope).toBe('building');
    expect(s.market.comparables.map((x) => x.unitNo).sort()).toEqual(['V2', 'V3', 'V4']);
    expect(s.cap).toEqual({ kind: 'check_emirate_rules' });
    expect(s.suggestedRentFils).toBe(c.rent);
  });

  it('Al Noor 801: two 1-bed comparables only, so not enough data and no Dubai cap', async () => {
    const c = await activeContractOf('Al Noor Tower', '801');
    const s = (await suggestion(c.id)).body;
    expect(s.dueInDays).toBe(15); // ends 22 Oct 2026
    expect(s.market.status).toBe('not_enough_data');
    // The unit's own earlier contract is not a comparable.
    expect(s.market.comparables.map((x) => x.unitNo).sort()).toEqual(['1205', '2001']);
    expect(s.cap).toEqual({ kind: 'dubai_no_reference' });
    expect(s.suggestedRentFils).toBe(c.rent);
    // The seed already drafted this renewal.
    expect(s.renewal?.status).toBe('draft');
  });

  it('a contract outside the window still gets a suggestion, marked not due', async () => {
    const c = await activeContractOf('Al Noor Tower', '802'); // started 2 months ago
    const s = (await suggestion(c.id)).body;
    expect(s.due).toBe(false);
    expect(s.dueInDays).toBeGreaterThan(90);
  });

  it('refuses drafts, unknown ids and owners; viewers may read', async () => {
    const [draft] = await w.db
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.status, 'draft'));
    expect((await suggestion(draft?.id ?? '')).status).toBe(409);
    expect((await suggestion(crypto.randomUUID())).status).toBe(404);
    const c = await activeContractOf('Mamzar Villas', 'V1');
    const owner = await w.ownerToken('+971500000005');
    expect((await suggestion(c.id, owner)).status).toBe(403);
    expect((await w.request(`/api/staff/contracts/${c.id}/renewal-suggestion`)).status).toBe(401);
  });

  it('the existing "ending within" filter lists the three contracts due in 90 days', async () => {
    const r = await w.json<{ items: { unitId: string; endDate: string }[] }>(
      '/api/staff/contracts?endingWithinDays=90&limit=100',
      { token: viewer },
    );
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.endDate).sort()).toEqual([
      '2026-10-22',
      '2026-11-06',
      '2026-12-06',
    ]);
  });
});

describe('Dubai cap bands through the API', () => {
  it('a unit let at half the reference may go up 20 %', async () => {
    const [tenant] = await w.db.select({ id: tenants.id }).from(tenants).limit(1);
    const buildingId = crypto.randomUUID();
    await w.db.insert(buildings).values({
      id: buildingId,
      nameAr: 'برج الاختبار',
      nameEn: 'Test Tower',
      area: 'Jumeirah Village Circle, Dubai',
    });
    const unitIds = ['S1', 'S2', 'S3', 'S4'].map(() => crypto.randomUUID());
    await w.db.insert(units).values(
      unitIds.map((id, i) => ({
        id,
        buildingId,
        unitNo: `S${String(i + 1)}`,
        type: 'other' as const,
        bedrooms: 0,
        sizeSqft: 500,
      })),
    );
    // Three comparables at 100 AED per sq ft; the subject pays 50 (50 % below).
    const rows = unitIds.map((unitId, i) => ({
      id: crypto.randomUUID(),
      unitId,
      tenantId: tenant?.id ?? '',
      startDate: i === 0 ? addMonthsClamped(TODAY, -11) : addMonthsClamped(TODAY, -i),
      endDate: i === 0 ? '2026-10-31' : addMonthsClamped(TODAY, 12 - i),
      annualRentFils: i === 0 ? 2_500_000 : 5_000_000,
      chequeCount: 1,
      status: 'active' as const,
    }));
    await w.db.insert(contracts).values(rows);
    const subjectId = rows[0]?.id ?? '';

    const s = (await suggestion(subjectId)).body;
    expect(s.market.status === 'ok' && s.market.scope).toBe('building');
    expect(s.market.status === 'ok' && s.market.medianFilsPerSqft).toBe(10_000);
    expect(s.market.status === 'ok' && s.market.referenceRentFils).toBe(5_000_000);
    expect(s.cap).toEqual({
      kind: 'dubai',
      belowReferenceBp: 5000,
      increasePct: 20,
      maxRentFils: 3_000_000,
    });
    expect(s.suggestedRentFils).toBe(3_000_000);

    // "Prepare renewal": the draft takes the rent staff confirmed, the old contract stays active.
    const bad = await w.request(`/api/staff/contracts/${subjectId}/renew`, {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ annualRentFils: 0 }),
    });
    expect(bad.status).toBe(422);
    const read = await w.request(`/api/staff/contracts/${subjectId}/renew`, {
      method: 'POST',
      token: viewer,
      body: JSON.stringify({ annualRentFils: 2_900_000 }),
    });
    expect(read.status).toBe(403);
    const made = await w.json<{ id: string; status: string; annualRentFils: number }>(
      `/api/staff/contracts/${subjectId}/renew`,
      { method: 'POST', token: editor, body: JSON.stringify({ annualRentFils: 2_900_000 }) },
    );
    expect(made.status).toBe(201);
    expect(made.body.status).toBe('draft');
    expect(made.body.annualRentFils).toBe(2_900_000);
    const after = (await suggestion(subjectId)).body;
    expect(after.renewal).toEqual({ id: made.body.id, status: 'draft' });
    expect(after.currentRentFils).toBe(2_500_000);
  });
});
