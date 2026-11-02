/**
 * The reporting period of a page, kept in the URL (`?preset=this_month` or `?from=&to=`, plus
 * `&compare=1`) so a refresh keeps it and the link can be shared. Resolved with the shared
 * period rules against today in Dubai, so "this year" always means the current calendar year.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import {
  isPeriodPreset,
  isPlainDate,
  previousPeriod,
  resolvePeriodQuery,
  todayInDubai,
  type Period,
  type PeriodPreset,
  type ResolvablePreset,
  type WeekStart,
} from '@vamar/shared';

export interface PeriodSearch {
  preset?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  compare?: string | number | boolean | undefined;
}

export interface PeriodState {
  preset: PeriodPreset;
  period: Period;
  compare: boolean;
  comparison: Period | null;
  /** Query-string fields for the API (`preset=` or `from=&to=`). */
  query: { preset?: string; from?: string; to?: string; compare?: string };
  setPreset: (preset: ResolvablePreset) => void;
  setRange: (from: string, to: string) => void;
  setCompare: (on: boolean) => void;
}

export function isCompareOn(v: PeriodSearch['compare']): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/** Pure part of the hook, also used by tests and by pages that read the search only. */
export function resolvePeriodSearch(
  search: PeriodSearch,
  fallback: ResolvablePreset,
  weekStart?: WeekStart,
): Pick<PeriodState, 'preset' | 'period' | 'compare' | 'comparison' | 'query'> {
  const from =
    typeof search.from === 'string' && isPlainDate(search.from) ? search.from : undefined;
  const to = typeof search.to === 'string' && isPlainDate(search.to) ? search.to : undefined;
  const preset = isPeriodPreset(search.preset) ? search.preset : undefined;
  const resolved = resolvePeriodQuery(
    { preset, from, to: to !== undefined && from !== undefined && to >= from ? to : undefined },
    todayInDubai(),
    { fallback, weekStart },
  );
  const compare = isCompareOn(search.compare);
  const query =
    resolved.preset === 'custom'
      ? { from: resolved.period.from, to: resolved.period.to }
      : { preset: resolved.preset };
  return {
    preset: resolved.preset,
    period: resolved.period,
    compare,
    comparison: compare ? previousPeriod(resolved.period) : null,
    query: compare ? { ...query, compare: '1' } : query,
  };
}

export function usePeriodSearch(
  fallback: ResolvablePreset = 'this_month',
  weekStart?: WeekStart,
): PeriodState {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- routes carry no search schema
  const search = useSearch({ strict: false }) as PeriodSearch;
  const navigate = useNavigate();
  const resolved = useMemo(
    () => resolvePeriodSearch(search, fallback, weekStart),
    [search, fallback, weekStart],
  );
  const patch = useCallback(
    (next: PeriodSearch) => {
      void navigate({
        to: '.',
        replace: true,
        search: (prev: Record<string, unknown>) => {
          const out: Record<string, unknown> = { ...prev };
          delete out['preset'];
          delete out['from'];
          delete out['to'];
          delete out['compare'];
          for (const [k, v] of Object.entries(next)) if (v !== undefined) out[k] = v;
          return out;
        },
      } as never);
    },
    [navigate],
  );
  return {
    ...resolved,
    setPreset: (preset) => {
      patch({ preset, compare: resolved.compare ? '1' : undefined });
    },
    setRange: (from, to) => {
      patch({ from, to, compare: resolved.compare ? '1' : undefined });
    },
    setCompare: (on) => {
      patch({
        ...(resolved.preset === 'custom'
          ? { from: resolved.period.from, to: resolved.period.to }
          : { preset: resolved.preset }),
        compare: on ? '1' : undefined,
      });
    },
  };
}
