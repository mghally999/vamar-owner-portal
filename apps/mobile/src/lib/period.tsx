/**
 * The period every money screen follows (Home, Expenses, the statement). Chosen once at the top
 * of Home and kept in memory while the app runs; the API resolves presets against today in
 * Asia/Dubai, and the app resolves them too for labels and for the cheque list's date filter.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  formatPeriod,
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
  const [selection, setSelection] = useState<PeriodSelection>(DEFAULT_SELECTION);
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
