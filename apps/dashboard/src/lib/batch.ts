/** Import batching (pure, unit tested). */
/** Rows per commit request (the API accepts at most 2,000). */
export const IMPORT_BATCH_SIZE = 500;

/** The shared helper, which also refuses a size below 1 instead of looping forever. */
export { chunk } from '@vamar/shared';
