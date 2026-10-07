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

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64(raw)));
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { key: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
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
