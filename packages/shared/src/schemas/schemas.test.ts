import { describe, expect, it } from 'vitest';
import {
  bulkChequeStatusChangeSchema,
  chequeStatusChangeSchema,
  createContractSchema,
  createOwnerSchema,
  paginationQuerySchema,
  phoneE164Schema,
  plainDateSchema,
  setUnitOwnersSchema,
} from './index.js';

const UUID = '018f3f1e-7b4a-7c1d-9a2b-3c4d5e6f7a8b';

describe('common schemas', () => {
  it('phone must be E.164', () => {
    expect(phoneE164Schema.safeParse('+971501234567').success).toBe(true);
    expect(phoneE164Schema.safeParse('0501234567').success).toBe(false);
    expect(phoneE164Schema.safeParse('+971 50 123 4567').success).toBe(false);
  });

  it('plain dates must be real dates', () => {
    expect(plainDateSchema.safeParse('2026-02-28').success).toBe(true);
    expect(plainDateSchema.safeParse('2026-02-30').success).toBe(false);
  });

  it('pagination coerces and bounds limit', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(paginationQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20 });
    expect(paginationQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
  });
});

describe('owner and ownership', () => {
  it('owner defaults', () => {
    const o = createOwnerSchema.parse({
      nameAr: 'أحمد',
      nameEn: 'Ahmed',
      phoneE164: '+971501234567',
    });
    expect(o.preferredLang).toBe('ar');
    expect(o.email).toBeNull();
  });

  it('shares are bounded (sum is checked by the service)', () => {
    expect(
      setUnitOwnersSchema.safeParse({
        fromDate: '2026-01-01',
        owners: [{ ownerId: UUID, shareBp: 10000 }],
      }).success,
    ).toBe(true);
    expect(
      setUnitOwnersSchema.safeParse({
        fromDate: '2026-01-01',
        owners: [{ ownerId: UUID, shareBp: 0 }],
      }).success,
    ).toBe(false);
    expect(setUnitOwnersSchema.safeParse({ fromDate: '2026-01-01', owners: [] }).success).toBe(
      false,
    );
  });
});

describe('contracts', () => {
  const base = {
    unitId: UUID,
    tenantId: UUID,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    annualRentFils: 10_000_000,
    chequeCount: 4,
  };

  it('accepts a contract without a grid (API generates dates)', () => {
    expect(createContractSchema.safeParse(base).success).toBe(true);
  });

  it('rejects reversed dates and a grid of the wrong length', () => {
    expect(createContractSchema.safeParse({ ...base, endDate: '2025-12-31' }).success).toBe(false);
    expect(
      createContractSchema.safeParse({
        ...base,
        cheques: [
          { seq: 1, dueDate: '2026-01-01', amountFils: null, chequeNo: null, bankName: null },
        ],
      }).success,
    ).toBe(false);
  });

  it('grid amounts must be positive when present', () => {
    const cheques = Array.from({ length: 4 }, (_, i) => ({
      seq: i + 1,
      dueDate: '2026-01-01',
      amountFils: i === 0 ? 0 : null,
      chequeNo: null,
      bankName: null,
    }));
    expect(createContractSchema.safeParse({ ...base, cheques }).success).toBe(false);
  });
});

describe('cheque status changes', () => {
  it('bulk never allows replaced', () => {
    expect(
      bulkChequeStatusChangeSchema.safeParse({ chequeIds: [UUID], to: 'deposited' }).success,
    ).toBe(true);
    expect(
      bulkChequeStatusChangeSchema.safeParse({ chequeIds: [UUID], to: 'replaced' }).success,
    ).toBe(false);
  });

  it('single change accepts a replacement block', () => {
    const r = chequeStatusChangeSchema.safeParse({
      to: 'replaced',
      replacement: { dueDate: '2026-11-01', amountFils: 100, chequeNo: '12', bankName: 'ENBD' },
    });
    expect(r.success).toBe(true);
  });
});
