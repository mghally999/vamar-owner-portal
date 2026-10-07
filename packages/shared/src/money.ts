/**
 * Money is always an integer count of fils (1 AED = 100 fils). The database stores bigint;
 * over the wire and in the apps we use JS numbers, which are exact up to 2^53 fils
 * (about 90 trillion AED), far beyond any rent. Every function here rejects non-integers.
 */
import type { Lang } from './dates.js';

export const FILS_PER_AED = 100;

export function assertFils(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of fils, got ${String(value)}`);
  }
  return value;
}

export function aedToFils(aed: number): number {
  const fils = Math.round(aed * FILS_PER_AED);
  return assertFils(fils);
}

/**
 * Parse what a staff member types into an amount field: `12,500`, `12500.50`, `١٢٥٠٠`
 * (Arabic-Indic digits are normalised), with optional AED/درهم text. Returns null when the
 * text is not a valid non-negative amount with at most two decimals.
 */
export function parseAmountInput(input: string): number | null {
  const normalised = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.') // Arabic decimal separator
    .replace(/[\s,٬،]/g, '') // spaces, thousands separators
    .replace(/(aed|درهم|د\.إ\.?)/gi, '')
    .trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalised);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  const fils = whole * FILS_PER_AED + frac;
  return Number.isSafeInteger(fils) ? fils : null;
}

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(lang: Lang, fractionDigits: number): Intl.NumberFormat {
  // `-u-nu-latn` forces Western digits in Arabic.
  const locale = lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE';
  const key = `${locale}/${fractionDigits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      useGrouping: true,
    });
    formatters.set(key, f);
  }
  return f;
}

/** Digits only, grouped: `12,500` or `12,500.50` (decimals only when there are fils). */
export function formatNumber(fils: number, lang: Lang): string {
  assertFils(fils);
  const hasFils = fils % FILS_PER_AED !== 0;
  const text = numberFormat(lang, hasFils ? 2 : 0).format(fils / FILS_PER_AED);
  // Some ICU builds emit U+200F/U+061C marks around numbers in ar locales; strip them.
  return text.replace(/[‎‏؜]/g, '');
}

/**
 * Amount with currency label, Western digits in both languages.
 * ar: `12,500 درهم`, en: `AED 12,500`.
 */
export function formatAmount(fils: number, lang: Lang): string {
  const n = formatNumber(fils, lang);
  return lang === 'ar' ? `${n} درهم` : `AED ${n}`;
}

/** Sum that refuses non-integers and treats null/undefined (draft amounts) as 0. */
export function sumFils(values: Iterable<number | null | undefined>): number {
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    total += assertFils(v);
  }
  return assertFils(total, 'total');
}
