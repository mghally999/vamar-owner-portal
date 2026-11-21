import { describe, expect, it } from 'vitest';
import { CHEQUE_STATUSES } from '../cheques.js';
import { OWNER_STATUSES } from '../schemas/enums.js';
import {
  CHEQUE_STATUS_LABEL,
  interpolate,
  label,
  OWNER_STATUS_LABEL,
  VACANT_LABEL,
} from './labels.js';

describe('label', () => {
  it('reads one language of a table', () => {
    expect(label(CHEQUE_STATUS_LABEL, 'bounced', 'en')).toBe(CHEQUE_STATUS_LABEL.bounced.en);
    expect(label(CHEQUE_STATUS_LABEL, 'bounced', 'ar')).toBe(CHEQUE_STATUS_LABEL.bounced.ar);
  });

  it('has a non-empty Arabic and English text for every status', () => {
    for (const [statuses, table] of [
      [CHEQUE_STATUSES, CHEQUE_STATUS_LABEL],
      [OWNER_STATUSES, OWNER_STATUS_LABEL],
    ] as const) {
      for (const s of statuses) {
        const row = (table as Record<string, { ar: string; en: string }>)[s];
        expect(row?.ar, s).toMatch(/\S/);
        expect(row?.en, s).toMatch(/\S/);
      }
    }
    expect(label(OWNER_STATUS_LABEL, 'disabled', 'en')).toBe('Disabled');
  });

  it('says since when a unit is vacant, in both languages', () => {
    expect(VACANT_LABEL.en.since('1 Oct 2026')).toBe('Vacant since 1 Oct 2026');
    expect(VACANT_LABEL.ar.since('1 أكتوبر 2026')).toContain('1 أكتوبر 2026');
    expect(VACANT_LABEL.en.never).toBe('Never rented');
  });
});

describe('interpolate', () => {
  it('fills every placeholder, numbers included', () => {
    expect(interpolate('{n} cheques due on {date}', { n: 3, date: '1 Oct' })).toBe(
      '3 cheques due on 1 Oct',
    );
    expect(interpolate('{n} / {n}', { n: 0 })).toBe('0 / 0');
  });

  it('leaves the text alone without values, and a missing value as written', () => {
    expect(interpolate('Hello {name}')).toBe('Hello {name}');
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    expect(interpolate('{a}{b}', { a: 'x' })).toBe('x{b}');
  });

  it('does not treat a value as a pattern', () => {
    expect(interpolate('{v}', { v: '$& {v} $1' })).toBe('$& {v} $1');
  });
});
