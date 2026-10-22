/**
 * Keyset pagination cursors. A cursor encodes the sort key and id of the last row returned;
 * the next page asks for rows strictly after it. Never OFFSET.
 */
import { base64url, fromBase64 } from './crypto.js';
import { validation } from '../errors.js';

export interface Cursor {
  key: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return base64url(new TextEncoder().encode(JSON.stringify([cursor.key, cursor.id])));
}

const KEY_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keys are plain dates or ISO instants and ids are uuids, so a forged cursor never reaches SQL. */
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
