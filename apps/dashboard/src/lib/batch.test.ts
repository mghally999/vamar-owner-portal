import { describe, expect, it } from 'vitest';
import { chunk, IMPORT_BATCH_SIZE } from '@/lib/batch';

describe('import batching', () => {
  it('splits a 5,000-row sheet into commits the API accepts', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => i);
    const batches = chunk(rows, IMPORT_BATCH_SIZE);
    expect(batches).toHaveLength(10);
    expect(batches.every((b) => b.length <= 2000)).toBe(true);
    expect(batches.flat()).toEqual(rows);
    expect(chunk([], 500)).toEqual([]);
  });
});
