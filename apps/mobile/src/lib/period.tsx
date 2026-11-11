/**
 * The period every money screen follows (Home, Expenses, the statement). Chosen once at the top
 * of Home and kept in memory while the app runs; the API resolves presets against today in
 * Asia/Dubai, and the app resolves them too for labels and for the cheque list's date filter.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  firstDayOfMonth,
  formatPeriod,
  isPeriodPreset,
  isPlainDate,
  lastDayOfMonth,
  monthPeriod,
  PERIOD_PRESET_LABEL,
  resolvePreset,
  todayInDubai,
  yearPeriod,
  type Lang,
  type Period,
  type PlainDate,
  type ResolvablePreset,
} from '@vamar/shared';

export type PeriodSelection =
  | { kind: 'preset'; preset: ResolvablePreset }
  | { kind: 'year'; year: number }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'custom'; from: PlainDate; to: PlainDate };

/** What goes on the query string: a preset, or from/to. */
export type PeriodQuery = { preset: ResolvablePreset } | { from: PlainDate; to: PlainDate };

export const DEFAULT_SELECTION: PeriodSelection = { kind: 'preset', preset: 'this_month' };

/** The four quick chips on Home and Expenses. */
export const QUICK_PRESETS: ResolvablePreset[] = [
  'this_month',
  'next_month',
  'next_6_months',
  'this_year',
];

/** The preset a link asks for (`?preset=this_year`), or null when it names none or an unknown one. */
export function presetFromParam(value: unknown): ResolvablePreset | null {
  const v = Array.isArray(value) ? (value as unknown[])[0] : value;
  return isPeriodPreset(v) && v !== 'custom' ? v : null;
}

/** The preset in a URL query string (`?preset=next_month&x=1`). */
export function presetFromSearch(search: string): ResolvablePreset | null {
  return presetFromParam(new URLSearchParams(search).get('preset'));
}

export interface LinkParams {
  preset?: unknown;
  from?: unknown;
  to?: unknown;
}

/**
 * The period a link or a tapped notification asks for: dates (`from`, `to`) win over a preset,
 * because they stay right however late the link is followed. A whole month or a whole calendar
 * year becomes that month or year, so the switcher names it ("October 2026") rather than showing
 * a date range. Null when the link names no usable period.
 */
export function selectionFromLink(params: LinkParams): PeriodSelection | null {
  const first = (v: unknown) => (Array.isArray(v) ? (v as unknown[])[0] : v);
  const from = first(params.from);
  const to = first(params.to);
  if (isPlainDate(from) && isPlainDate(to) && from <= to) {
    const [y, m] = from.split('-').map(Number) as [number, number];
    if (from === firstDayOfMonth(from) && to === lastDayOfMonth(from))
      return { kind: 'month', year: y, month: m };
    if (from === `${String(y)}-01-01` && to === `${String(y)}-12-31`)
      return { kind: 'year', year: y };
    return { kind: 'custom', from, to };
  }
  const preset = presetFromParam(params.preset);
  return preset ? { kind: 'preset', preset } : null;
}

/** The period in a URL query string, as `selectionFromLink`. */
export function selectionFromSearch(search: string): PeriodSelection | null {
  return selectionFromLink(Object.fromEntries(new URLSearchParams(search)));
}

/**
 * The web app opened on a link with a period (a notification or a shared `/app/?preset=this_year`
 * or `/app/?from=2026-10-01&to=2026-10-31`).
 * The router drops the query of its index route while it starts, so the address is read here,
 * once, when the bundle loads. Native apps have no `window.location`; their links arrive as route
 * params instead (see Home).
 */
// React Native defines `window` without `location`, which the DOM types do not allow for.
const launchLocation = (globalThis as { location?: { search?: unknown } }).location;
const launchSearch = typeof launchLocation?.search === 'string' ? launchLocation.search : '';
const launchSelection = selectionFromSearch(launchSearch);

/**
 * The launch link's period when the link also asks for its statement (`statement=1`, as the
 * monthly summary notification does), else null. Native apps get the flag as a route param.
 */
export function launchStatementSelection(search = launchSearch): PeriodSelection | null {
  if (new URLSearchParams(search).get('statement') !== '1') return null;
  return search === launchSearch ? launchSelection : selectionFromSearch(search);
}

/** The period the app starts on: the launch link's period, else this month. */
export function initialSelection(search = launchSearch): PeriodSelection {
  const linked = search === launchSearch ? launchSelection : selectionFromSearch(search);
  return linked ?? DEFAULT_SELECTION;
}

export function resolveSelection(sel: PeriodSelection, today: PlainDate = todayInDubai()): Period {
  switch (sel.kind) {
    case 'preset':
      return resolvePreset(sel.preset, today);
    case 'year':
      return yearPeriod(sel.year);
    case 'month':
      return monthPeriod(sel.year, sel.month);
    case 'custom':
      return { from: sel.from, to: sel.to };
  }
}

export function toQuery(sel: PeriodSelection, today: PlainDate = todayInDubai()): PeriodQuery {
  if (sel.kind === 'preset') return { preset: sel.preset };
  const p = resolveSelection(sel, today);
  return { from: p.from, to: p.to };
}

export function selectionLabel(
  sel: PeriodSelection,
  lang: Lang,
  today: PlainDate = todayInDubai(),
): string {
  if (sel.kind === 'preset') return PERIOD_PRESET_LABEL[sel.preset][lang];
  return formatPeriod(resolveSelection(sel, today), lang);
}

export function sameSelection(a: PeriodSelection, b: PeriodSelection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface PeriodState {
  selection: PeriodSelection;
  setSelection: (s: PeriodSelection) => void;
  period: Period;
  query: PeriodQuery;
}

const Ctx = createContext<PeriodState | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<PeriodSelection>(() => initialSelection());
  const value = useMemo<PeriodState>(
    () => ({
      selection,
      setSelection,
      period: resolveSelection(selection),
      query: toQuery(selection),
    }),
    [selection],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Works without the provider too (a screen rendered alone keeps its own default). */
export function usePeriod(): PeriodState {
  const ctx = useContext(Ctx);
  const [local, setLocal] = useState<PeriodSelection>(DEFAULT_SELECTION);
  if (ctx) return ctx;
  return {
    selection: local,
    setSelection: setLocal,
    period: resolveSelection(local),
    query: toQuery(local),
  };
}
