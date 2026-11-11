/**
 * Saved bank statement column mappings (one per bank), kept in app_settings under
 * `bank_csv_mappings` as a JSON list. Staff map a bank's CSV once and reuse it every month.
 * Writes lock the row, so two staff saving different banks at the same moment both keep theirs.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  BANK_CSV_MAPPINGS_KEY,
  MAX_BANK_CSV_MAPPINGS,
  parseBankCsvMappings,
  upsertBankCsvMapping,
  type BankCsvMapping,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import { conflict } from '../errors.js';
import { audit, type AuditActor } from './audit.js';

const { appSettings } = schema;

export async function getBankCsvMappings(db: Dbx): Promise<BankCsvMapping[]> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, BANK_CSV_MAPPINGS_KEY));
  return parseBankCsvMappings(row?.value ?? []);
}

async function writeMappings(
  db: Dbx,
  actor: AuditActor,
  before: BankCsvMapping[],
  after: BankCsvMapping[],
): Promise<BankCsvMapping[]> {
  const updatedBy = actor.type === 'staff' ? actor.id : null;
  await db
    .insert(appSettings)
    .values({ key: BANK_CSV_MAPPINGS_KEY, value: after, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: after, updatedBy, updatedAt: new Date() },
    });
  await audit(db, actor, {
    action: 'settings.bank_csv_mappings',
    entityType: 'settings',
    entityId: null,
    before,
    after,
  });
  return after;
}

async function lockedMappings(db: Dbx): Promise<BankCsvMapping[]> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, BANK_CSV_MAPPINGS_KEY))
    .for('update');
  return parseBankCsvMappings(row?.value ?? []);
}

/** Add a bank's mapping or replace the one with the same name (case ignored). */
export async function saveBankCsvMapping(
  db: Dbx,
  actor: AuditActor,
  mapping: BankCsvMapping,
): Promise<BankCsvMapping[]> {
  const before = await lockedMappings(db);
  const after = upsertBankCsvMapping(before, mapping);
  if (after.length > MAX_BANK_CSV_MAPPINGS)
    throw conflict(`At most ${String(MAX_BANK_CSV_MAPPINGS)} bank mappings can be saved`);
  return writeMappings(db, actor, before, after);
}

export async function deleteBankCsvMapping(
  db: Dbx,
  actor: AuditActor,
  bank: string,
): Promise<BankCsvMapping[]> {
  const before = await lockedMappings(db);
  const key = bank.trim().toLowerCase();
  const after = before.filter((m) => m.bank.trim().toLowerCase() !== key);
  if (after.length === before.length) return before;
  return writeMappings(db, actor, before, after);
}
