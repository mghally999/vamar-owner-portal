/** Import batching (pure, unit tested). */
/** Rows per commit request (the API accepts at most 2,000). */
export const IMPORT_BATCH_SIZE = 500;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
