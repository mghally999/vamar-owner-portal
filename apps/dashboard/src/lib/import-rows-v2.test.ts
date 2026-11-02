import { describe, expect, it } from 'vitest';
import { coerce, FIELDS, importExpenseRowSchema, SCHEMAS, shapeRow } from './import-rows';

describe('expenses sheet', () => {
  it('coerces dates, amounts, payment words and yes/no cells', () => {
    expect(coerce('invoiceDate', 46000)).toBe('2025-12-09');
    expect(coerce('paidOn', new Date(Date.UTC(2026, 9, 15)))).toBe('2026-10-15');
    expect(coerce('amountAed', '12,400')).toBe(12400);
    expect(coerce('vatAed', '620.00')).toBe(620);
    expect(coerce('paymentMethod', 'تحويل')).toBe('transfer');
    expect(coerce('paymentMethod', 'Cheque')).toBe('cheque');
    expect(coerce('visibleToOwner', 'نعم')).toBe(true);
    expect(coerce('visibleToOwner', 'No')).toBe(false);
    expect(coerce('visibleToOwner', true)).toBe(true);
    expect(coerce('visibleToOwner', 'maybe')).toBe('maybe');
    expect(coerce('invoiceNo', 417)).toBe('417');
    expect(coerce('makaniNo', 2735894120)).toBe('2735894120');
    expect(coerce('completionYear', '2016')).toBe(2016);
    expect(coerce('handoverDate', 46200)).toBe('2026-06-27');
  });
  it('shapes and validates an expense row; a bad one is refused', () => {
    const mapping = Object.fromEntries(FIELDS.expenses.map((f) => [f.key, f.key]));
    const data = shapeRow('expenses', mapping, {
      building: 'Al Noor Tower',
      unitNo: 801,
      category: 'Lifts (repairs)',
      vendor: 'Gulf Lifts',
      reasonAr: 'إصلاح',
      reasonEn: 'Repair',
      invoiceNo: 'GL-1',
      invoiceDate: 46000,
      amountAed: '1,000',
      vatAed: '',
      paidOn: '',
      paymentMethod: 'cash',
      visibleToOwner: 'yes',
    });
    expect(data).toEqual({
      building: 'Al Noor Tower',
      unitNo: '801',
      category: 'Lifts (repairs)',
      vendor: 'Gulf Lifts',
      reasonAr: 'إصلاح',
      reasonEn: 'Repair',
      invoiceNo: 'GL-1',
      invoiceDate: '2025-12-09',
      amountAed: 1000,
      paymentMethod: 'cash',
      visibleToOwner: true,
    });
    expect(SCHEMAS.expenses.safeParse(data).success).toBe(true);
    expect(importExpenseRowSchema.safeParse({ ...data, amountAed: 0 }).success).toBe(false);
    expect(importExpenseRowSchema.safeParse({ ...data, amountAed: 1.005 }).success).toBe(false);
    expect(importExpenseRowSchema.safeParse({ ...data, paymentMethod: 'gold' }).success).toBe(
      false,
    );
  });
  it('units and buildings accept the identifier columns', () => {
    expect(
      SCHEMAS.units.safeParse({
        building: 'A',
        unitNo: '1',
        makaniNo: '2735894120',
        titleDeedNo: 'TD-1',
        handoverDate: '2016-06-01',
      }).success,
    ).toBe(true);
    expect(SCHEMAS.units.safeParse({ building: 'A', unitNo: '1', makaniNo: '12' }).success).toBe(
      false,
    );
    expect(
      SCHEMAS.buildings.safeParse({
        nameAr: 'أ',
        nameEn: 'A',
        area: 'X',
        completionYear: 2016,
        floorsCount: 24,
        plotNo: '346-1180',
      }).success,
    ).toBe(true);
    expect(
      SCHEMAS.buildings.safeParse({ nameAr: 'أ', nameEn: 'A', area: 'X', completionYear: 1800 })
        .success,
    ).toBe(false);
    expect(FIELDS.units.map((f) => f.key)).toContain('dewaPremiseNo');
    expect(FIELDS.buildings.map((f) => f.key)).toContain('floorsCount');
  });
});
