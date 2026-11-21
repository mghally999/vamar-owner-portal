/**
 * Sortable list columns. The API sorts (`?sort=<column>&dir=asc|desc`, each list with its own
 * allow-list and keyset cursors), so paging stays correct in any order; the choice is kept in the
 * page URL like the filters. A header is a button inside the `th`, which carries `aria-sort`.
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useUrlFilters } from '@/lib/url-filters';
import { cx } from './primitives';

export type SortDir = 'asc' | 'desc';

export interface ListSort<K extends string> {
  /** The chosen column, or null for the list's default order. */
  sort: K | null;
  dir: SortDir;
  /** Query-string fields for the API; empty for the default order. */
  params: { sort?: K; dir?: SortDir };
  /** A new column sorts ascending; the same column again flips the direction. */
  toggle: (column: K) => void;
}

const SORT_FILTERS = { sort: '', dir: '' };

export function useListSort<K extends string>(columns: readonly K[]): ListSort<K> {
  const [v, set] = useUrlFilters(SORT_FILTERS);
  const sort = (columns as readonly string[]).includes(v.sort) ? (v.sort as K) : null;
  const dir: SortDir = v.dir === 'desc' ? 'desc' : 'asc';
  return {
    sort,
    dir,
    params: sort ? { sort, dir } : {},
    toggle: (column) => {
      set({ sort: column, dir: sort === column && dir === 'asc' ? 'desc' : 'asc' });
    },
  };
}

export function SortHeader<K extends string>({
  label,
  column,
  state,
  align = 'start',
}: {
  label: string;
  column: K;
  state: ListSort<K>;
  align?: 'start' | 'end';
}) {
  const active = state.sort === column;
  const Icon = !active ? ArrowUpDown : state.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      aria-sort={active ? (state.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cx('px-4 py-2 font-medium', align === 'end' ? 'text-end' : 'text-start')}
    >
      <button
        type="button"
        onClick={() => {
          state.toggle(column);
        }}
        className={cx(
          'inline-flex min-h-[24px] items-center gap-1 hover:text-ink',
          active && 'text-ink',
        )}
      >
        {label}
        <Icon className={cx('size-3.5 shrink-0', !active && 'opacity-40')} aria-hidden />
      </button>
    </th>
  );
}
