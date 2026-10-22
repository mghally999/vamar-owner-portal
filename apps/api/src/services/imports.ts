/**
 * Excel import, server side. The browser parses the sheet (SheetJS) and maps columns; the API
 * receives already-shaped rows. Every row is validated with the shared zod schemas first, then
 * the valid ones are inserted one by one inside a savepoint each, so a row the database rejects
 * fails alone and the rest of the batch still lands. The per-row report is stored on the import
 * row and returned again when the same idempotency key is committed twice.
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@vamar/db';
import {
  createBuildingSchema,
  createOwnerSchema,
  createTenantSchema,
  createUnitSchema,
  UNIT_TYPES,
} from '@vamar/shared';
import type { Dbx, Tx } from '../db.js';
import { log } from '../util/log.js';
import { audit, type AuditActor } from './audit.js';

export const IMPORT_TARGETS = ['owners', 'buildings', 'units', 'tenants'] as const;
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
  | { target: 'tenants'; data: z.infer<typeof createTenantSchema> };

function prepare(target: ImportTarget, data: Record<string, unknown>): Prepared {
  switch (target) {
    case 'owners': {
      const p = createOwnerSchema.safeParse(data);
      if (!p.success) throw issues(p.error);
      return { target, data: p.data };
    }
    case 'buildings': {
      const p = createBuildingSchema.safeParse(data);
      if (!p.success) throw issues(p.error);
      return { target, data: p.data };
    }
    case 'units': {
      const p = unitImportRow.safeParse(data);
      if (!p.success) throw issues(p.error);
      return { target, data: p.data };
    }
    case 'tenants': {
      const p = createTenantSchema.safeParse(data);
      if (!p.success) throw issues(p.error);
      return { target, data: p.data };
    }
  }
}

export async function commitImport(
  db: Tx,
  actor: AuditActor,
  input: ImportCommitInput,
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

  const results: ImportRowResult[] = [];
  const buildingsByName =
    input.target === 'units' || input.target === 'buildings'
      ? await buildingLookup(db)
      : new Map<string, string>();
  const createdBy = actor.type === 'staff' ? actor.id : null;

  for (const r of input.rows) {
    let prepared: Prepared;
    try {
      prepared = prepare(input.target, r.data);
    } catch (e) {
      results.push({
        row: r.row,
        ok: false,
        errors: e instanceof RowError ? e.issues : [String(e)],
      });
      continue;
    }
    try {
      // Savepoint per row: a database rejection rolls back this row only.
      const id = await db.transaction(async (sp) => {
        switch (prepared.target) {
          case 'owners': {
            const clash = await sp.query.owners.findFirst({
              where: eq(schema.owners.phoneE164, prepared.data.phoneE164),
              columns: { id: true },
            });
            if (clash) throw new RowError(['phoneE164: already exists']);
            const [row] = await sp
              .insert(schema.owners)
              .values({ ...prepared.data, status: 'invited', createdBy })
              .returning({ id: schema.owners.id });
            return row?.id ?? '';
          }
          case 'buildings': {
            const nameEn = prepared.data.nameEn.toLowerCase();
            if (buildingsByName.has(nameEn) || buildingsByName.has(prepared.data.nameAr)) {
              throw new RowError(['nameEn: a building with this name already exists']);
            }
            const [row] = await sp
              .insert(schema.buildings)
              .values(prepared.data)
              .returning({ id: schema.buildings.id });
            const id = row?.id ?? '';
            buildingsByName.set(nameEn, id);
            buildingsByName.set(prepared.data.nameAr, id);
            return id;
          }
          case 'units': {
            const key = prepared.data.building;
            const buildingId =
              buildingsByName.get(key.toLowerCase()) ??
              buildingsByName.get(key) ??
              (isUuid(key) ? key : undefined);
            if (!buildingId) throw new RowError([`building: no building named "${key}"`]);
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
            return row?.id ?? '';
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
            if (clash)
              throw new RowError(['name: a tenant with this name and phone already exists']);
            const [row] = await sp
              .insert(schema.tenants)
              .values(prepared.data)
              .returning({ id: schema.tenants.id });
            return row?.id ?? '';
          }
        }
      });
      results.push({ row: r.row, ok: true, id });
    } catch (e) {
      if (e instanceof RowError) {
        results.push({ row: r.row, ok: false, errors: e.issues });
      } else {
        // The database refused the row (constraint, bad enum, ...). The detail goes to the log; the
        // sheet gets a message it can act on without exposing SQL.
        log('warn', 'import.row_rejected', {
          importId: imp.id,
          row: r.row,
          error: e instanceof Error ? e.message : String(e),
        });
        results.push({ row: r.row, ok: false, errors: ['row: rejected by the database'] });
      }
    }
  }

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
