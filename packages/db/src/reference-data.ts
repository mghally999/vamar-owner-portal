/**
 * The default rows the migrations insert: expense categories, the UAE public holidays and the app
 * settings (migration 0007), plus the settings added later (0010: owner approval of large repairs).
 * Scripts that empty every application table (the demo reset, the go-live blank start) put them
 * back with `restoreReferenceData`, read from the migrations themselves so there is one list. The
 * inserts are idempotent (ON CONFLICT DO NOTHING).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, type SQL } from 'drizzle-orm';

export const REFERENCE_TABLES = ['expense_categories', 'holidays', 'app_settings'] as const;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Each migration that inserts reference rows, and how many reference INSERTs it holds. */
export const REFERENCE_MIGRATIONS = [
  { file: '0007_v2_categories_holidays_settings.sql', inserts: 3 },
  { file: '0010_v3_repair_approvals.sql', inserts: 1 },
] as const;

function insertsOf(file: string, expected: number): string[] {
  const path = join(MIGRATIONS_DIR, file);
  const statements = readFileSync(path, 'utf8')
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
  if (statements.length !== expected) {
    throw new Error(
      `expected ${String(expected)} reference INSERTs in ${path}, found ${String(statements.length)}`,
    );
  }
  return statements;
}

/** The INSERT statements for the reference tables, in migration order. */
export function referenceInserts(): string[] {
  return REFERENCE_MIGRATIONS.flatMap((m) => insertsOf(m.file, m.inserts));
}

export async function restoreReferenceData(db: {
  execute: (query: SQL) => PromiseLike<unknown>;
}): Promise<void> {
  for (const statement of referenceInserts()) await db.execute(sql.raw(statement));
}
