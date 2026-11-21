/**
 * Saved bank CSV column mappings (settings key `bank_csv_mappings`). The parsing and matching
 * rules that use a mapping are in ../bank-statement.ts, which stays free of zod.
 */
import { z } from 'zod';
import { MAX_BANK_CSV_MAPPINGS, type BankCsvMapping } from '../bank-statement.js';

const column = z.string().trim().min(1).max(120);

/** One bank's mapping; the column fields left out read as null. */
export const bankCsvMappingSchema = z.object({
  bank: z.string().trim().min(1).max(80),
  dateColumn: column,
  amountColumn: column,
  chequeNoColumn: column.nullable().default(null),
  descriptionColumn: column.nullable().default(null),
  signColumn: column.nullable().default(null),
  debitColumn: column.nullable().default(null),
}) satisfies z.ZodType<BankCsvMapping>;

export const bankCsvMappingsSchema = z
  .array(bankCsvMappingSchema)
  .max(MAX_BANK_CSV_MAPPINGS)
  .refine(
    (list) => new Set(list.map((m) => m.bank.toLowerCase())).size === list.length,
    'Each bank name may be used once',
  );

/** Saved mappings as stored; a malformed row reads as "no mappings" rather than breaking the page. */
export function parseBankCsvMappings(value: unknown): BankCsvMapping[] {
  const parsed = bankCsvMappingsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
