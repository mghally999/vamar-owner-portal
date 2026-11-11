import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PlainDate } from './dates.js';
import {
  dubaiRentCap,
  emirateFromArea,
  isRenewalDue,
  marketReference,
  medianInt,
  renewContractSchema,
  renewalCap,
  renewalDueInDays,
  rentPerSqftFils,
  suggestedRenewalRent,
  type ComparableCandidate,
  type RenewalSubject,
} from './renewals.js';

describe('dubaiRentCap (Decree No. 43 of 2013)', () => {
  const REF = 100_000;
  it.each([
    // current rent, allowed increase %, why
    [130_000, 0, 'above the reference'],
    [100_000, 0, 'at the reference'],
    [90_001, 0, 'just under 10 % below'],
    [90_000, 0, 'exactly 10 % below'],
    [89_999, 5, 'just over 10 % below'],
    [89_000, 5, '11 % below'],
    [80_000, 5, 'exactly 20 % below'],
    [79_999, 10, 'just over 20 % below'],
    [79_000, 10, '21 % below'],
    [70_000, 10, 'exactly 30 % below'],
    [69_999, 15, 'just over 30 % below'],
    [69_000, 15, '31 % below'],
    [60_000, 15, 'exactly 40 % below'],
    [59_999, 20, 'just over 40 % below'],
    [59_000, 20, '41 % below'],
    [1, 20, 'almost nothing'],
  ] as const)('current %i against 100,000 allows %i %% (%s)', (current, pct, _why) => {
    const cap = dubaiRentCap(current, REF);
    expect(cap.increasePct).toBe(pct);
    expect(cap.maxRentFils).toBe(current + Math.floor((current * pct) / 100));
  });

  it('rounds the maximum down to the fils and reports the gap in basis points', () => {
    expect(dubaiRentCap(89_999, REF)).toEqual({
      belowReferenceBp: 1000,
      increasePct: 5,
      maxRentFils: 94_498, // 94,498.95
    });
    expect(dubaiRentCap(7_000_000, 10_000_000)).toEqual({
      belowReferenceBp: 3000,
      increasePct: 10,
      maxRentFils: 7_700_000,
    });
    expect(dubaiRentCap(120_000, REF).belowReferenceBp).toBe(-2000);
  });

  it('refuses non-integer or non-positive rents', () => {
    expect(() => dubaiRentCap(0, REF)).toThrow(RangeError);
    expect(() => dubaiRentCap(100.5, REF)).toThrow(RangeError);
    expect(() => dubaiRentCap(100, 0)).toThrow(RangeError);
  });

  it('never lets the new rent pass the reference and never lowers it (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000_000 }),
        fc.integer({ min: 1, max: 10_000_000_000 }),
        (current, ref) => {
          const cap = dubaiRentCap(current, ref);
          expect(cap.maxRentFils).toBeGreaterThanOrEqual(current);
          if (cap.increasePct > 0) expect(cap.maxRentFils).toBeLessThan(ref);
          // A lower current rent never allows a smaller step.
          if (current > 1)
            expect(dubaiRentCap(current - 1, ref).increasePct).toBeGreaterThanOrEqual(
              cap.increasePct,
            );
        },
      ),
    );
  });
});

describe('emirateFromArea', () => {
  it.each([
    ['Business Bay, Dubai', 'dubai'],
    ['Al Khan, Sharjah', 'sharjah'],
    ['Al Nahda, Sharjah', 'sharjah'],
    ['Al Nahda, Dubai', 'dubai'],
    ['Dubai Marina', 'dubai'],
    ['الخان، الشارقة', 'sharjah'],
    ['البرشاء، دبي', 'dubai'],
    ['Al Reem Island, Abu Dhabi', 'abu_dhabi'],
    ['Al Nuaimiya, Ajman', 'ajman'],
    ['Al Nahda', null],
    ['', null],
  ] as const)('%s -> %s', (area, emirate) => {
    expect(emirateFromArea(area)).toBe(emirate);
  });
});

describe('rentPerSqftFils and medianInt', () => {
  it('rounds per sq ft half up to the fils', () => {
    expect(rentPerSqftFils(7_800_000, 1200)).toBe(6500);
    expect(rentPerSqftFils(1000, 3)).toBe(333);
    expect(rentPerSqftFils(1000, 400)).toBe(3); // 2.5 -> 3
    expect(() => rentPerSqftFils(1000, 0)).toThrow(RangeError);
    expect(() => rentPerSqftFils(0, 1200)).toThrow(RangeError);
    expect(() => rentPerSqftFils(1.5, 1200)).toThrow(RangeError);
    expect(() => rentPerSqftFils(1000, 1.5)).toThrow(RangeError);
  });

  it('takes the middle value, or the rounded mean of the middle two', () => {
    expect(medianInt([5])).toBe(5);
    expect(medianInt([9, 1, 5])).toBe(5);
    expect(medianInt([1, 2, 3, 4])).toBe(3); // 2.5 -> 3
    expect(medianInt([4, 2])).toBe(3);
    expect(() => medianInt([])).toThrow(RangeError);
  });
});

const TODAY: PlainDate = '2026-10-07';
const subject: RenewalSubject = {
  contractId: 'c-subject',
  unitId: 'u-subject',
  buildingId: 'b-home',
  area: 'Al Barsha, Dubai',
  unitType: 'apartment',
  bedrooms: 2,
  sizeSqft: 1000,
};

let n = 0;
function cand(over: Partial<ComparableCandidate>): ComparableCandidate {
  n += 1;
  return {
    contractId: `c-${String(n).padStart(3, '0')}`,
    unitId: `u-${String(n).padStart(3, '0')}`,
    unitNo: String(100 + n),
    buildingId: 'b-home',
    buildingNameAr: 'بناية',
    buildingNameEn: 'Home',
    area: 'Al Barsha, Dubai',
    unitType: 'apartment',
    bedrooms: 2,
    sizeSqft: 1000,
    startDate: '2026-05-01',
    annualRentFils: 8_000_000,
    status: 'active',
    ...over,
  };
}

describe('marketReference', () => {
  it('counts one contract per unit: the latest start, and on the same day the later id', () => {
    const r = marketReference(
      subject,
      [
        cand({
          unitId: 'u-a',
          contractId: 'c-a1',
          startDate: '2026-04-01',
          annualRentFils: 6_000_000,
        }),
        cand({
          unitId: 'u-a',
          contractId: 'c-a2',
          startDate: '2026-04-01',
          annualRentFils: 9_000_000,
        }),
        cand({
          unitId: 'u-a',
          contractId: 'c-a0',
          startDate: '2026-02-01',
          annualRentFils: 1_000_000,
        }),
        cand({
          unitId: 'u-b',
          contractId: 'c-b1',
          startDate: '2026-04-01',
          annualRentFils: 8_000_000,
        }),
        cand({
          unitId: 'u-c',
          contractId: 'c-c1',
          startDate: '2026-04-01',
          annualRentFils: 7_000_000,
        }),
      ],
      TODAY,
    );
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    // u-a counts once, with its later contract of the same day; equal dates list by id.
    expect(r.comparables.map((c) => c.contractId)).toEqual(['c-a2', 'c-b1', 'c-c1']);
    expect(r.medianFilsPerSqft).toBe(8000);
  });

  it('uses the same building when it has three comparables, with median and range', () => {
    const r = marketReference(
      subject,
      [
        cand({ annualRentFils: 7_000_000, startDate: '2026-03-01' }),
        cand({ annualRentFils: 9_000_000, startDate: '2026-09-01' }),
        cand({ annualRentFils: 8_000_000, startDate: '2026-06-01' }),
        // Same area, other building: not needed once the building has enough.
        cand({ buildingId: 'b-other', annualRentFils: 20_000_000 }),
      ],
      TODAY,
    );
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.scope).toBe('building');
    expect(r.comparables.map((c) => c.startDate)).toEqual([
      '2026-09-01',
      '2026-06-01',
      '2026-03-01',
    ]);
    expect(r.medianFilsPerSqft).toBe(8000);
    expect(r.minFilsPerSqft).toBe(7000);
    expect(r.maxFilsPerSqft).toBe(9000);
    expect(r.referenceRentFils).toBe(8_000_000);
  });

  it('widens to the area, then the emirate, and stops at the first with enough', () => {
    const inArea = marketReference(
      subject,
      [cand({}), cand({ buildingId: 'b-2' }), cand({ buildingId: 'b-3' })],
      TODAY,
    );
    expect(inArea.status === 'ok' && inArea.scope).toBe('area');

    const inEmirate = marketReference(
      subject,
      [
        cand({}),
        cand({ buildingId: 'b-2', area: 'Business Bay, Dubai' }),
        cand({ buildingId: 'b-3', area: 'JLT, Dubai' }),
        cand({ buildingId: 'b-4', area: 'Al Khan, Sharjah' }),
      ],
      TODAY,
    );
    expect(inEmirate.status).toBe('ok');
    expect(inEmirate.status === 'ok' && inEmirate.scope).toBe('emirate');
    expect(inEmirate.comparables.map((c) => c.buildingId).sort()).toEqual(['b-2', 'b-3', 'b-home']);
  });

  it('says there is not enough data below three, and still lists what it found', () => {
    const r = marketReference(subject, [cand({}), cand({ buildingId: 'b-2' })], TODAY);
    expect(r.status).toBe('not_enough_data');
    expect(r.comparables).toHaveLength(2);
    expect(r.status === 'not_enough_data' && r.scope).toBe('emirate');
  });

  it('does not search the whole country when the area names no emirate', () => {
    const r = marketReference(
      { ...subject, area: 'Al Barsha' },
      [
        cand({ area: 'Al Barsha' }),
        cand({ buildingId: 'b-2', area: 'X, Dubai' }),
        cand({ buildingId: 'b-3', area: 'Y, Dubai' }),
      ],
      TODAY,
    );
    expect(r.status === 'not_enough_data' && r.scope).toBe('area');
  });

  it('keeps out other types, bedrooms, drafts, the unit itself, old, future and sizeless contracts', () => {
    const excluded = [
      cand({ unitType: 'villa' }),
      cand({ bedrooms: 3 }),
      cand({ bedrooms: null }),
      cand({ status: 'draft' }),
      cand({ unitId: subject.unitId }),
      cand({ startDate: '2025-10-07' }), // exactly 12 months ago: outside
      cand({ startDate: '2026-10-08' }), // starts tomorrow
      cand({ sizeSqft: null }),
    ];
    const kept = [cand({ startDate: '2025-10-08' }), cand({ startDate: TODAY })];
    const r = marketReference(subject, [...excluded, ...kept], TODAY);
    expect(r.comparables.map((c) => c.contractId).sort()).toEqual(
      kept.map((k) => k.contractId).sort(),
    );
  });

  it('counts a unit once, by its latest contract', () => {
    const older = cand({ startDate: '2026-01-01', annualRentFils: 1_000_000 });
    const newer = cand({ unitId: older.unitId, startDate: '2026-08-01' });
    const r = marketReference(subject, [older, newer, cand({}), cand({})], TODAY);
    expect(r.comparables.map((c) => c.contractId)).toContain(newer.contractId);
    expect(r.comparables.map((c) => c.contractId)).not.toContain(older.contractId);
  });

  it('matches shops and offices on null bedrooms', () => {
    const shop: RenewalSubject = { ...subject, unitType: 'shop', bedrooms: null };
    const r = marketReference(
      shop,
      [1, 2, 3].map(() => cand({ unitType: 'shop', bedrooms: null })),
      TODAY,
    );
    expect(r.status).toBe('ok');
  });

  it('needs the unit size to compare per sq ft', () => {
    expect(marketReference({ ...subject, sizeSqft: null }, [cand({})], TODAY).status).toBe(
      'no_size',
    );
  });

  it('median sits within the range and every comparable passes the rules (property)', () => {
    const arb = fc.record({
      building: fc.constantFrom('b-home', 'b-2', 'b-3'),
      area: fc.constantFrom('Al Barsha, Dubai', 'JLT, Dubai', 'Al Khan, Sharjah'),
      bedrooms: fc.constantFrom(1, 2, null),
      size: fc.option(fc.integer({ min: 300, max: 5000 }), { nil: null }),
      rent: fc.integer({ min: 1_000_000, max: 50_000_000 }),
      daysAgo: fc.integer({ min: -30, max: 500 }),
      status: fc.constantFrom('active', 'expired', 'draft', 'renewed'),
    });
    fc.assert(
      fc.property(fc.array(arb, { maxLength: 30 }), (rows) => {
        const cands = rows.map((x, i) =>
          cand({
            contractId: `p-${String(i).padStart(3, '0')}`,
            unitId: `pu-${String(i % 12)}`,
            buildingId: x.building,
            area: x.area,
            bedrooms: x.bedrooms,
            sizeSqft: x.size,
            annualRentFils: x.rent,
            startDate: new Date(Date.parse(`${TODAY}T00:00:00Z`) - x.daysAgo * 86_400_000)
              .toISOString()
              .slice(0, 10) as PlainDate,
            status: x.status,
          }),
        );
        const r = marketReference(subject, cands, TODAY);
        const units = new Set(r.comparables.map((c) => c.unitId));
        expect(units.size).toBe(r.comparables.length);
        for (const c of r.comparables) {
          expect(c.startDate > '2025-10-07' && c.startDate <= TODAY).toBe(true);
        }
        if (r.status === 'ok') {
          expect(r.comparables.length).toBeGreaterThanOrEqual(3);
          expect(r.medianFilsPerSqft).toBeGreaterThanOrEqual(r.minFilsPerSqft);
          expect(r.medianFilsPerSqft).toBeLessThanOrEqual(r.maxFilsPerSqft);
        } else expect(r.comparables.length).toBeLessThan(3);
      }),
    );
  });
});

describe('renewalCap and the suggested rent', () => {
  const ok = marketReference(subject, [cand({}), cand({}), cand({})], TODAY); // 8,000,000
  const thin = marketReference(subject, [cand({})], TODAY);

  it('caps Dubai buildings and suggests the maximum', () => {
    const cap = renewalCap('dubai', 5_000_000, ok);
    expect(cap).toEqual({
      kind: 'dubai',
      belowReferenceBp: 3750,
      increasePct: 15,
      maxRentFils: 5_750_000,
    });
    expect(suggestedRenewalRent(5_000_000, cap)).toBe(5_750_000);
  });

  it('asks staff to check the rules outside Dubai and keeps the current rent', () => {
    for (const e of ['sharjah', 'ajman', null] as const) {
      const cap = renewalCap(e, 5_000_000, ok);
      expect(cap).toEqual({ kind: 'check_emirate_rules' });
      expect(suggestedRenewalRent(5_000_000, cap)).toBe(5_000_000);
    }
  });

  it('cannot cap Dubai without a reference', () => {
    const cap = renewalCap('dubai', 5_000_000, thin);
    expect(cap).toEqual({ kind: 'dubai_no_reference' });
    expect(suggestedRenewalRent(5_000_000, cap)).toBe(5_000_000);
  });
});

describe('renewal reminders', () => {
  it('counts days to the end and flags active contracts in the 90-day window', () => {
    expect(renewalDueInDays('2026-10-21', TODAY)).toBe(14);
    expect(renewalDueInDays(TODAY, TODAY)).toBe(0);
    expect(isRenewalDue('active', '2027-01-05', TODAY)).toBe(true); // day 90
    expect(isRenewalDue('active', '2027-01-06', TODAY)).toBe(false); // day 91
    expect(isRenewalDue('active', '2026-10-06', TODAY)).toBe(false); // already ended
    expect(isRenewalDue('draft', '2026-10-21', TODAY)).toBe(false);
  });

  it('renew body: rent optional, positive whole fils', () => {
    expect(renewContractSchema.parse({})).toEqual({});
    expect(renewContractSchema.parse({ annualRentFils: 9_000_000 })).toEqual({
      annualRentFils: 9_000_000,
    });
    expect(renewContractSchema.safeParse({ annualRentFils: 0 }).success).toBe(false);
    expect(renewContractSchema.safeParse({ annualRentFils: 1.5 }).success).toBe(false);
  });
});
