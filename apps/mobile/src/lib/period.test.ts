import { describe, expect, it } from 'vitest';
import type { PlainDate } from '@vamar/shared';
import {
  DEFAULT_SELECTION,
  initialSelection,
  presetFromParam,
  presetFromSearch,
  QUICK_PRESETS,
  resolveSelection,
  sameSelection,
  selectionLabel,
  toQuery,
} from './period';

const today = '2026-11-02' as PlainDate;

describe('period selection', () => {
  it('defaults to this month and resolves every kind of selection', () => {
    expect(DEFAULT_SELECTION).toEqual({ kind: 'preset', preset: 'this_month' });
    expect(QUICK_PRESETS).toEqual(['this_month', 'next_month', 'next_6_months', 'this_year']);
    expect(resolveSelection({ kind: 'preset', preset: 'this_month' }, today)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(resolveSelection({ kind: 'year', year: 2025 }, today)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
    expect(resolveSelection({ kind: 'month', year: 2028, month: 2 }, today)).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(
      resolveSelection(
        { kind: 'custom', from: '2026-01-05' as PlainDate, to: '2026-01-09' as PlainDate },
        today,
      ),
    ).toEqual({ from: '2026-01-05', to: '2026-01-09' });
  });

  it('sends a preset as a preset and everything else as from/to', () => {
    expect(toQuery({ kind: 'preset', preset: 'last_year' }, today)).toEqual({
      preset: 'last_year',
    });
    expect(toQuery({ kind: 'year', year: 2025 }, today)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('labels selections in both languages with Western digits', () => {
    expect(selectionLabel({ kind: 'preset', preset: 'next_6_months' }, 'en', today)).toBe(
      'Next 6 months',
    );
    expect(selectionLabel({ kind: 'preset', preset: 'this_year' }, 'ar', today)).toBe('هذه السنة');
    expect(selectionLabel({ kind: 'year', year: 2025 }, 'ar', today)).toBe('2025');
    expect(selectionLabel({ kind: 'month', year: 2026, month: 3 }, 'en', today)).toBe('March 2026');
    expect(
      selectionLabel(
        { kind: 'custom', from: '2026-01-05' as PlainDate, to: '2026-01-09' as PlainDate },
        'en',
        today,
      ),
    ).toBe('5 Jan 2026 – 9 Jan 2026');
    expect(sameSelection({ kind: 'year', year: 2025 }, { kind: 'year', year: 2025 })).toBe(true);
    expect(sameSelection({ kind: 'year', year: 2025 }, { kind: 'year', year: 2024 })).toBe(false);
  });
});

describe('period links', () => {
  it('reads a known preset from a link and ignores the rest', () => {
    expect(presetFromSearch('?preset=this_year')).toBe('this_year');
    expect(presetFromSearch('?x=1&preset=next_month')).toBe('next_month');
    expect(presetFromSearch('?preset=custom')).toBeNull();
    expect(presetFromSearch('?preset=next_decade')).toBeNull();
    expect(presetFromSearch('')).toBeNull();
    expect(presetFromParam(['last_year', 'this_month'])).toBe('last_year');
    expect(presetFromParam(undefined)).toBeNull();
  });

  it('starts on the launch link period, else this month', () => {
    expect(initialSelection('?preset=next_6_months')).toEqual({
      kind: 'preset',
      preset: 'next_6_months',
    });
    expect(initialSelection('?preset=bogus')).toEqual(DEFAULT_SELECTION);
    expect(initialSelection()).toEqual(DEFAULT_SELECTION);
  });
});
