/**
 * Excel import, server side. The browser parses the sheet (SheetJS) and maps columns; the API
 * receives already-shaped rows, validates each one with the shared zod schemas, inserts the good
 * ones in batches and reports per-row failures. An idempotency key makes a retried commit a no-op.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@vamar/db';
import {
  createBuildingSchema,
  createOwnerSchema,
  createTenantSchema,
  createUnitSchema,
  UNIT_TYPES,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import { conflict } from '../errors.js';
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

export async function commitImport(
  db: Dbx,
  actor: AuditActor,
  input: ImportCommitInput,
): Promise<ImportResult> {
  const existing = await db.query.imports.findFirst({
    where: eq(schema.imports.idempotencyKey, input.idempotencyKey),
  });
  if (existing) {
    return {
      importId: existing.id,
      rowsTotal: existing.rowsTotal,
      rowsOk: existing.rowsOk,
      rowsFailed: existing.rowsFailed,
      results: [],
      alreadyDone: true,
    };
  }
  const [imp] = await db
    .insert(schema.imports)
    .values({
      fileName: input.fileName,
      rowsTotal: input.rows.length,
      status: 'committing',
      idempotencyKey: input.idempotencyKey,
      createdBy: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  if (!imp) throw new Error('import insert failed');

  const results: ImportRowResult[] = [];
  const buildingsByName =
    input.target === 'units' ? await buildingLookup(db) : new Map<string, string>();

  for (const r of input.rows) {
    try {
      let id: string;
      switch (input.target) {
        case 'owners': {
          const parsed = createOwnerSchema.safeParse(r.data);
          if (!parsed.success) throw issues(parsed.error);
          const clash = await db.query.owners.findFirst({
            where: eq(schema.owners.phoneE164, parsed.data.phoneE164),
            columns: { id: true },
          });
          if (clash) throw new RowError(['phoneE164: already exists']);
          const [row] = await db
            .insert(schema.owners)
            .values({
              ...parsed.data,
              status: 'invited',
              createdBy: actor.type === 'staff' ? actor.id : null,
            })
            .returning({ id: schema.owners.id });
          id = row?.id ?? '';
          break;
        }
        case 'buildings': {
          const parsed = createBuildingSchema.safeParse(r.data);
          if (!parsed.success) throw issues(parsed.error);
          const [row] = await db
            .insert(schema.buildings)
            .values(parsed.data)
            .returning({ id: schema.buildings.id });
          id = row?.id ?? '';
          buildingsByName.set(parsed.data.nameEn.toLowerCase(), id);
          buildingsByName.set(parsed.data.nameAr, id);
          break;
        }
        case 'units': {
          const parsed = unitImportRow.safeParse(r.data);
          if (!parsed.success) throw issues(parsed.error);
          const key = parsed.data.building;
          const buildingId =
            buildingsByName.get(key.toLowerCase()) ??
            buildingsByName.get(key) ??
            (isUuid(key) ? key : undefined);
          if (!buildingId) throw new RowError([`building: no building named "${key}"`]);
          const clash = await db.query.units.findFirst({
            where: and(
              eq(schema.units.buildingId, buildingId),
              eq(schema.units.unitNo, parsed.data.unitNo),
            ),
            columns: { id: true },
          });
          if (clash) throw new RowError(['unitNo: already exists in this building']);
          const { building: _b, ...unit } = parsed.data;
          const [row] = await db
            .insert(schema.units)
            .values({ ...unit, buildingId })
            .returning({ id: schema.units.id });
          id = row?.id ?? '';
          break;
        }
        case 'tenants': {
          const parsed = createTenantSchema.safeParse(r.data);
          if (!parsed.success) throw issues(parsed.error);
          const [row] = await db
            .insert(schema.tenants)
            .values(parsed.data)
            .returning({ id: schema.tenants.id });
          id = row?.id ?? '';
          break;
        }
      }
      results.push({ row: r.row, ok: true, id });
    } catch (e) {
      results.push({
        row: r.row,
        ok: false,
        errors: e instanceof RowError ? e.issues : [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  const rowsOk = results.filter((x) => x.ok).length;
  const rowsFailed = results.length - rowsOk;
  await db
    .update(schema.imports)
    .set({ rowsOk, rowsFailed, status: rowsFailed === results.length ? 'failed' : 'done' })
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

export function throwConflict(msg: string): never {
  throw conflict(msg);
}
