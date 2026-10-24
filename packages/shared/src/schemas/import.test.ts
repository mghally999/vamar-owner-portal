import { describe, expect, it } from 'vitest';
import {
  aedAmountToFils,
  changeOwnerPhoneSchema,
  createOwnerSchema,
  importChequeRowSchema,
  importContractRowSchema,
  importShareRowSchema,
  ownerPhoneSchema,
  parseCountryList,
  phoneInCountries,
  sharePctToBp,
  unitKey,
  UAE_MOBILE_MESSAGE,
} from './index.js';

const owner = (phoneE164: string, preferredLang?: string) =>
  createOwnerSchema.safeParse({
    nameAr: 'مالك',
    nameEn: 'Owner',
    phoneE164,
    ...(preferredLang ? { preferredLang } : {}),
  });

describe('owner phones are UAE mobile numbers', () => {
  it('accepts a UAE mobile and refuses short, landline and foreign numbers', () => {
    expect(owner('+971501234567').success).toBe(true);
    // "12345" as typed in a sheet becomes +97112345 after normalisation: refused.
    const short = owner('+97112345');
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toBe(UAE_MOBILE_MESSAGE);
    expect(owner('+97142345678').success).toBe(false); // Dubai landline
    expect(owner('+14155550123').success).toBe(false); // valid E.164, not an allowed country
    expect(
      changeOwnerPhoneSchema.safeParse({ phoneE164: '+14155550123', reason: 'move' }).success,
    ).toBe(false);
  });

  it('the message is in English and Arabic', () => {
    expect(UAE_MOBILE_MESSAGE).toContain('UAE mobile');
    expect(UAE_MOBILE_MESSAGE).toContain('إماراتي');
  });

  it('follows the allowed-country list', () => {
    expect(parseCountryList(' ae, sa ,,')).toEqual(['AE', 'SA']);
    expect(phoneInCountries('+966501234567', ['AE'])).toBe(false);
    expect(phoneInCountries('+966501234567', ['AE', 'SA'])).toBe(true);
    expect(phoneInCountries('+14155550123', ['*'])).toBe(true);
    expect(phoneInCountries('+971501234567', ['XX'])).toBe(false);
    expect(ownerPhoneSchema(['AE', 'SA']).safeParse('+966501234567').success).toBe(true);
    const other = ownerPhoneSchema(['SA']).safeParse('+971501234567');
    expect(other.success).toBe(false);
    expect(other.error?.issues[0]?.message).toContain('SA');
  });

  it('refuses an unknown language instead of using Arabic', () => {
    expect(owner('+971501234567', 'en').success).toBe(true);
    const fr = owner('+971501234567', 'fr');
    expect(fr.success).toBe(false);
    expect(fr.error?.issues[0]?.message).toContain('ar or en');
    expect(fr.error?.issues[0]?.message).toContain('اللغة');
  });
});

describe('import rows for shares, contracts and cheques', () => {
  it('shares: percent to basis points, two decimals at most', () => {
    expect(sharePctToBp(100)).toBe(10_000);
    expect(sharePctToBp(33.33)).toBe(3333);
    const row = { building: 'Al Noor Tower', unitNo: 1204, ownerPhone: '+971501234567' };
    const ok = importShareRowSchema.safeParse({ ...row, sharePct: 60 });
    expect(ok.success).toBe(true);
    expect(ok.data?.unitNo).toBe('1204');
    expect(importShareRowSchema.safeParse({ ...row, sharePct: 33.333 }).success).toBe(false);
    expect(importShareRowSchema.safeParse({ ...row, sharePct: 0 }).success).toBe(false);
    expect(importShareRowSchema.safeParse({ ...row, sharePct: 101 }).success).toBe(false);
    expect(
      importShareRowSchema.safeParse({ ...row, ownerPhone: '+14155550123', sharePct: 50 }).success,
    ).toBe(false);
  });

  it('unit keys ignore case and spacing', () => {
    expect(unitKey(' Al Noor Tower ', ' G-02')).toBe(unitKey('al noor tower', 'g-02'));
    expect(unitKey('A', 12)).toBe('a|12');
  });

  it('contracts: AED to fils, dates in order, cheque count bounded', () => {
    const c = {
      building: 'Al Noor Tower',
      unitNo: '1204',
      tenantName: 'Sara Khalil',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      annualRentAed: 63000.5,
      chequeCount: 4,
    };
    const ok = importContractRowSchema.safeParse(c);
    expect(ok.success).toBe(true);
    expect(aedAmountToFils(ok.data!.annualRentAed)).toBe(6_300_050);
    expect(importContractRowSchema.safeParse({ ...c, endDate: '2025-12-31' }).success).toBe(false);
    expect(importContractRowSchema.safeParse({ ...c, chequeCount: 13 }).success).toBe(false);
    expect(importContractRowSchema.safeParse({ ...c, annualRentAed: 10.005 }).success).toBe(false);
    expect(importContractRowSchema.safeParse({ ...c, annualRentAed: -1 }).success).toBe(false);
  });

  it('cheques: belong to a contract start date, sequence 1 to 12', () => {
    const q = {
      building: 'Al Noor Tower',
      unitNo: '1204',
      contractStart: '2026-01-01',
      seq: 1,
      dueDate: '2026-01-01',
      amountAed: 15750,
      chequeNo: 836466,
      bankName: 'Emirates NBD',
    };
    const ok = importChequeRowSchema.safeParse(q);
    expect(ok.success).toBe(true);
    expect(ok.data?.chequeNo).toBe('836466');
    expect(aedAmountToFils(ok.data!.amountAed)).toBe(1_575_000);
    expect(importChequeRowSchema.safeParse({ ...q, seq: 0 }).success).toBe(false);
    expect(importChequeRowSchema.safeParse({ ...q, contractStart: '2026-02-30' }).success).toBe(
      false,
    );
    expect(importChequeRowSchema.safeParse({ ...q, bankName: '' }).success).toBe(false);
  });
});
