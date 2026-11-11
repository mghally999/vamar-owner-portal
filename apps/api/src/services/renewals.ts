/**
 * Renewal suggestion for one contract: the market reference from Vamar's recent contracts, the
 * Dubai rent cap and the rent the "Prepare renewal" form starts with. One statement reads the
 * contract and every possible comparable; the rules themselves live in @vamar/shared.
 */
import { sql } from 'drizzle-orm';
import {
  comparableWindowStart,
  emirateFromArea,
  isRenewalDue,
  marketReference,
  MIN_COMPARABLES,
  RENEWAL_WINDOW_DAYS,
  renewalCap,
  renewalDueInDays,
  suggestedRenewalRent,
  type ComparableCandidate,
  type Emirate,
  type MarketReference,
  type PlainDate,
  type RenewalCap,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { jsonColumn } from './owner-summary.js';

interface SubjectRow {
  contractId: string;
  status: string;
  startDate: PlainDate;
  endDate: PlainDate;
  /** bigint: a number or a string depending on the driver. */
  annualRentFils: number | string;
  unitId: string;
  unitNo: string;
  unitType: string;
  bedrooms: number | null;
  sizeSqft: number | null;
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  area: string;
  renewalId: string | null;
  renewalStatus: string | null;
}

export interface RenewalSuggestion {
  contractId: string;
  today: PlainDate;
  endDate: PlainDate;
  /** Days from today to the last day of the contract (0 on the last day). */
  dueInDays: number;
  /** Inside the RENEWAL_WINDOW_DAYS reminder window. */
  due: boolean;
  windowDays: number;
  currentRentFils: number;
  unit: {
    id: string;
    unitNo: string;
    type: string;
    bedrooms: number | null;
    sizeSqft: number | null;
  };
  building: { id: string; nameAr: string; nameEn: string; area: string };
  emirate: Emirate | null;
  /** Labelled "based on Vamar's recent contracts" wherever it is shown; never an official index. */
  market: MarketReference & { minComparables: number; startedAfter: PlainDate };
  cap: RenewalCap;
  suggestedRentFils: number;
  /** The renewal already drafted or activated for this contract, if any. */
  renewal: { id: string; status: string } | null;
}

export async function getRenewalSuggestion(
  db: Dbx,
  id: string,
  todayDate: PlainDate,
): Promise<RenewalSuggestion> {
  const startedAfter = comparableWindowStart(todayDate);
  // The comparables are narrowed here only by what is cheap to index on (type, bedrooms, start
  // date); the scope (building, area, emirate) is decided by the shared rule, which also
  // re-checks everything. One row per unit per year at most, so the list stays small.
  const result = await db.execute(sql`
    with s as (
      select c.id as "contractId", c.status, c.start_date as "startDate", c.end_date as "endDate",
        c.annual_rent_fils as "annualRentFils", u.id as "unitId", u.unit_no as "unitNo",
        u.type as "unitType", u.bedrooms, u.size_sqft as "sizeSqft", b.id as "buildingId",
        b.name_ar as "buildingNameAr", b.name_en as "buildingNameEn", b.area,
        r.id as "renewalId", r.status as "renewalStatus"
      from contracts c
      join units u on u.id = c.unit_id
      join buildings b on b.id = u.building_id
      left join lateral (
        select r.id, r.status from contracts r where r.previous_contract_id = c.id
        order by r.created_at desc limit 1
      ) r on true
      where c.id = ${id}
    )
    select json_build_object(
      'subject', (select row_to_json(s) from s),
      'candidates', coalesce((select json_agg(x) from (
        select c.id as "contractId", u.id as "unitId", u.unit_no as "unitNo",
          b.id as "buildingId", b.name_ar as "buildingNameAr", b.name_en as "buildingNameEn",
          b.area, u.type as "unitType", u.bedrooms, u.size_sqft as "sizeSqft",
          c.start_date as "startDate", c.annual_rent_fils as "annualRentFils", c.status
        from s
        join units u on u.type = s."unitType" and u.bedrooms is not distinct from s.bedrooms
          and u.id <> s."unitId" and u.size_sqft > 0
        join buildings b on b.id = u.building_id
        join contracts c on c.unit_id = u.id
        where c.status <> 'draft' and c.start_date > ${startedAfter} and c.start_date <= ${todayDate}
      ) x), '[]'::json)
    ) as suggestion`);
  const { subject, candidates } = jsonColumn(result, 'suggestion') as {
    subject: SubjectRow | null;
    candidates: (Omit<ComparableCandidate, 'annualRentFils'> & {
      annualRentFils: number | string;
    })[];
  };
  if (!subject) throw notFound('Contract');
  if (subject.status !== 'active') throw conflict('Only active contracts get a renewal suggestion');

  const annualRentFils = Number(subject.annualRentFils);
  const market = marketReference(
    {
      contractId: subject.contractId,
      unitId: subject.unitId,
      buildingId: subject.buildingId,
      area: subject.area,
      unitType: subject.unitType,
      bedrooms: subject.bedrooms,
      sizeSqft: subject.sizeSqft,
    },
    candidates.map((c) => ({ ...c, annualRentFils: Number(c.annualRentFils) })),
    todayDate,
  );
  const emirate = emirateFromArea(subject.area);
  const cap = renewalCap(emirate, annualRentFils, market);
  return {
    contractId: subject.contractId,
    today: todayDate,
    endDate: subject.endDate,
    dueInDays: renewalDueInDays(subject.endDate, todayDate),
    due: isRenewalDue(subject.status, subject.endDate, todayDate),
    windowDays: RENEWAL_WINDOW_DAYS,
    currentRentFils: annualRentFils,
    unit: {
      id: subject.unitId,
      unitNo: subject.unitNo,
      type: subject.unitType,
      bedrooms: subject.bedrooms,
      sizeSqft: subject.sizeSqft,
    },
    building: {
      id: subject.buildingId,
      nameAr: subject.buildingNameAr,
      nameEn: subject.buildingNameEn,
      area: subject.area,
    },
    emirate,
    market: { ...market, minComparables: MIN_COMPARABLES, startedAfter },
    cap,
    suggestedRentFils: suggestedRenewalRent(annualRentFils, cap),
    renewal:
      subject.renewalId && subject.renewalStatus
        ? { id: subject.renewalId, status: subject.renewalStatus }
        : null,
  };
}
