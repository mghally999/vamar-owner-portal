// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlainDate } from '@vamar/shared';
import { LangProvider } from '@/lib/i18n';
import {
  DatePicker,
  DateRangePicker,
  dateToPlain,
  formatTypedDate,
  nonWorkingKind,
  parseTypedDate,
  plainToDate,
  type PlainRange,
} from './date-picker';

// Typing through user-event is slow on a busy machine; CI finishes in a fraction of this.
configure({ asyncUtilTimeout: 30_000 });
vi.setConfig({ testTimeout: 120_000 });

afterEach(() => {
  cleanup();
});

function renderUi(ui: ReactElement, lang: 'ar' | 'en' = 'en') {
  localStorage.setItem('vamar.lang', lang);
  return render(
    <LangProvider>
      <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
    </LangProvider>,
  );
}

describe('date helpers', () => {
  it('round-trips plain dates through local Date objects without drift', () => {
    expect(dateToPlain(plainToDate('2026-02-28'))).toBe('2026-02-28');
    expect(dateToPlain(plainToDate('2028-02-29'))).toBe('2028-02-29');
    expect(dateToPlain(plainToDate('2026-12-31'))).toBe('2026-12-31');
  });
  it('parses what staff type, in Western or Arabic-Indic digits', () => {
    expect(parseTypedDate('15/10/2026')).toBe('2026-10-15');
    expect(parseTypedDate('5-1-2026')).toBe('2026-01-05');
    expect(parseTypedDate('٠١.٠٢.٢٠٢٦')).toBe('2026-02-01');
    expect(parseTypedDate('31/02/2026')).toBeNull();
    // A date pasted as YYYY-MM-DD is accepted; an impossible one is not.
    expect(parseTypedDate('2026-10-15')).toBe('2026-10-15');
    expect(parseTypedDate('2026-02-30')).toBeNull();
    expect(parseTypedDate('')).toBeNull();
    expect(formatTypedDate('2026-10-15')).toBe('15/10/2026');
    expect(formatTypedDate(null)).toBe('');
  });
  it('knows weekends and holidays', () => {
    const holidays = new Set(['2026-12-02']);
    expect(nonWorkingKind('2026-12-02', holidays)).toBe('holiday');
    expect(nonWorkingKind('2026-12-05', holidays)).toBe('weekend');
    expect(nonWorkingKind('2026-12-07', holidays)).toBeNull();
    expect(nonWorkingKind(null, holidays)).toBeNull();
  });
});

describe('typed date edges', () => {
  it('reads Persian digits and dotted dates, and refuses half-typed ones', () => {
    expect(parseTypedDate('۱۵/۱۰/۲۰۲۶')).toBe('2026-10-15');
    expect(parseTypedDate('15.10.2026')).toBe('2026-10-15');
    expect(parseTypedDate('15/10')).toBeNull();
    expect(parseTypedDate('2026-13-01')).toBeNull();
    expect(formatTypedDate('')).toBe('');
    expect(formatTypedDate(undefined)).toBe('');
  });
});

function Single({ initial, holidays }: { initial: PlainDate | null; holidays?: Set<string> }) {
  const [v, setV] = useState<PlainDate | null>(initial);
  return (
    <>
      <DatePicker
        value={v}
        onChange={setV}
        holidays={holidays}
        warnNonWorking
        clearable
        aria-label="Due"
      />
      <output data-testid="value">{v ?? 'none'}</output>
    </>
  );
}

describe('DatePicker', () => {
  it('shows the value as dd/mm/yyyy, accepts a typed date and refuses nonsense', async () => {
    const user = userEvent.setup();
    renderUi(<Single initial="2026-10-15" />);
    const input = screen.getByRole('textbox', { name: 'Due' });
    expect(input).toHaveProperty('value', '15/10/2026');
    await user.clear(input);
    await user.type(input, '20/11/2026{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('2026-11-20');
    await user.clear(input);
    await user.type(input, '99/99/2026');
    await user.tab();
    expect(screen.getByText('Type a date as dd/mm/yyyy.')).toBeTruthy();
    expect(screen.getByTestId('value').textContent).toBe('2026-11-20');
    await user.clear(input);
    await user.tab();
    expect(screen.getByTestId('value').textContent).toBe('none');
  });

  it('opens the calendar, picks a day with our month names and closes on Escape', async () => {
    const user = userEvent.setup();
    renderUi(<Single initial="2026-10-15" />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('October 2026')).toBeTruthy();
    expect(within(dialog).getByText('Mon')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /^Tuesday, October 20/i }));
    expect(screen.getByTestId('value').textContent).toBe('2026-10-20');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('warns about weekends and holidays, and clears', async () => {
    const user = userEvent.setup();
    renderUi(<Single initial="2026-12-05" holidays={new Set(['2026-12-02'])} />);
    expect(screen.getByText('This date falls on a weekend.')).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'Due' });
    await user.clear(input);
    await user.type(input, '02/12/2026{Enter}');
    expect(screen.getByText('This date falls on a public holiday.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(screen.getByTestId('value').textContent).toBe('none');
  });

  it('renders right to left in Arabic with Arabic month and weekday names', async () => {
    const user = userEvent.setup();
    renderUi(<Single initial="2026-10-15" />, 'ar');
    await user.click(screen.getByRole('button', { name: 'فتح التقويم' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('أكتوبر 2026')).toBeTruthy();
    expect(within(dialog).getByText('اثنين')).toBeTruthy();
    expect(dialog.querySelector('.rdp-root')?.getAttribute('dir')).toBe('rtl');
  });
});

function Range() {
  const [v, setV] = useState<PlainRange | null>(null);
  return (
    <>
      <DateRangePicker value={v} onChange={setV} label="Range" defaultMonth="2026-10-01" />
      <output data-testid="value">{v ? `${v.from}..${v.to}` : 'none'}</output>
    </>
  );
}

describe('DatePicker limits and dismissal', () => {
  function Bounded() {
    const [v, setV] = useState<PlainDate | null>(null);
    return (
      <>
        <button type="button">elsewhere</button>
        <DatePicker
          value={v}
          onChange={setV}
          min="2026-10-10"
          max="2026-10-20"
          defaultMonth="2026-10-01"
          weekStart="sunday"
          aria-label="Hearing"
        />
        <output data-testid="value">{v ?? 'none'}</output>
      </>
    );
  }

  it('greys out days outside min and max, closes on a click outside, and an empty field stays empty', async () => {
    const user = userEvent.setup();
    renderUi(<Bounded />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    let dialog = screen.getByRole('dialog');
    // Sunday first when the week starts on Sunday.
    const headers = [...dialog.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers[0]).toBe('Sun');
    expect(
      within(dialog)
        .getByRole('button', { name: /^Monday, October 5/i })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(
      within(dialog)
        .getByRole('button', { name: /^Saturday, October 24/i })
        .hasAttribute('disabled'),
    ).toBe(true);
    // A click inside the calendar keeps it open; a click elsewhere closes it.
    await user.click(within(dialog).getByText('October 2026'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Thursday, October 15/i }));
    expect(screen.getByTestId('value').textContent).toBe('2026-10-15');
    // Leaving an empty field when nothing was chosen changes nothing.
    cleanup();
    renderUi(<Bounded />);
    await user.click(screen.getByRole('textbox', { name: 'Hearing' }));
    await user.tab();
    expect(screen.getByTestId('value').textContent).toBe('none');
  });
});

describe('DateRangePicker', () => {
  it('shows two months and takes a typed range (ordered) or two clicks', async () => {
    const user = userEvent.setup();
    renderUi(<Range />);
    await user.click(screen.getByRole('button', { name: 'Range' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('October 2026')).toBeTruthy();
    expect(within(dialog).getByText('November 2026')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: 'From' }), '20/10/2026');
    await user.type(within(dialog).getByRole('textbox', { name: 'To' }), '05/10/2026{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('2026-10-05..2026-10-20');
    expect(screen.getByRole('button', { name: 'Range' }).textContent).toContain('5 Oct 2026');

    cleanup();
    renderUi(<Range />);
    await user.click(screen.getByRole('button', { name: 'Range' }));
    const again = screen.getByRole('dialog');
    await user.click(within(again).getByRole('button', { name: /^Monday, October 12/i }));
    await user.click(within(again).getByRole('button', { name: /^Friday, October 16/i }));
    expect(screen.getByTestId('value').textContent).toBe('2026-10-12..2026-10-16');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('is a labelled placeholder until something is picked', () => {
    renderUi(<Range />);
    expect(screen.getByRole('button', { name: 'Range' }).textContent).toContain('Date range');
  });

  it('applies from the From field and the Apply button, ignores a half-typed range, and closes on Escape or a second click', async () => {
    const user = userEvent.setup();
    renderUi(<Range />);
    const open = screen.getByRole('button', { name: 'Range' });
    await user.click(open);
    let dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'From' }), '01/10/2026{Enter}');
    // Only one end typed: nothing is applied and the calendar stays open.
    expect(screen.getByTestId('value').textContent).toBe('none');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: 'To' }), '31/10/2026');
    await user.type(within(dialog).getByRole('textbox', { name: 'From' }), '{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('2026-10-01..2026-10-31');
    // The Apply button does the same.
    await user.click(open);
    dialog = screen.getByRole('dialog');
    const to = within(dialog).getByRole('textbox', { name: 'To' });
    await user.clear(to);
    await user.type(to, '15/10/2026');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('value').textContent).toBe('2026-10-01..2026-10-15');
    // Clicking the same day twice gives a one-day range.
    await user.click(open);
    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Wednesday, October 21/i }));
    await user.click(within(dialog).getByRole('button', { name: /^Wednesday, October 21/i }));
    expect(screen.getByTestId('value').textContent).toBe('2026-10-21..2026-10-21');
    // A second click on the trigger closes it; so does Escape.
    await user.click(open);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(open);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(open);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
