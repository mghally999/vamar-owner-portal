/**
 * Runs the real SQL migrations and the seed against an in-process Postgres (PGlite), then
 * checks the invariants the seed promises. No Docker needed, so this also runs in CI quickly.
 */
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../schema/index.js';
import { seed, type SeedSummary } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const TODAY = '2026-10-07' as const;

const client = new PGlite();
const db = drizzle({ client, schema, casing: 'snake_case' });
let summary: SeedSummary;

beforeAll(async () => {
  // The grants migration references the vamar_app role; create it as Docker/Neon setup does.
  await client.exec(`CREATE ROLE vamar_app LOGIN PASSWORD 'vamar_app'`);
  await migrate(db, { migrationsFolder: join(here, '..', '..', 'migrations') });
  summary = await seed(db, TODAY);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('migrations', () => {
  it('create the partial indexes and append-only grants', async () => {
    const idx = await db.execute<{ indexname: string; indexdef: string }>(
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('cheques','contracts') ORDER BY indexname`,
    );
    const defs = Object.fromEntries(idx.rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs['cheques_pending_due_date_idx']).toMatch(/WHERE/i);
    expect(defs['contracts_active_end_date_idx']).toMatch(/WHERE/i);

    const grants = await db.execute<{ privilege_type: string }>(
      sql`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'vamar_app' AND table_name = 'audit_log' ORDER BY 1`,
    );
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });
});

describe('seed data', () => {
  it('creates the expected volumes', () => {
    expect(summary.staff).toBe(2);
    expect(summary.owners).toBe(5);
    expect(summary.buildings).toBe(5);
    expect(summary.units).toBe(32);
    expect(summary.contracts).toBeGreaterThan(25);
    expect(summary.cheques).toBeGreaterThan(100);
    expect(summary.disputes).toBe(2);
  });

  it('current shares of every unit sum to exactly 10000 bp', async () => {
    const rows = await db.execute<{ unit_id: string; total: number }>(
      sql`SELECT unit_id, SUM(share_bp)::int AS total FROM unit_ownerships WHERE to_date IS NULL GROUP BY unit_id`,
    );
    expect(rows.rows.length).toBe(32);
    for (const r of rows.rows) expect(r.total).toBe(10_000);
  });

  it('every unit has at most one active contract', async () => {
    const rows = await db.execute<{ unit_id: string; n: number }>(
      sql`SELECT unit_id, COUNT(*)::int AS n FROM contracts WHERE status = 'active' GROUP BY unit_id HAVING COUNT(*) > 1`,
    );
    expect(rows.rows).toEqual([]);
  });

  it('has vacant units of both kinds and occupied units', async () => {
    const occupied = await db.execute<{ n: number }>(
      sql`SELECT COUNT(DISTINCT unit_id)::int AS n FROM contracts WHERE status = 'active' AND start_date <= ${TODAY} AND end_date >= ${TODAY}`,
    );
    const total = 32;
    const occ = occupied.rows[0]?.n ?? 0;
    expect(occ).toBeGreaterThan(20);
    expect(occ).toBeLessThan(total);
    const never = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM units u WHERE NOT EXISTS (SELECT 1 FROM contracts c WHERE c.unit_id = u.id)`,
    );
    expect(never.rows[0]?.n).toBe(2);
  });

  it('cheques cover past, current and future months with mixed statuses', async () => {
    const byStatus = await db.execute<{ status: string; n: number }>(
      sql`SELECT status, COUNT(*)::int AS n FROM cheques GROUP BY status`,
    );
    const m = Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n]));
    expect(m['upcoming']).toBeGreaterThan(0);
    expect(m['cleared']).toBeGreaterThan(0);
    expect(m['bounced']).toBeGreaterThanOrEqual(1);
    const thisMonth = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM cheques WHERE date_trunc('month', due_date) = date_trunc('month', ${TODAY}::date)`,
    );
    expect(thisMonth.rows[0]?.n).toBeGreaterThan(0);
  });

  it('active and expired contracts have complete cheque grids that sum to the annual rent', async () => {
    const rows = await db.execute<{ id: string; annual: string; total: string; missing: number }>(
      sql`SELECT c.id, c.annual_rent_fils::bigint::text::numeric AS annual,
                 COALESCE(SUM(q.amount_fils), 0)::text::numeric AS total,
                 COUNT(*) FILTER (WHERE q.amount_fils IS NULL)::int AS missing
          FROM contracts c JOIN cheques q ON q.contract_id = c.id
          WHERE c.status IN ('active', 'expired') GROUP BY c.id`,
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const r of rows.rows) {
      expect(r.missing).toBe(0);
      expect(Number(r.total)).toBe(Number(r.annual));
    }
  });

  it('draft renewal exists and links to its previous contract', async () => {
    const rows = await db.execute<{ status: string; previous_status: string; gap: number }>(
      sql`SELECT c.status, p.status AS previous_status, (c.start_date - p.end_date)::int AS gap
          FROM contracts c JOIN contracts p ON p.id = c.previous_contract_id`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.status).toBe('draft');
    expect(rows.rows[0]?.previous_status).toBe('active');
    expect(rows.rows[0]?.gap).toBe(1);
  });

  it('bounced cheques have a bounce event and a dispute', async () => {
    const events = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM cheque_events e JOIN cheques q ON q.id = e.cheque_id WHERE q.status = 'bounced' AND e.to_status = 'bounced'`,
    );
    expect(events.rows[0]?.n).toBeGreaterThanOrEqual(1);
    const disputes = await db.execute<{ type: string; visible: number }>(
      sql`SELECT d.type, COUNT(u.id) FILTER (WHERE u.visible_to_owner)::int AS visible FROM disputes d LEFT JOIN dispute_updates u ON u.dispute_id = d.id GROUP BY d.id, d.type ORDER BY d.case_no`,
    );
    expect(disputes.rows.map((r) => r.type)).toEqual(['bounced_cheque', 'rent_arrears']);
    for (const r of disputes.rows) expect(r.visible).toBeGreaterThan(0);
  });

  it('database rejects invalid money and shares', async () => {
    await expect(
      db.execute(
        sql`UPDATE cheques SET amount_fils = 0 WHERE id = (SELECT id FROM cheques LIMIT 1)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`UPDATE unit_ownerships SET share_bp = 10001 WHERE id = (SELECT id FROM unit_ownerships LIMIT 1)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`UPDATE contracts SET cheque_count = 13 WHERE id = (SELECT id FROM contracts LIMIT 1)`,
      ),
    ).rejects.toThrow();
  });
});
