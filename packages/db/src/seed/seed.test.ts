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
import { formatDate, type PlainDate } from '@vamar/shared';
import { REFERENCE_TABLES, referenceInserts, restoreReferenceData } from '../reference-data.js';
import { firstWorkingDay, seed, type SeedSummary } from './index.js';

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

describe('reference data', () => {
  it('takes the settings of 0007 and the approval settings of 0010', () => {
    // 0007: one INSERT per reference table; 0010: the two approval settings.
    expect(referenceInserts()).toHaveLength(REFERENCE_TABLES.length + 1);
    const settings = referenceInserts().filter((s) => s.startsWith('INSERT INTO "app_settings"'));
    expect(settings).toHaveLength(2);
    expect(settings[1]).toContain("('repair_approval_threshold_fils', '500000'::jsonb)");
    expect(settings[1]).toContain("('repair_approval_silence_days', '3'::jsonb)");
  });

  it('comes back from the migration after every table is emptied, as the reset scripts do', async () => {
    const keys = await db.execute<{ key: string }>(sql`select key from app_settings order by key`);
    expect(keys.rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(['repair_approval_silence_days', 'repair_approval_threshold_fils']),
    );
    const count = async (t: string) =>
      (await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${t}"`))).rows[0]
        ?.n;
    const before = await Promise.all(REFERENCE_TABLES.map(count));
    expect(before.every((n) => (n ?? 0) > 0)).toBe(true);
    // A scratch copy of the three tables: emptying them here, restoring, then comparing counts.
    await db
      .transaction(async (tx) => {
        await tx.execute(
          sql.raw(`TRUNCATE ${REFERENCE_TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`),
        );
        await restoreReferenceData(tx);
        const after = await Promise.all(
          REFERENCE_TABLES.map(
            async (t) =>
              (await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${t}"`)))
                .rows[0]?.n,
          ),
        );
        expect(after).toEqual(before);
        // Running it twice changes nothing (the inserts skip existing rows).
        await restoreReferenceData(tx);
        tx.rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || !/rollback/i.test(e.message)) throw e;
      });
  });
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

  it('cheque timelines sit inside their own contract, deposits on the due date', async () => {
    const rows = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM cheque_events e
          JOIN cheques ch ON ch.id = e.cheque_id JOIN contracts k ON k.id = ch.contract_id
          WHERE e.at::date < k.start_date
             OR (e.to_status = 'deposited' AND e.at::date <> ch.due_date)
             OR e.at::date > ch.due_date + 30`,
    );
    expect(rows.rows[0]?.n).toBe(0);
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

  it('reads as Arabic data: bounce reasons, hearings on working days, dated hearing notes', async () => {
    const reasons = await db.execute<{ reason: string; note: string }>(
      sql`SELECT q.bounce_reason AS reason, e.note FROM cheques q JOIN cheque_events e ON e.cheque_id = q.id AND e.to_status = 'bounced' WHERE q.status = 'bounced'`,
    );
    expect(reasons.rows.length).toBeGreaterThan(0);
    for (const r of reasons.rows) {
      expect(r.reason).toMatch(/[؀-ۿ]/);
      expect(r.note).toBe(r.reason);
    }

    const hearings = await db.execute<{ d: string; note: string | null; holiday: boolean }>(
      sql`SELECT d.next_hearing_date::text AS d,
                 (SELECT u.note FROM dispute_updates u WHERE u.dispute_id = d.id AND u.note LIKE 'تم تحديد جلسة%') AS note,
                 EXISTS (SELECT 1 FROM holidays h WHERE h.date = d.next_hearing_date) AS holiday
          FROM disputes d WHERE d.next_hearing_date IS NOT NULL`,
    );
    expect(hearings.rows).toHaveLength(2);
    for (const h of hearings.rows) {
      const weekday = new Date(`${h.d}T00:00:00Z`).getUTCDay();
      expect([0, 6]).not.toContain(weekday);
      expect(h.holiday).toBe(false);
      // The note carries the same date, written in words, never an ISO date.
      expect(h.note).toContain(formatDate(h.d as PlainDate, 'ar'));
      expect(h.note).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it('first working day skips weekends and holidays', () => {
    const holidays = new Set(['2026-12-01', '2026-12-02', '2026-12-03']);
    // Saturday 28 Nov 2026 -> Monday 30 Nov; Tuesday 1 Dec (holiday) -> Friday 4 Dec.
    expect(firstWorkingDay('2026-11-28', holidays)).toBe('2026-11-30');
    expect(firstWorkingDay('2026-12-01', holidays)).toBe('2026-12-04');
    expect(firstWorkingDay('2026-10-07', holidays)).toBe('2026-10-07');
  });

  it('unit identifiers look real and are unique', async () => {
    const units = await db.execute<{
      unit_no: string;
      makani_no: string;
      dewa_premise_no: string;
      title_deed_no: string;
      municipality_no: string;
      b_makani: string;
      b_deed: string;
      plot_no: string;
      area: string;
    }>(
      sql`SELECT u.unit_no, u.makani_no, u.dewa_premise_no, u.title_deed_no, u.municipality_no,
                 b.makani_no AS b_makani, b.title_deed_no AS b_deed, b.plot_no, b.area
          FROM units u JOIN buildings b ON b.id = u.building_id`,
    );
    expect(units.rows).toHaveLength(32);
    const makani = new Set<string>();
    for (const u of units.rows) {
      expect(u.makani_no).toMatch(/^\d{10}$/);
      expect(u.makani_no.slice(0, 4)).toBe(u.b_makani.slice(0, 4));
      const sharjah = u.area.includes('Sharjah');
      expect(u.makani_no[0]).toBe(sharjah ? '7' : '2');
      expect(u.dewa_premise_no).toMatch(sharjah ? /^\d{10}$/ : /^\d{9}$/);
      expect(u.dewa_premise_no).not.toMatch(/0$/);
      const ref = u.unit_no.replace(/[^0-9A-Za-z]/g, '');
      expect(u.title_deed_no).toBe(`${u.b_deed}-${ref}`);
      expect(u.municipality_no).toBe(`${u.plot_no}-${ref}`);
      makani.add(u.makani_no);
    }
    expect(makani.size).toBe(32);
    expect(new Set(units.rows.map((u) => u.dewa_premise_no)).size).toBe(32);
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

  it('demo owner approvals: one job waiting for the owners, one already approved', async () => {
    const rows = await db.execute<{
      title: string;
      status: string;
      wo_status: string;
      estimate: string;
      amount: string;
      shares: string;
      owners: number;
    }>(sql`
      SELECT w.title_en AS title, a.status, w.status AS wo_status, w.estimate_fils AS estimate,
             max(a.amount_fils) AS amount, sum(a.share_fils) AS shares, count(*)::int AS owners
      FROM repair_approvals a JOIN work_orders w ON w.id = a.work_order_id
      GROUP BY w.title_en, a.status, w.status, w.estimate_fils ORDER BY w.title_en`);
    expect(rows.rows.map((r) => [r.title, r.status, r.wo_status])).toEqual([
      ['Annual fire system inspection', 'pending', 'scheduled'],
      ['Refurbishment before letting', 'approved', 'in_progress'],
    ]);
    for (const r of rows.rows) {
      // Every owner's part adds up to the estimate they were asked about, above AED 5,000.
      expect(Number(r.shares)).toBe(Number(r.estimate));
      expect(Number(r.amount)).toBe(Number(r.estimate));
      expect(Number(r.estimate)).toBeGreaterThanOrEqual(500_000);
    }
    expect(rows.rows[0]?.owners).toBeGreaterThanOrEqual(1);
    // The database refuses a row about both a job and an expense, or about neither.
    await expect(
      db.execute(
        sql`UPDATE repair_approvals SET work_order_id = NULL WHERE id = (SELECT id FROM repair_approvals LIMIT 1)`,
      ),
    ).rejects.toThrow();
  });

  it('demo budgets: one line past 80 %, the others under it, one total per building', async () => {
    expect(summary.budgets).toBe(5);
    const rows = await db.execute<{
      building: string;
      category: string | null;
      budget: string;
      spent: string;
    }>(sql`
      SELECT bl.name_en AS building, c.name_en AS category, b.amount_fils AS budget,
        (SELECT coalesce(sum(x.total_fils), 0) FROM expenses x
          WHERE x.building_id = b.building_id AND x.status = 'posted'
            AND (b.category_id IS NULL OR x.category_id = b.category_id)
            AND x.invoice_date BETWEEN '2026-01-01' AND '2026-12-31') AS spent
      FROM budgets b JOIN buildings bl ON bl.id = b.building_id
      LEFT JOIN expense_categories c ON c.id = b.category_id
      WHERE b.year = 2026 ORDER BY bl.name_en, c.name_en NULLS LAST`);
    const pct = rows.rows.map((r) => [
      r.building,
      r.category,
      Math.floor((Number(r.spent) * 100) / Number(r.budget)),
    ]);
    const near = pct.filter(([, , p]) => Number(p) >= 80);
    expect(near).toEqual([['Al Noor Tower', 'Lifts (repairs)', 86]]);
    expect(pct.filter(([, c]) => c === null).map(([b]) => b)).toEqual([
      'Al Khan Residence',
      'Al Noor Tower',
    ]);
    // A second total for the same building and year is refused (the partial unique index).
    await expect(
      db.execute(sql`INSERT INTO budgets (id, building_id, year, amount_fils)
        SELECT gen_random_uuid(), building_id, year, 100 FROM budgets
        WHERE category_id IS NULL LIMIT 1`),
    ).rejects.toThrow();
  });
});
