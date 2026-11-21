// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider, useI18n } from './i18n';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function withI18n(lang: 'ar' | 'en'): ReturnType<typeof useI18n> {
  localStorage.setItem('vamar.lang', lang);
  let out: ReturnType<typeof useI18n> | null = null;
  function Probe() {
    out = useI18n();
    return null;
  }
  render(
    <LangProvider>
      <Probe />
    </LangProvider>,
  );
  if (!out) throw new Error('no i18n');
  return out;
}

describe('dateTime', () => {
  it('shows the Dubai day and time, across midnight UTC', () => {
    const en = withI18n('en');
    // 21:30 UTC is 01:30 the next day in Dubai.
    expect(en.dateTime('2026-11-20T21:30:00Z')).toBe('21 Nov 2026 01:30');
    expect(en.dateTime(null)).toBe('—');
  });

  it('builds no date formatter per call (the audit log formats one per row)', () => {
    const en = withI18n('en');
    en.dateTime('2026-11-20T08:00:00Z'); // warm the shared formatter
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    for (let i = 0; i < 200; i += 1) en.dateTime(new Date(Date.UTC(2026, 10, 1, i % 24)));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('t', () => {
  it('fills placeholders and leaves a missing one visible', () => {
    const en = withI18n('en');
    expect(en.t('expense_totals', { n: 3, total: 'AED 10' })).toContain('3');
    expect(en.t('expense_totals', { n: 3 })).toContain('{total}');
  });
});
