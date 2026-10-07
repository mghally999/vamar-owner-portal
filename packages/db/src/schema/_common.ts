import { v7 as uuidv7 } from 'uuid';
import { bigint, date, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column helpers shared by every table.
 * - Primary keys are UUID v7 generated in the application (time-ordered, index-friendly).
 *   Postgres 17 on Neon has no native uuidv7(); generating in code keeps dev and prod identical.
 * - Money is bigint fils exposed to TypeScript as `number` (safe far beyond any rent).
 * - Business dates are `date` columns read and written as `YYYY-MM-DD` strings (PlainDate).
 */
export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const fils = () => bigint({ mode: 'number' });

export const plainDate = () => date({ mode: 'string' });

export const instant = () => timestamp({ withTimezone: true, mode: 'date' });

export const createdAt = () => instant().notNull().defaultNow();

export { uuidv7 };
