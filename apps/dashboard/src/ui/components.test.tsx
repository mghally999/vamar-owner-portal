// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlainDate } from '@vamar/shared';
import { LangProvider } from '@/lib/i18n';
import { applyTheme, setTheme } from '@/lib/theme';
import { ChequeGrid, type GridRowDraft } from './cheque-grid';
import { Amount } from './primitives';

afterEach(cleanup);

function withLang(lang: 'ar' | 'en', ui: React.ReactNode) {
  localStorage.setItem('vamar.lang', lang);
  return render(<LangProvider>{ui}</LangProvider>);
}

describe('Amount', () => {
  it('puts the currency after the number in Arabic and before it in English', () => {
    const ar = withLang('ar', <Amount fils={1_250_000} />);
    expect(ar.container.textContent).toBe('12,500درهم');
    cleanup();
    const en = withLang('en', <Amount fils={1_250_050} />);
    expect(en.container.textContent).toBe('AED12,500.50');
  });

  it('shows a dash when there is no amount', () => {
    expect(withLang('en', <Amount fils={null} />).container.textContent).toBe('—');
  });
});

const ROWS: GridRowDraft[] = [1, 2, 3, 4].map((seq) => ({
  seq,
  dueDate: `2026-0${seq * 3 - 2}-01` as PlainDate,
  amountText: '',
  chequeNo: '',
  bankName: '',
}));

function Grid({ initial = ROWS }: { initial?: GridRowDraft[] }) {
  const [rows, setRows] = useState(initial);
  return <ChequeGrid rows={rows} annualRentFils={10_000_000} onChange={setRows} />;
}

describe('ChequeGrid', () => {
  it('counts missing rows and fills equal amounts that match the rent', async () => {
    withLang('en', <Grid />);
    expect(screen.getByText('4 rows still need an amount, number or bank')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Fill equal amounts' }));
    for (const seq of [1, 2, 3, 4]) {
      expect(screen.getByLabelText<HTMLInputElement>(`Amount ${seq}`).value).toBe('25000');
    }
    expect(screen.getByText('matches the annual rent')).toBeTruthy();
  });

  it('shows how far a typed total is from the rent', async () => {
    withLang('en', <Grid />);
    await userEvent.type(screen.getByLabelText('Amount 1'), '40,000');
    expect(screen.getByText('60,000 short of the annual rent')).toBeTruthy();
  });

  it('keeps locked rows read-only and leaves them out of the equal split', async () => {
    const locked = ROWS.map((r, i) =>
      i === 0 ? { ...r, amountText: '1000', chequeNo: '1', bankName: 'ENBD', locked: true } : r,
    );
    withLang('en', <Grid initial={locked} />);
    const first = screen.getByLabelText<HTMLInputElement>('Amount 1');
    expect(first.disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Fill equal amounts' }));
    expect(first.value).toBe('1000');
  });

  it('has no accessibility violations in Arabic', async () => {
    const { container } = withLang('ar', <Grid />);
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('remembers the choice and sets data-theme, except for the default theme', () => {
    setTheme('white');
    expect(document.documentElement.dataset['theme']).toBe('white');
    expect(localStorage.getItem('vamar.theme')).toBe('white');
    setTheme('default');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem('vamar.theme', 'neon');
    applyTheme();
    expect(document.documentElement.dataset['theme']).toBeUndefined();
  });
});
