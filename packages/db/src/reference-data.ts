/**
 * The default rows the migrations insert: expense categories, the UAE public holidays and the app
 * settings (migration 0007). Scripts that empty every application table (the demo reset, the
 * go-live blank start) put them back with `restoreReferenceData`, read from the migration itself
 * so there is one list. The inserts are idempotent (ON CONFLICT DO NOTHING).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, type SQL } from 'drizzle-orm';

export const REFERENCE_TABLES = ['expense_categories', 'holidays', 'app_settings'] as const;

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '0007_v2_categories_holidays_settings.sql',
);

/** The INSERT statements of migration 0007 for the reference tables, one per table. */
export function referenceInserts(): string[] {
  const statements = readFileSync(MIGRATION, 'utf8')
    .split('--> statement-breakpoint')
    // Each statement may start with comment lines: keep the SQL only.
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => REFERENCE_TABLES.some((t) => s.startsWith(`INSERT INTO "${t}"`)));
  if (statements.length !== REFERENCE_TABLES.length) {
    throw new Error(
      `expected one INSERT per reference table in ${MIGRATION}, found ${String(statements.length)}`,
    );
  }
  return statements;
}

export async function restoreReferenceData(db: {
  execute: (query: SQL) => PromiseLike<unknown>;
}): Promise<void> {
  for (const statement of referenceInserts()) await db.execute(sql.raw(statement));
}
