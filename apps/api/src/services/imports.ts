/**
 * Excel import, server side. The browser parses the sheet (SheetJS) and maps columns; the API
 * receives already-shaped rows. Every row is validated with the shared zod schemas first, then
 * the valid ones are inserted one by one inside a savepoint each, so a row the database rejects
 * fails alone and the rest of the batch still lands. Ownership shares are the one exception: all
 * rows of a unit must add up to 100 %, so they are checked and saved together, in one savepoint
 * per unit. The per-row report is stored on the import row and returned again when the same
 * idempotency key is committed twice; rows imported earlier under another key are refused as
 * duplicates, never inserted twice.
 */
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@vamar/db';
import {
  aedAmountToFils,
  createBuildingSchema,
  createOwnerSchema,
  createTenantSchema,
  createUnitSchema,
  importChequeRowSchema,
  importContractRowSchema,
  importShareRowSchema,
  sharePctToBp,
  TOTAL_SHARE_BP,
  UNIT_TYPES,
  unitKey,
  validateChequeGrid,
  type ImportChequeRow,
  type ImportContractRow,
  type ImportShareRow,
  type PlainDate,
} from '@vamar/shared';
import type { Dbx, Tx } from '../db.js';
import { ApiError } from '../errors.js';
import { log } from '../util/log.js';
import { audit, type AuditActor } from './audit.js';
import { activateContract, createContract } from './contracts.js';
import { setUnitOwners } from './properties.js';

export const IMPORT_TARGETS = [
  'owners',
  'buildings',
  'units',
  'tenants',
  'shares',
  'contracts',
  'cheques',
] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

/** Units are matched to buildings by English or Arabic name (or id) so sheets need no uuids. */
const unitImportRow = createUnitSchema.omit({ buildingId: true }).extend({
  building: z.string().trim().min(1),
  type: z.enum(UNIT_TYPES).default('apartment'),
});

export const importCommitSchema = z.object({
  target: z.enum(IMPORT_TARGETS),
  fileName: z.string().trim().max(200),
  idempotencyKey: z.string().trim().min(8).max(100),
  rows: z
    .array(z.object({ row: z.number().int().positive(), data: z.record(z.string(), z.unknown()) }))
    .min(1)
    .max(2000),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;

export interface ImportRowResult {
  row: number;
  ok: boolean;
  id?: string;
  errors?: string[];
  /** Something the row caused besides its own record (a contract activated, left as draft). */
  note?: string;
}

export interface ImportResult {
  importId: string;
  rowsTotal: number;
  rowsOk: number;
  rowsFailed: number;
  results: ImportRowResult[];
  alreadyDone: boolean;
}

/** Per-row failure carrying the messages shown next to the row in the dashboard. */
class RowError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('; '));
  }
}

function issues(err: z.ZodError): RowError {
  return new RowError(err.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`));
}

type Prepared =
  | { target: 'owners'; data: z.infer<typeof createOwnerSchema> }
  | { target: 'buildings'; data: z.infer<typeof createBuildingSchema> }
  | { target: 'units'; data: z.infer<typeof unitImportRow> }
  | { target: 'tenants'; data: z.infer<typeof createTenantSchema> }
  | { target: 'contracts'; data: ImportContractRow }
  | { target: 'cheques'; data: ImportChequeRow };

function parse<T>(rowSchema: z.ZodType<T>, data: Record<string, unknown>): T {
  const p = rowSchema.safeParse(data);
  if (!p.success) throw issues(p.error);
  return p.data;
}

function prepare(target: Exclude<ImportTarget, 'shares'>, data: Record<string, unknown>): Prepared {
  switch (target) {
    case 'owners':
      return { target, data: parse(createOwnerSchema, data) };
    case 'buildings':
      return { target, data: parse(createBuildingSchema, data) };
    case 'units':
      return { target, data: parse(unitImportRow, data) };
    case 'tenants':
      return { target, data: parse(createTenantSchema, data) };
    case 'contracts':
      return { target, data: parse(importContractRowSchema, data) };
    case 'cheques':
      return { target, data: parse(importChequeRowSchema, data) };
  }
}

/** Contracts that still occupy their unit for overlap and duplicate checks. */
const LIVE_CONTRACT = ['draft', 'active', 'expired', 'renewed'] as const;

export async function commitImport(
  db: Tx,
  actor: AuditActor,
  input: ImportCommitInput,
  options: { today: PlainDate },
): Promise<ImportResult> {
  // Claim the idempotency key; a second commit of the same key (double click, retry after a lost
  // response) gets the stored report instead of a second insert.
  const [imp] = await db
    .insert(schema.imports)
    .values({
      fileName: input.fileName,
      rowsTotal: input.rows.length,
      status: 'committing',
      idempotencyKey: input.idempotencyKey,
      createdBy: actor.type === 'staff' ? actor.id : null,
    })
    .onConflictDoNothing({ target: schema.imports.idempotencyKey })
    .returning();
  if (!imp) {
    const existing = await db.query.imports.findFirst({
      where: eq(schema.imports.idempotencyKey, input.idempotencyKey),
    });
    if (!existing) throw new Error('import claim failed');
    return {
      importId: existing.id,
      rowsTotal: existing.rowsTotal,
      rowsOk: existing.rowsOk,
      rowsFailed: existing.rowsFailed,
      results: (existing.results as ImportRowResult[] | null) ?? [],
      alreadyDone: true,
    };
  }

  const ctx: RowContext = {
    db,
    actor,
    importId: imp.id,
    today: options.today,
    createdBy: actor.type === 'staff' ? actor.id : null,
    buildingsByName:
      input.target === 'owners' || input.target === 'tenants'
        ? new Map<string, string>()
        : await buildingLookup(db),
  };
  const results =
    input.target === 'shares' ? await importShares(ctx, input.rows) : await importRows(ctx, input);

  const rowsOk = results.filter((x) => x.ok).length;
  const rowsFailed = results.length - rowsOk;
  await db
    .update(schema.imports)
    .set({
      rowsOk,
      rowsFailed,
      results,
      status: rowsFailed === results.length ? 'failed' : 'done',
    })
    .where(eq(schema.imports.id, imp.id));
  await audit(db, actor, {
    action: 'import.commit',
    entityType: 'import',
    entityId: imp.id,
    after: {
      target: input.target,
      fileName: input.fileName,
      rowsTotal: results.length,
      rowsOk,
      rowsFailed,
    },
  });
  return {
    importId: imp.id,
    rowsTotal: results.length,
    rowsOk,
    rowsFailed,
    results,
    alreadyDone: false,
  };
}

interface RowContext {
  db: Tx;
  actor: AuditActor;
  importId: string;
  today: PlainDate;
  createdBy: string | null;
  buildingsByName: Map<string, string>;
}

/** A savepoint around one unit of work; a refusal becomes the row's messages. */
async function inSavepoint<T>(
  ctx: RowContext,
  rows: number[],
  work: (sp: Tx) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; errors: string[] }> {
  try {
    return { ok: true, value: await ctx.db.transaction(work) };
  } catch (e) {
    if (e instanceof RowError) return { ok: false, errors: e.issues };
    // A business rule of a reused service (for example activation) speaks for itself.
    if (e instanceof ApiError) return { ok: false, errors: [`row: ${e.message}`] };
    // The database refused the row. The detail goes to the log; the sheet gets a message it can act
    // on without exposing SQL.
    log('warn', 'import.row_rejected', {
      importId: ctx.importId,
      rows,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, errors: ['row: rejected by the database'] };
  }
}

async function importRows(ctx: RowContext, input: ImportCommitInput): Promise<ImportRowResult[]> {
  const target = input.target as Exclude<ImportTarget, 'shares'>;
  const results: ImportRowResult[] = [];
  for (const r of input.rows) {
    let prepared: Prepared;
    try {
      prepared = prepare(target, r.data);
    } catch (e) {
      results.push({
        row: r.row,
        ok: false,
        errors: e instanceof RowError ? e.issues : [String(e)],
      });
      continue;
    }
    // Savepoint per row: a database rejection rolls back this row only.
    const out = await inSavepoint(ctx, [r.row], (sp) => saveRow(ctx, sp, prepared));
    results.push(
      out.ok
        ? {
            row: r.row,
            ok: true,
            id: out.value.id,
            ...(out.value.note ? { note: out.value.note } : {}),
          }
        : { row: r.row, ok: false, errors: out.errors },
    );
  }
  return results;
}

async function saveRow(
  ctx: RowContext,
  sp: Tx,
  prepared: Prepared,
): Promise<{ id: string; note?: string }> {
  switch (prepared.target) {
    case 'owners': {
      const clash = await sp.query.owners.findFirst({
        where: eq(schema.owners.phoneE164, prepared.data.phoneE164),
        columns: { id: true },
      });
      if (clash) throw new RowError(['phoneE164: already exists']);
      const [row] = await sp
        .insert(schema.owners)
        .values({ ...prepared.data, status: 'invited', createdBy: ctx.createdBy })
        .returning({ id: schema.owners.id });
      return { id: row?.id ?? '' };
    }
    case 'buildings': {
      const nameEn = prepared.data.nameEn.toLowerCase();
      if (ctx.buildingsByName.has(nameEn) || ctx.buildingsByName.has(prepared.data.nameAr)) {
        throw new RowError(['nameEn: a building with this name already exists']);
      }
      const [row] = await sp
        .insert(schema.buildings)
        .values(prepared.data)
        .returning({ id: schema.buildings.id });
      const id = row?.id ?? '';
      ctx.buildingsByName.set(nameEn, id);
      ctx.buildingsByName.set(prepared.data.nameAr, id);
      return { id };
    }
    case 'units': {
      const buildingId = findBuilding(ctx, prepared.data.building);
      const clash = await sp.query.units.findFirst({
        where: and(
          eq(schema.units.buildingId, buildingId),
          eq(schema.units.unitNo, prepared.data.unitNo),
        ),
        columns: { id: true },
      });
      if (clash) throw new RowError(['unitNo: already exists in this building']);
      const { building: _b, ...unit } = prepared.data;
      const [row] = await sp
        .insert(schema.units)
        .values({ ...unit, buildingId })
        .returning({ id: schema.units.id });
      return { id: row?.id ?? '' };
    }
    case 'tenants': {
      const clash = await sp.query.tenants.findFirst({
        where: and(
          sql`lower(${schema.tenants.name}) = lower(${prepared.data.name})`,
          prepared.data.phone
            ? eq(schema.tenants.phone, prepared.data.phone)
            : sql`${schema.tenants.phone} is null`,
        ),
        columns: { id: true },
      });
      if (clash) throw new RowError(['name: a tenant with this name and phone already exists']);
      const [row] = await sp
        .insert(schema.tenants)
        .values(prepared.data)
        .returning({ id: schema.tenants.id });
      return { id: row?.id ?? '' };
    }
    case 'contracts':
      return saveContract(ctx, sp, prepared.data);
    case 'cheques':
      return saveCheque(ctx, sp, prepared.data);
  }
}

function findBuilding(ctx: RowContext, key: string): string {
  const id =
    ctx.buildingsByName.get(key.toLowerCase()) ??
    ctx.buildingsByName.get(key) ??
    (isUuid(key) ? key : undefined);
  if (!id) throw new RowError([`building: no building named "${key}"`]);
  return id;
}

async function findUnit(ctx: RowContext, sp: Tx, building: string, unitNo: string) {
  const buildingId = findBuilding(ctx, building);
  const unit = await sp.query.units.findFirst({
    where: and(eq(schema.units.buildingId, buildingId), eq(schema.units.unitNo, unitNo)),
    columns: { id: true },
  });
  if (!unit)
    throw new RowError([`unitNo: no unit "${unitNo}" in "${building}" (import Units first)`]);
  return unit.id;
}

async function saveContract(
  ctx: RowContext,
  sp: Tx,
  row: ImportContractRow,
): Promise<{ id: string }> {
  const unitId = await findUnit(ctx, sp, row.building, row.unitNo);
  const tenants = await sp
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(
      and(
        sql`lower(${schema.tenants.name}) = lower(${row.tenantName})`,
        row.tenantPhone ? eq(schema.tenants.phone, row.tenantPhone) : undefined,
      ),
    )
    .limit(2);
  const tenant = tenants[0];
  if (!tenant)
    throw new RowError([`tenantName: no tenant named "${row.tenantName}" (import Tenants first)`]);
  if (tenants.length > 1)
    throw new RowError(['tenantName: more than one tenant has this name; add tenantPhone']);

  const [other] = await sp
    .select({ startDate: schema.contracts.startDate, endDate: schema.contracts.endDate })
    .from(schema.contracts)
    .where(
      and(
        eq(schema.contracts.unitId, unitId),
        inArray(schema.contracts.status, [...LIVE_CONTRACT]),
        sql`${schema.contracts.startDate} <= ${row.endDate} and ${schema.contracts.endDate} >= ${row.startDate}`,
      ),
    )
    .limit(1);
  if (other) {
    throw new RowError([
      other.startDate === row.startDate
        ? 'startDate: this unit already has a contract starting on this date'
        : `startDate: overlaps the contract ${other.startDate} to ${other.endDate} on this unit`,
    ]);
  }
  // A draft with the generated schedule; the Cheques sheet fills it and activates it.
  const contract = await createContract(sp, ctx.actor, {
    unitId,
    tenantId: tenant.id,
    startDate: row.startDate,
    endDate: row.endDate,
    annualRentFils: aedAmountToFils(row.annualRentAed),
    chequeCount: row.chequeCount,
    ejariNo: row.ejariNo ?? null,
    notes: '',
  });
  return { id: contract.id };
}

async function saveCheque(
  ctx: RowContext,
  sp: Tx,
  row: ImportChequeRow,
): Promise<{ id: string; note?: string }> {
  const unitId = await findUnit(ctx, sp, row.building, row.unitNo);
  const contract = await sp.query.contracts.findFirst({
    where: and(
      eq(schema.contracts.unitId, unitId),
      eq(schema.contracts.startDate, row.contractStart),
      ne(schema.contracts.status, 'terminated'),
    ),
  });
  if (!contract)
    throw new RowError([
      'contractStart: no contract on this unit starts on this date (import Contracts first)',
    ]);
  if (row.seq > contract.chequeCount)
    throw new RowError([`seq: this contract has ${String(contract.chequeCount)} cheques`]);
  if (contract.status !== 'draft')
    throw new RowError([
      'seq: the contract is already active; change its cheques in the dashboard',
    ]);
  if (row.dueDate < contract.startDate || row.dueDate > contract.endDate)
    throw new RowError([
      `dueDate: outside the contract (${contract.startDate} to ${contract.endDate})`,
    ]);
  const [cheque] = await sp
    .update(schema.cheques)
    .set({
      dueDate: row.dueDate,
      amountFils: aedAmountToFils(row.amountAed),
      chequeNo: row.chequeNo,
      bankName: row.bankName,
    })
    .where(and(eq(schema.cheques.contractId, contract.id), eq(schema.cheques.seq, row.seq)))
    .returning({ id: schema.cheques.id });
  if (!cheque) throw new RowError([`seq: cheque ${String(row.seq)} not found on the contract`]);

  // The last cheque of a contract completes its grid: activate it when the total is the rent.
  const grid = await sp
    .select()
    .from(schema.cheques)
    .where(eq(schema.cheques.contractId, contract.id))
    .orderBy(asc(schema.cheques.seq));
  const v = validateChequeGrid(
    grid.map((c) => ({
      seq: c.seq,
      dueDate: c.dueDate as PlainDate,
      amountFils: c.amountFils,
      chequeNo: c.chequeNo,
      bankName: c.bankName,
    })),
    contract.annualRentFils,
  );
  if (!v.complete) return { id: cheque.id };
  if (!v.matchesRent)
    return {
      id: cheque.id,
      note: 'cheques complete, but their total differs from the annual rent: the contract stays a draft; activate it in the dashboard with a reason',
    };
  await activateContract(sp, ctx.actor, contract.id);
  return { id: cheque.id, note: 'contract activated' };
}

/**
 * Shares: the rows of one unit are one unit of work. They must name existing owners, each once,
 * and add up to exactly 100 %. A unit that already has these owners and shares is left as it is
 * (re-import); a unit with different current owners is refused, so an import never silently
 * replaces ownership (that is the unit page's job).
 */
async function importShares(
  ctx: RowContext,
  rows: ImportCommitInput['rows'],
): Promise<ImportRowResult[]> {
  const results = new Map<number, ImportRowResult>();
  const groups = new Map<string, { row: number; data: ImportShareRow }[]>();
  const invalidUnits = new Set<string>();
  for (const r of rows) {
    const p = importShareRowSchema.safeParse(r.data);
    if (!p.success) {
      results.set(r.row, { row: r.row, ok: false, errors: issues(p.error).issues });
      const building = r.data['building'];
      const unit = r.data['unitNo'];
      if (typeof building === 'string' && (typeof unit === 'string' || typeof unit === 'number'))
        invalidUnits.add(unitKey(building, unit));
      continue;
    }
    const key = unitKey(p.data.building, p.data.unitNo);
    groups.set(key, [...(groups.get(key) ?? []), { row: r.row, data: p.data }]);
  }

  for (const [key, group] of groups) {
    const rowNos = group.map((g) => g.row);
    const first = group[0]?.data;
    if (!first) continue;
    const out = await inSavepoint(ctx, rowNos, async (sp) => {
      if (invalidUnits.has(key))
        throw new RowError(['row: another row of this unit is invalid; fix it and import again']);
      const unitId = await findUnit(ctx, sp, first.building, first.unitNo);
      const phones = group.map((g) => g.data.ownerPhone);
      if (new Set(phones).size !== phones.length)
        throw new RowError(['ownerPhone: the same owner appears twice for this unit']);
      const found = await sp
        .select({ id: schema.owners.id, phoneE164: schema.owners.phoneE164 })
        .from(schema.owners)
        .where(inArray(schema.owners.phoneE164, phones));
      const byPhone = new Map(found.map((o) => [o.phoneE164, o.id]));
      const missing = phones.filter((p) => !byPhone.has(p));
      if (missing.length)
        throw new RowError([
          `ownerPhone: no owner with ${missing.join(', ')} (import Owners first)`,
        ]);
      const shares = group.map((g) => ({
        ownerId: byPhone.get(g.data.ownerPhone) ?? '',
        shareBp: sharePctToBp(g.data.sharePct),
      }));
      const total = shares.reduce((s, x) => s + x.shareBp, 0);
      if (total !== TOTAL_SHARE_BP)
        throw new RowError([
          `sharePct: the shares of this unit add up to ${String(total / 100)} %, not 100 %`,
        ]);

      const current = await sp
        .select({ ownerId: schema.unitOwnerships.ownerId, shareBp: schema.unitOwnerships.shareBp })
        .from(schema.unitOwnerships)
        .where(and(eq(schema.unitOwnerships.unitId, unitId), isNull(schema.unitOwnerships.toDate)));
      if (current.length) {
        const same =
          current.length === shares.length &&
          shares.every((s) =>
            current.some((c) => c.ownerId === s.ownerId && c.shareBp === s.shareBp),
          );
        if (same) return { unitId, note: 'already set; unchanged' };
        throw new RowError([
          'unitNo: this unit already has other owners; change them on the unit page',
        ]);
      }
      const fromDate = group.find((g) => g.data.fromDate)?.data.fromDate ?? ctx.today;
      await setUnitOwners(sp, ctx.actor, unitId, { fromDate, owners: shares });
      return { unitId, note: '' };
    });
    for (const n of rowNos) {
      results.set(
        n,
        out.ok
          ? {
              row: n,
              ok: true,
              id: out.value.unitId,
              ...(out.value.note ? { note: out.value.note } : {}),
            }
          : { row: n, ok: false, errors: out.errors },
      );
    }
  }
  return rows.map(
    (r) => results.get(r.row) ?? { row: r.row, ok: false, errors: ['row: not processed'] },
  );
}

async function buildingLookup(db: Dbx): Promise<Map<string, string>> {
  const rows = await db
    .select({
      id: schema.buildings.id,
      nameAr: schema.buildings.nameAr,
      nameEn: schema.buildings.nameEn,
    })
    .from(schema.buildings);
  const m = new Map<string, string>();
  for (const b of rows) {
    m.set(b.nameEn.toLowerCase(), b.id);
    m.set(b.nameAr, b.id);
  }
  return m;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
