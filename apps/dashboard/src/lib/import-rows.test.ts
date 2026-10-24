import { describe, expect, it } from 'vitest';
import {
  cellText,
  coerce,
  excelSerialToDate,
  FIELDS,
  IMPORT_TARGETS,
  importBatches,
  SCHEMAS,
  shapeRow,
} from './import-rows';

const owner = (cells: Record<string, unknown>) => {
  const mapping = Object.fromEntries(FIELDS.owners.map((f) => [f.key, f.key]));
  return SCHEMAS.owners.safeParse(shapeRow('owners', mapping, cells));
};

describe('owner rows', () => {
  const base = { nameAr: 'مالك', nameEn: 'Owner' };

  it('accepts a UAE mobile in any common spelling', () => {
    for (const phone of ['0501234567', '971501234567', '+971 50 123 4567', '00971501234567']) {
      expect(owner({ ...base, phoneE164: phone }).success, phone).toBe(true);
    }
  });

  it('refuses 12345 and a foreign number with an Arabic and English message', () => {
    const short = owner({ ...base, phoneE164: '12345' });
    expect(coerce('phoneE164', '12345')).toBe('+97112345');
    expect(short.success).toBe(false);
    const message = short.error?.issues[0]?.message ?? '';
    expect(message).toContain('UAE mobile');
    expect(message).toContain('إماراتي');
    expect(owner({ ...base, phoneE164: '+14155550123' }).success).toBe(false);
  });

  it('keeps an unknown language so it is refused instead of becoming Arabic', () => {
    expect(coerce('preferredLang', 'fr')).toBe('fr');
    expect(owner({ ...base, phoneE164: '0501234567', preferredLang: 'fr' }).success).toBe(false);
    expect(coerce('preferredLang', 'English')).toBe('en');
    expect(coerce('preferredLang', 'العربية')).toBe('ar');
  });
});

describe('cells', () => {
  it('Excel date serials, Date objects and text dates become YYYY-MM-DD', () => {
    expect(excelSerialToDate(46023)).toBe('2026-01-01');
    expect(coerce('startDate', 46023)).toBe('2026-01-01');
    expect(coerce('dueDate', new Date(Date.UTC(2026, 6, 1)))).toBe('2026-07-01');
    expect(coerce('endDate', ' 2026-12-31 ')).toBe('2026-12-31');
  });

  it('amounts typed with separators or Arabic digits, shares with a percent sign', () => {
    expect(coerce('annualRentAed', '63,000')).toBe(63000);
    expect(coerce('amountAed', '١٥٬٧٥٠.٥٠')).toBe(15750.5);
    expect(coerce('amountAed', 'lots')).toBe('lots');
    expect(coerce('amountAed', 30000)).toBe(30000);
    expect(coerce('sharePct', '60%')).toBe(60);
    expect(coerce('sharePct', 'half')).toBe('half');
  });

  it('numbers, text and empty cells', () => {
    expect(coerce('seq', '2')).toBe(2);
    expect(coerce('unitNo', 1204)).toBe('1204');
    expect(coerce('chequeNo', 836466)).toBe('836466');
    expect(coerce('type', 'Villa')).toBe('villa');
    expect(coerce('nameAr', '   ')).toBeUndefined();
    expect(coerce('nameAr', null)).toBeUndefined();
    expect(cellText(true)).toBe('true');
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    expect(cellText(undefined)).toBe('');
  });
});

describe('new sheets', () => {
  it('every target has fields and a schema', () => {
    for (const t of IMPORT_TARGETS) {
      expect(FIELDS[t].length).toBeGreaterThan(0);
      expect(SCHEMAS[t]).toBeDefined();
    }
  });

  it('a contract row and a cheque row as they come from the template', () => {
    const map = (t: 'contracts' | 'cheques') =>
      Object.fromEntries(FIELDS[t].map((f) => [f.key, f.key]));
    const contract = shapeRow('contracts', map('contracts'), {
      building: 'Al Noor Tower',
      unitNo: 1204,
      tenantName: 'Sara Khalil',
      startDate: 46023,
      endDate: 46387,
      annualRentAed: '63,000',
      chequeCount: '4',
    });
    expect(SCHEMAS.contracts.safeParse(contract).success).toBe(true);
    const cheque = shapeRow('cheques', map('cheques'), {
      building: 'Al Noor Tower',
      unitNo: '1204',
      contractStart: '2026-01-01',
      seq: 1,
      dueDate: 46023,
      amountAed: 15750,
      chequeNo: 836466,
      bankName: 'Emirates NBD',
    });
    expect(SCHEMAS.cheques.safeParse(cheque).success).toBe(true);
  });

  it('batches never split the shares of one unit', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({ data: { building: 'A', unitNo: '1' } })),
      ...Array.from({ length: 3 }, () => ({ data: { building: 'a ', unitNo: 2 } })),
      { data: { building: 'B', unitNo: '1' } },
    ];
    const batches = importBatches('shares', rows, 4);
    expect(batches.map((b) => b.length)).toEqual([3, 4]);
    expect(importBatches('owners', rows, 4).map((b) => b.length)).toEqual([4, 3]);
  });
});
