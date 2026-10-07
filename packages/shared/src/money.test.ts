import { describe, expect, it } from 'vitest';
import {
  aedToFils,
  assertFils,
  formatAmount,
  formatNumber,
  parseAmountInput,
  sumFils,
} from './money.js';

describe('assertFils / aedToFils', () => {
  it('rejects non-integers', () => {
    expect(assertFils(1_250_000)).toBe(1_250_000);
    expect(() => assertFils(12.5)).toThrow(RangeError);
    expect(() => assertFils(Number.NaN)).toThrow(RangeError);
    expect(() => assertFils(2 ** 53)).toThrow(RangeError);
  });

  it('converts AED to fils with rounding', () => {
    expect(aedToFils(12_500)).toBe(1_250_000);
    expect(aedToFils(0.1 + 0.2)).toBe(30);
  });
});

describe('parseAmountInput', () => {
  it('accepts common staff input forms', () => {
    expect(parseAmountInput('12500')).toBe(1_250_000);
    expect(parseAmountInput('12,500')).toBe(1_250_000);
    expect(parseAmountInput('12,500.50')).toBe(1_250_050);
    expect(parseAmountInput('12500.5')).toBe(1_250_050);
    expect(parseAmountInput(' AED 12,500 ')).toBe(1_250_000);
    expect(parseAmountInput('12500 درهم')).toBe(1_250_000);
    expect(parseAmountInput('١٢٥٠٠')).toBe(1_250_000);
    expect(parseAmountInput('١٢٬٥٠٠٫٢٥')).toBe(1_250_025);
    expect(parseAmountInput('0')).toBe(0);
  });

  it('rejects invalid input', () => {
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('-100')).toBeNull();
    expect(parseAmountInput('12.345')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('1e5')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats Arabic with Western digits and the word درهم after the number', () => {
    expect(formatAmount(1_250_000, 'ar')).toBe('12,500 درهم');
    expect(formatAmount(1_250_050, 'ar')).toBe('12,500.50 درهم');
    expect(formatAmount(0, 'ar')).toBe('0 درهم');
  });

  it('formats English with AED prefix', () => {
    expect(formatAmount(1_250_000, 'en')).toBe('AED 12,500');
    expect(formatAmount(123_456_789, 'en')).toBe('AED 1,234,567.89');
    expect(formatNumber(100, 'en')).toBe('1');
  });

  it('shows decimals only when there are fils', () => {
    expect(formatNumber(1_000_000, 'ar')).toBe('10,000');
    expect(formatNumber(1_000_001, 'ar')).toBe('10,000.01');
  });

  it('never emits Arabic-Indic digits', () => {
    const out = formatAmount(9_876_543_21, 'ar');
    expect(/[٠-٩]/.test(out)).toBe(false);
  });
});

describe('sumFils', () => {
  it('sums and ignores nulls (draft amounts)', () => {
    expect(sumFils([100, null, 250, undefined])).toBe(350);
    expect(sumFils([])).toBe(0);
    expect(() => sumFils([1.5])).toThrow(RangeError);
  });
});
