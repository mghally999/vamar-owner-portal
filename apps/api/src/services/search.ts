/**
 * Global dashboard search (Ctrl+K): owners by name or phone, units by number, deed, Makani or
 * DEWA number, buildings by name, plot or Makani, cheques by number, disputes by case or cheque
 * number, expenses by invoice number, tenants by name or phone. Seven small queries in parallel.
 */
import { eq, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { schema } from '@vamar/db';
import type { Dbx } from '../db.js';

const {
  owners,
  units,
  buildings,
  cheques,
  contracts,
  disputes,
  disputeCheques,
  expenses,
  tenants,
} = schema;

export type SearchHitType =
  'owner' | 'unit' | 'building' | 'cheque' | 'dispute' | 'expense' | 'tenant';

export interface SearchHit {
  type: SearchHitType;
  id: string;
  titleAr: string;
  titleEn: string;
  /** What matched, for the result line. */
  detail: string;
  /** Parent ids for links (a unit's building, a cheque's contract). */
  parentId: string | null;
}

export async function globalSearch(db: Dbx, q: string, limit: number): Promise<SearchHit[]> {
  const term = q.trim();
  const like = `%${term}%`;
  // A UAE number typed the local way (050...) is stored as +97150...: drop the leading zero.
  const digits = term.replace(/\D/g, '').replace(/^0+/, '');
  const phoneLike = digits.length >= 4 ? `%${digits}%` : null;
  const per = Math.max(3, Math.ceil(limit / 4));
  const ilike = (col: AnyPgColumn) => sql`${col} ilike ${like}`;

  const [ownerRows, unitRows, buildingRows, chequeRows, disputeRows, expenseRows, tenantRows] =
    await Promise.all([
      db
        .select({
          id: owners.id,
          nameAr: owners.nameAr,
          nameEn: owners.nameEn,
          phone: owners.phoneE164,
        })
        .from(owners)
        .where(
          or(
            ilike(owners.nameAr),
            ilike(owners.nameEn),
            phoneLike ? sql`${owners.phoneE164} like ${phoneLike}` : sql`false`,
          ),
        )
        .limit(per),
      db
        .select({
          id: units.id,
          buildingId: units.buildingId,
          unitNo: units.unitNo,
          bAr: buildings.nameAr,
          bEn: buildings.nameEn,
          titleDeedNo: units.titleDeedNo,
          makaniNo: units.makaniNo,
          dewaPremiseNo: units.dewaPremiseNo,
          municipalityNo: units.municipalityNo,
          plotNo: units.plotNo,
        })
        .from(units)
        .innerJoin(buildings, eq(buildings.id, units.buildingId))
        .where(
          or(
            sql`${units.unitNo} ilike ${like}`,
            sql`${units.titleDeedNo} ilike ${like}`,
            sql`${units.makaniNo} ilike ${like}`,
            sql`${units.dewaPremiseNo} ilike ${like}`,
            sql`${units.municipalityNo} ilike ${like}`,
            sql`${units.plotNo} ilike ${like}`,
          ),
        )
        .limit(per),
      db
        .select({
          id: buildings.id,
          nameAr: buildings.nameAr,
          nameEn: buildings.nameEn,
          plotNo: buildings.plotNo,
          makaniNo: buildings.makaniNo,
          titleDeedNo: buildings.titleDeedNo,
        })
        .from(buildings)
        .where(
          or(
            ilike(buildings.nameAr),
            ilike(buildings.nameEn),
            sql`${buildings.plotNo} ilike ${like}`,
            sql`${buildings.makaniNo} ilike ${like}`,
            sql`${buildings.titleDeedNo} ilike ${like}`,
          ),
        )
        .limit(per),
      db
        .select({
          id: cheques.id,
          contractId: cheques.contractId,
          chequeNo: cheques.chequeNo,
          status: cheques.status,
          dueDate: cheques.dueDate,
          unitNo: units.unitNo,
          bAr: buildings.nameAr,
          bEn: buildings.nameEn,
        })
        .from(cheques)
        .innerJoin(contracts, eq(contracts.id, cheques.contractId))
        .innerJoin(units, eq(units.id, contracts.unitId))
        .innerJoin(buildings, eq(buildings.id, units.buildingId))
        .where(sql`${cheques.chequeNo} ilike ${like}`)
        .limit(per),
      db
        .select({
          id: disputes.id,
          caseNo: disputes.caseNo,
          status: disputes.status,
          unitNo: units.unitNo,
          bAr: buildings.nameAr,
          bEn: buildings.nameEn,
        })
        .from(disputes)
        .innerJoin(units, eq(units.id, disputes.unitId))
        .innerJoin(buildings, eq(buildings.id, units.buildingId))
        .where(
          or(
            sql`${disputes.caseNo} ilike ${like}`,
            sql`exists (select 1 from ${disputeCheques} dc join ${cheques} q on q.id = dc.cheque_id where dc.dispute_id = ${disputes.id} and q.cheque_no ilike ${like})`,
          ),
        )
        .limit(per),
      db
        .select({
          id: expenses.id,
          invoiceNo: expenses.invoiceNo,
          reasonAr: expenses.reasonAr,
          reasonEn: expenses.reasonEn,
          status: expenses.status,
          bAr: buildings.nameAr,
          bEn: buildings.nameEn,
        })
        .from(expenses)
        .innerJoin(buildings, eq(buildings.id, expenses.buildingId))
        .where(sql`${expenses.invoiceNo} ilike ${like}`)
        .limit(per),
      db
        .select({ id: tenants.id, name: tenants.name, phone: tenants.phone })
        .from(tenants)
        .where(
          or(
            sql`${tenants.name} ilike ${like}`,
            phoneLike ? sql`${tenants.phone} like ${phoneLike}` : sql`false`,
          ),
        )
        .limit(per),
    ]);

  const hits: SearchHit[] = [];
  for (const o of ownerRows)
    hits.push({
      type: 'owner',
      id: o.id,
      titleAr: o.nameAr,
      titleEn: o.nameEn,
      detail: o.phone,
      parentId: null,
    });
  for (const u of unitRows) {
    const matched = [u.titleDeedNo, u.makaniNo, u.dewaPremiseNo, u.municipalityNo, u.plotNo].find(
      (v) => v?.toLowerCase().includes(term.toLowerCase()),
    );
    hits.push({
      type: 'unit',
      id: u.id,
      titleAr: `${u.bAr} ${u.unitNo}`,
      titleEn: `${u.bEn} ${u.unitNo}`,
      detail: matched ?? u.unitNo,
      parentId: u.buildingId,
    });
  }
  for (const b of buildingRows)
    hits.push({
      type: 'building',
      id: b.id,
      titleAr: b.nameAr,
      titleEn: b.nameEn,
      detail: b.plotNo ?? b.makaniNo ?? b.titleDeedNo ?? '',
      parentId: null,
    });
  for (const c of chequeRows)
    hits.push({
      type: 'cheque',
      id: c.id,
      titleAr: `شيك ${c.chequeNo ?? ''} · ${c.bAr} ${c.unitNo}`,
      titleEn: `Cheque ${c.chequeNo ?? ''} · ${c.bEn} ${c.unitNo}`,
      detail: `${c.dueDate} · ${c.status}`,
      parentId: c.contractId,
    });
  for (const d of disputeRows)
    hits.push({
      type: 'dispute',
      id: d.id,
      titleAr: `${d.caseNo} · ${d.bAr} ${d.unitNo}`,
      titleEn: `${d.caseNo} · ${d.bEn} ${d.unitNo}`,
      detail: d.status,
      parentId: null,
    });
  for (const x of expenseRows)
    hits.push({
      type: 'expense',
      id: x.id,
      titleAr: x.reasonAr,
      titleEn: x.reasonEn,
      detail: `${x.invoiceNo ?? ''} · ${x.status}`,
      parentId: null,
    });
  for (const t of tenantRows)
    hits.push({
      type: 'tenant',
      id: t.id,
      titleAr: t.name,
      titleEn: t.name,
      detail: t.phone ?? '',
      parentId: null,
    });
  return hits.slice(0, limit);
}
