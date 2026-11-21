/**
 * Keyset pagination cursors. A cursor encodes the sort key and id of the last row returned;
 * the next page asks for rows strictly after it. Never OFFSET.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { base64url, fromBase64 } from './crypto.js';
import { validation } from '../errors.js';

export interface Cursor {
  key: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return base64url(new TextEncoder().encode(JSON.stringify([cursor.key, cursor.id])));
}

/** Dates, ISO instants, or a short name (building lists sort by name); never SQL-shaped text. */
const KEY_RE = /^(\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z)?|[^'";\\]{1,120})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keys are dates, instants or plain names and ids are uuids; everything is still bound as a parameter. */
export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64(raw)));
  } catch {
    throw validation('Invalid cursor');
  }
  if (
    Array.isArray(parsed) &&
    typeof parsed[0] === 'string' &&
    typeof parsed[1] === 'string' &&
    KEY_RE.test(parsed[0]) &&
    UUID_RE.test(parsed[1])
  ) {
    return { key: parsed[0], id: parsed[1] };
  }
  throw validation('Invalid cursor');
}

/** Take `limit` rows from a `limit + 1` query and compute the next cursor. */
export function page<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => Cursor,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor(keyOf(last)) : null;
  return { items, nextCursor };
}

// Sorted lists ------------------------------------------------------------------------------------

export type SortDir = 'asc' | 'desc';

/**
 * How a sort key is carried in the cursor: dates as `YYYY-MM-DD`, instants as ISO with
 * microseconds (Postgres precision; a JS Date would drop them and skip rows written in the same
 * millisecond), numbers as integer text, enums and text as they are. Every value is bound as a
 * parameter; the kind only decides how the cursor value is checked.
 */
export type SortKind = 'date' | 'instant' | 'number' | 'enum' | 'text';

export interface SortColumn {
  /**
   * The ordered expression. Never null: wrap a nullable column in `coalesce` (missing values sort
   * as the lowest), because a row comparison with null matches nothing.
   */
  expr: SQL | AnyPgColumn;
  kind: SortKind;
}

export interface SortSpec<K extends string> {
  columns: Record<K, SortColumn>;
  /** Tie-breaker, ordered in the same direction as the sort column. */
  id: AnyPgColumn;
  default: { sort: K; dir: SortDir };
}

export interface SortChoice<K extends string> {
  sort: K;
  dir: SortDir;
}

/** A list's sort allow-list; the column names are inferred from `columns`. */
export function defineSort<C extends Record<string, SortColumn>>(spec: {
  columns: C;
  id: AnyPgColumn;
  default: { sort: keyof C & string; dir: SortDir };
}): SortSpec<keyof C & string> {
  return spec;
}

/**
 * The `sort` and `dir` query parameters checked against the list's allow-list (422 otherwise).
 * Missing ones fall back to the list's default order; `dir` alone applies to the default column.
 */
export function sortFrom<K extends string>(
  spec: SortSpec<K>,
  query: { sort?: string | undefined; dir?: string | undefined },
): SortChoice<K> {
  const keys = Object.keys(spec.columns) as K[];
  const sort = query.sort ?? spec.default.sort;
  if (!keys.includes(sort as K))
    throw validation('Invalid request', [
      { path: 'sort', message: `Sort by one of: ${keys.join(', ')}` },
    ]);
  const dir = query.dir ?? (query.sort ? 'asc' : spec.default.dir);
  if (dir !== 'asc' && dir !== 'desc')
    throw validation('Invalid request', [{ path: 'dir', message: 'Use asc or desc' }]);
  return { sort: sort as K, dir };
}

const VALUE_RE: Record<SortKind, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  instant: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/,
  number: /^-?\d{1,20}$/,
  enum: /^[a-z_]{1,40}$/,
  text: /^[\s\S]{0,300}$/,
};

/** The sort key as text, exactly as the cursor carries it. */
function keyText(col: SortColumn): SQL<string> {
  if (col.kind === 'instant')
    return sql<string>`to_char(${col.expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  return sql<string>`(${col.expr})::text`;
}

/**
 * Keyset pagination for a list sorted by any allow-listed column. Add `sortKey` to the select,
 * `after` to the conditions and `orderBy` to the query, fetch `limit + 1` rows and pass them to
 * `page`. The cursor names its sort, so a cursor from another order is refused instead of
 * returning a wrong page. Cursors made before sorting existed (`[key, id]`) still work for the
 * default order.
 */
export function sortedKeyset<K extends string>(
  spec: SortSpec<K>,
  choice: SortChoice<K>,
  rawCursor: string | undefined,
) {
  const col = spec.columns[choice.sort];
  const tag = `${choice.sort}.${choice.dir}`;
  const cursor = decodeSortCursor(rawCursor, col.kind, tag, spec, choice);
  const direction = choice.dir === 'asc' ? sql`asc` : sql`desc`;
  const cmp = choice.dir === 'asc' ? sql`>` : sql`<`;
  return {
    sortKey: keyText(col),
    after: cursor ? sql`(${col.expr}, ${spec.id}) ${cmp} (${cursor.key}, ${cursor.id})` : undefined,
    orderBy: [sql`${col.expr} ${direction}`, sql`${spec.id} ${direction}`],
    page<T extends { sortKey: string; id: string }>(
      rows: T[],
      limit: number,
    ): { items: Omit<T, 'sortKey'>[]; nextCursor: string | null } {
      const taken = rows.slice(0, limit);
      const last = taken[taken.length - 1];
      const nextCursor =
        rows.length > limit && last
          ? base64url(new TextEncoder().encode(JSON.stringify([last.sortKey, last.id, tag])))
          : null;
      return { items: taken.map(({ sortKey: _k, ...rest }) => rest), nextCursor };
    },
  };
}

function decodeSortCursor<K extends string>(
  raw: string | undefined,
  kind: SortKind,
  tag: string,
  spec: SortSpec<K>,
  choice: SortChoice<K>,
): Cursor | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64(raw)));
  } catch {
    throw validation('Invalid cursor');
  }
  if (!Array.isArray(parsed)) throw validation('Invalid cursor');
  const [key, id, cursorTag] = parsed as unknown[];
  const isDefault = choice.sort === spec.default.sort && choice.dir === spec.default.dir;
  const tagOk = parsed.length === 3 ? cursorTag === tag : parsed.length === 2 && isDefault;
  if (
    !tagOk ||
    typeof key !== 'string' ||
    typeof id !== 'string' ||
    !UUID_RE.test(id) ||
    !VALUE_RE[kind].test(key)
  )
    throw validation('Invalid cursor');
  return { key, id };
}
