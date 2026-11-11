/**
 * Contract renewal suggestions: a market reference from Vamar's own recent contracts and the
 * Dubai rent increase cap (Decree No. 43 of 2013). Pure functions; the API feeds them rows and
 * the dashboard only displays the result.
 *
 * The reference is Vamar's own data, never an official index: the RERA rental index is not
 * available to us, so staff see the comparables behind every figure and decide.
 */
import { z } from 'zod';
import { addMonthsClamped, compareDates, diffDays, type PlainDate } from './dates.js';
import { filsSchema } from './schemas/common.js';

/** Contracts ending within this many days get a renewal suggestion in lists and reminders. */
export const RENEWAL_WINDOW_DAYS = 90;
/** Fewer comparables than this and we say there is not enough data instead of a median. */
export const MIN_COMPARABLES = 3;
/** Only contracts that started within this many months count as the current market. */
export const COMPARABLE_MONTHS = 12;

export const EMIRATES = [
  'dubai',
  'sharjah',
  'abu_dhabi',
  'ajman',
  'umm_al_quwain',
  'ras_al_khaimah',
  'fujairah',
] as const;
export type Emirate = (typeof EMIRATES)[number];

// Spellings staff actually type in the building's area ("Al Khan, Sharjah"), English and Arabic.
const EMIRATE_NAMES: Record<Emirate, readonly string[]> = {
  dubai: ['dubai', 'دبي'],
  sharjah: ['sharjah', 'الشارقة'],
  abu_dhabi: ['abu dhabi', 'abudhabi', 'أبوظبي', 'أبو ظبي', 'ابوظبي', 'ابو ظبي'],
  ajman: ['ajman', 'عجمان'],
  umm_al_quwain: ['umm al quwain', 'umm al-quwain', 'أم القيوين', 'ام القيوين'],
  ras_al_khaimah: ['ras al khaimah', 'ras al-khaimah', 'rak', 'رأس الخيمة', 'راس الخيمة'],
  fujairah: ['fujairah', 'الفجيرة'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The emirate of a building, read from its `area` field ("Business Bay, Dubai"). The buildings
 * table has no emirate column; the area ends with the emirate by convention. The last
 * comma-separated part is checked first so "Dubai Investment Park, Dubai" or an area named after
 * another city still resolves to the emirate written last. Null when no emirate is named.
 */
export function emirateFromArea(area: string): Emirate | null {
  const parts = area.split(/[,،]/).map(norm).filter(Boolean).reverse();
  for (const part of parts) {
    for (const e of EMIRATES) if (EMIRATE_NAMES[e].includes(part)) return e;
  }
  for (const part of parts) {
    for (const e of EMIRATES) {
      if (EMIRATE_NAMES[e].some((n) => n.length > 3 && part.includes(n))) return e;
    }
  }
  return null;
}

/** Annual rent per square foot in whole fils, rounded half up. */
export function rentPerSqftFils(annualRentFils: number, sizeSqft: number): number {
  if (!Number.isSafeInteger(annualRentFils) || annualRentFils <= 0)
    throw new RangeError('annual rent must be a positive integer of fils');
  if (!Number.isSafeInteger(sizeSqft) || sizeSqft <= 0)
    throw new RangeError('size must be a positive whole number of sq ft');
  return Math.floor((annualRentFils * 2 + sizeSqft) / (sizeSqft * 2));
}

/** Median of whole numbers; with an even count, the mean of the middle two rounded half up. */
export function medianInt(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median of nothing');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Both indexes exist: the list is not empty and mid >= 1 whenever the count is even.
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  const lo = sorted[mid - 1] ?? 0;
  return Math.floor((lo + hi + 1) / 2);
}

export interface RenewalSubject {
  contractId: string;
  unitId: string;
  buildingId: string;
  area: string;
  unitType: string;
  bedrooms: number | null;
  sizeSqft: number | null;
}

export interface ComparableCandidate {
  contractId: string;
  unitId: string;
  unitNo: string;
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  area: string;
  unitType: string;
  bedrooms: number | null;
  sizeSqft: number | null;
  startDate: PlainDate;
  annualRentFils: number;
  status: string;
}

export interface Comparable {
  contractId: string;
  unitId: string;
  unitNo: string;
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  sizeSqft: number;
  startDate: PlainDate;
  annualRentFils: number;
  filsPerSqft: number;
}

/** How far we had to look: the same building, the same area, then the same emirate. */
export type ComparableScope = 'building' | 'area' | 'emirate';

export type MarketReference =
  | {
      status: 'ok';
      scope: ComparableScope;
      comparables: Comparable[];
      medianFilsPerSqft: number;
      minFilsPerSqft: number;
      maxFilsPerSqft: number;
      /** The median per sq ft times this unit's size: the rent the cap compares against. */
      referenceRentFils: number;
    }
  | {
      status: 'not_enough_data';
      /** The widest scope searched, with whatever it found (fewer than MIN_COMPARABLES). */
      scope: ComparableScope;
      comparables: Comparable[];
    }
  | { status: 'no_size'; comparables: [] };

/** First day a comparable contract may have started: COMPARABLE_MONTHS before today, exclusive. */
export function comparableWindowStart(today: PlainDate): PlainDate {
  return addMonthsClamped(today, -COMPARABLE_MONTHS);
}

/**
 * Pick comparables for the unit being renewed and work out the market reference.
 *
 * A comparable is another unit of the same type and bedroom count (null bedrooms match null:
 * shops, offices) with a known size, on a non-draft contract that started in the last
 * COMPARABLE_MONTHS months and not after today. Only each unit's latest such contract counts,
 * so one unit re-let twice does not weigh double. The scope widens from the same building to
 * the same area to the same emirate and stops at the first one with MIN_COMPARABLES.
 */
export function marketReference(
  subject: RenewalSubject,
  candidates: readonly ComparableCandidate[],
  today: PlainDate,
): MarketReference {
  if (!subject.sizeSqft || subject.sizeSqft <= 0) return { status: 'no_size', comparables: [] };
  const windowStart = comparableWindowStart(today);
  const latestPerUnit = new Map<string, ComparableCandidate & { sizeSqft: number }>();
  for (const c of candidates) {
    if (c.status === 'draft' || c.unitId === subject.unitId) continue;
    if (c.unitType !== subject.unitType || c.bedrooms !== subject.bedrooms) continue;
    if (!c.sizeSqft || c.sizeSqft <= 0 || c.annualRentFils <= 0) continue;
    if (compareDates(c.startDate, windowStart) <= 0 || compareDates(c.startDate, today) > 0)
      continue;
    const seen = latestPerUnit.get(c.unitId);
    if (
      !seen ||
      compareDates(c.startDate, seen.startDate) > 0 ||
      (c.startDate === seen.startDate && c.contractId > seen.contractId)
    )
      latestPerUnit.set(c.unitId, { ...c, sizeSqft: c.sizeSqft });
  }
  const pool = [...latestPerUnit.values()];
  const subjectArea = norm(subject.area);
  const subjectEmirate = emirateFromArea(subject.area);
  const scopes: [ComparableScope, (c: ComparableCandidate) => boolean][] = [
    ['building', (c) => c.buildingId === subject.buildingId],
    ['area', (c) => c.buildingId === subject.buildingId || norm(c.area) === subjectArea],
  ];
  // Without a known emirate, "same emirate" would mean "anywhere": stop at the area.
  if (subjectEmirate)
    scopes.push([
      'emirate',
      (c) =>
        c.buildingId === subject.buildingId ||
        norm(c.area) === subjectArea ||
        emirateFromArea(c.area) === subjectEmirate,
    ]);

  let found: Comparable[] = [];
  let scope: ComparableScope = 'building';
  for (const [s, match] of scopes) {
    scope = s;
    found = pool
      .filter(match)
      .map((c) => ({
        contractId: c.contractId,
        unitId: c.unitId,
        unitNo: c.unitNo,
        buildingId: c.buildingId,
        buildingNameAr: c.buildingNameAr,
        buildingNameEn: c.buildingNameEn,
        sizeSqft: c.sizeSqft,
        startDate: c.startDate,
        annualRentFils: c.annualRentFils,
        filsPerSqft: rentPerSqftFils(c.annualRentFils, c.sizeSqft),
      }))
      // Newest first, then by id so the list is stable for the same data.
      .sort(
        (a, b) => compareDates(b.startDate, a.startDate) || (a.contractId < b.contractId ? -1 : 1),
      );
    if (found.length >= MIN_COMPARABLES) break;
  }
  if (found.length < MIN_COMPARABLES)
    return { status: 'not_enough_data', scope, comparables: found };
  const perSqft = found.map((c) => c.filsPerSqft);
  const median = medianInt(perSqft);
  return {
    status: 'ok',
    scope,
    comparables: found,
    medianFilsPerSqft: median,
    minFilsPerSqft: Math.min(...perSqft),
    maxFilsPerSqft: Math.max(...perSqft),
    referenceRentFils: median * subject.sizeSqft,
  };
}

/** The increase steps of Decree No. 43 of 2013, in percent. */
export type DubaiIncreasePct = 0 | 5 | 10 | 15 | 20;

export interface DubaiRentCap {
  /** How far the current rent is below the reference, in basis points (negative when above). */
  belowReferenceBp: number;
  increasePct: DubaiIncreasePct;
  /** Current rent plus the allowed increase, rounded down to the fils (it is a ceiling). */
  maxRentFils: number;
}

/**
 * Dubai rent increase cap (Decree No. 43 of 2013). With the gap g = (reference − current) /
 * reference: g ≤ 10 % → no increase; 10 % < g ≤ 20 % → 5 %; ≤ 30 % → 10 %; ≤ 40 % → 15 %;
 * more than 40 % → 20 %. The decree's bands read "11–20 %"; a gap between 10 % and 11 % falls
 * in the 5 % band, so every gap above 10 % allows something. Computed in BigInt so the band
 * edges are exact (no floating point at 20.000…1 %).
 */
export function dubaiRentCap(currentRentFils: number, referenceRentFils: number): DubaiRentCap {
  if (!Number.isSafeInteger(currentRentFils) || currentRentFils <= 0)
    throw new RangeError('current rent must be a positive integer of fils');
  if (!Number.isSafeInteger(referenceRentFils) || referenceRentFils <= 0)
    throw new RangeError('reference rent must be a positive integer of fils');
  const cur = BigInt(currentRentFils);
  const ref = BigInt(referenceRentFils);
  const gap100 = (ref - cur) * 100n; // gap in percent, times the reference
  let increasePct: DubaiIncreasePct;
  if (gap100 <= ref * 10n) increasePct = 0;
  else if (gap100 <= ref * 20n) increasePct = 5;
  else if (gap100 <= ref * 30n) increasePct = 10;
  else if (gap100 <= ref * 40n) increasePct = 15;
  else increasePct = 20;
  const maxRentFils = Number(cur + (cur * BigInt(increasePct)) / 100n);
  // Truncates toward zero, which is what a display figure in basis points needs.
  const belowReferenceBp = Number(((ref - cur) * 10_000n) / ref);
  return { belowReferenceBp, increasePct, maxRentFils };
}

export type RenewalCap =
  | ({ kind: 'dubai' } & DubaiRentCap)
  /** A Dubai building but no market reference: the cap cannot be worked out. */
  | { kind: 'dubai_no_reference' }
  /** Sharjah, another emirate or an area that names none: staff check that emirate's rules. */
  | { kind: 'check_emirate_rules' };

export function renewalCap(
  emirate: Emirate | null,
  currentRentFils: number,
  market: MarketReference,
): RenewalCap {
  if (emirate !== 'dubai') return { kind: 'check_emirate_rules' };
  if (market.status !== 'ok') return { kind: 'dubai_no_reference' };
  return { kind: 'dubai', ...dubaiRentCap(currentRentFils, market.referenceRentFils) };
}

/**
 * The rent the "Prepare renewal" form starts with. In Dubai it is the maximum the cap allows;
 * everywhere else, and when there is no reference, the current rent: the app never proposes an
 * increase it cannot back with a rule. Staff can type any figure.
 */
export function suggestedRenewalRent(currentRentFils: number, cap: RenewalCap): number {
  return cap.kind === 'dubai' ? cap.maxRentFils : currentRentFils;
}

/** Days from today to the contract's last day; 0 on the last day, negative once it has passed. */
export function renewalDueInDays(endDate: PlainDate, today: PlainDate): number {
  return diffDays(today, endDate);
}

/** True for an active contract whose last day is today or within RENEWAL_WINDOW_DAYS. */
export function isRenewalDue(status: string, endDate: PlainDate, today: PlainDate): boolean {
  if (status !== 'active') return false;
  const n = renewalDueInDays(endDate, today);
  return n >= 0 && n <= RENEWAL_WINDOW_DAYS;
}

/** Optional body of POST /contracts/:id/renew: the new annual rent, else the old one is kept. */
export const renewContractSchema = z.object({ annualRentFils: filsSchema.optional() });
export type RenewContractInput = z.infer<typeof renewContractSchema>;
