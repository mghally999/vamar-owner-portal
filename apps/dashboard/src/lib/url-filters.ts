/**
 * A list page's filters, kept in the URL search instead of component state, so a reload, a shared
 * link and Back from a detail page all bring the same list back. Values are strings ('' = no
 * filter, '1' = a ticked checkbox); a value equal to its default is left out of the URL.
 * Changes replace the history entry, so Back leaves the list instead of undoing each filter.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounced } from './hooks';

export type FilterValues<K extends string> = Record<K, string>;

/** The search value as the page uses it: TanStack parses `?n=30` to a number, `?a=true` to a boolean. */
function asText(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/** Pure part of the hook: the filters read from a search object. */
export function readFilters<K extends string>(
  search: Record<string, unknown>,
  defaults: FilterValues<K>,
): FilterValues<K> {
  const out = { ...defaults };
  for (const k of Object.keys(defaults) as K[]) {
    const v = asText(search[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Pure part of the hook: the next search object after a change of some filters. */
export function patchSearch<K extends string>(
  prev: Record<string, unknown>,
  patch: Partial<FilterValues<K>>,
  defaults: FilterValues<K>,
): Record<string, unknown> {
  const changed = new Set<string>(Object.keys(patch));
  const out = Object.fromEntries(Object.entries(prev).filter(([k]) => !changed.has(k)));
  for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
    if (v === undefined || v === defaults[k]) continue;
    // Whole numbers go in as numbers: TanStack would write the string '30' as `"30"` (quoted).
    out[k] = /^(0|[1-9]\d{0,14})$/.test(v) ? Number(v) : v;
  }
  return out;
}

/**
 * `defaults` names the filters the page owns; keep it a module constant. Other search keys (the
 * period, links from the Overview) are left as they are.
 */
export function useUrlFilters<K extends string>(
  defaults: FilterValues<K>,
): [FilterValues<K>, (patch: Partial<FilterValues<K>>) => void] {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const values = useMemo(
    () => readFilters(search as Record<string, unknown>, defaults),
    [search, defaults],
  );
  const set = useCallback(
    (patch: Partial<FilterValues<K>>) => {
      void navigate({
        to: '.',
        replace: true,
        search: (prev: Record<string, unknown>) => patchSearch(prev, patch, defaults),
      } as never);
    },
    [navigate, defaults],
  );
  return [values, set];
}

/**
 * A search box over a URL filter: the input follows every keystroke, the URL (and so the query)
 * follows 300 ms after typing stops. A change of the URL from outside (Back, a link, a cleared
 * filter) is copied into the box.
 */
export function useUrlSearchText(
  value: string,
  commit: (text: string) => void,
  delayMs = 300,
): [string, (text: string) => void] {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text.trim(), delayMs);
  /** What the URL holds as far as this box knows. */
  const committed = useRef(value);
  /** The settled text last seen: only a new one is sent, never a stale one again. */
  const settled = useRef(debounced);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    if (debounced === settled.current) return;
    settled.current = debounced;
    if (debounced === committed.current) return;
    committed.current = debounced;
    commitRef.current(debounced);
  }, [debounced]);
  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setText(value);
  }, [value]);
  return [text, setText];
}
