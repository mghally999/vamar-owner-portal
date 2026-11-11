/**
 * Bank statement matching (generic CSV). Staff upload the statement the bank emails them, map its
 * columns once per bank, and the dashboard proposes which cheques cleared or bounced. Everything
 * here is pure: the page parses the file in the browser and nothing changes until staff confirm,
 * after which the proposals go through the normal bulk status endpoint and its state machine.
 *
 * Banks write the same thing many ways, so the parsers are lenient on purpose: Arabic-Indic
 * digits, thousands separators, CR/DR markers, brackets for negatives, three date layouts. Money
 * is converted with string arithmetic into integer fils, never through floating point.
 */
import { z } from 'zod';
import {
  daysInMonth,
  diffDays,
  fromParts,
  isPlainDate,
  todayInDubai,
  type PlainDate,
} from './dates.js';
import { FILS_PER_AED } from './money.js';

/** The most cheques one bulk status call may change (it is one database transaction). */
export const MAX_BULK_CHEQUES = 200;

// Text normalisation -------------------------------------------------------------------------

/** Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits to ASCII; Arabic separators too. */
export function normaliseDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[٬،]/g, ',');
}

/**
 * A cheque number reduced to what identifies it: digits only, leading zeros dropped. Banks print
 * `000123`, `123` or `CHQ 123` for the same cheque.
 */
export function chequeNoKey(text: string | null | undefined): string | null {
  if (!text) return null;
  const digits = normaliseDigits(text).replace(/\D/g, '').replace(/^0+/, '');
  return digits === '' ? null : digits;
}

/** Digit runs of 4 to 12 that could be a cheque number written inside a description. */
export function chequeNumbersInText(text: string): string[] {
  const keys = new Set<string>();
  for (const run of normaliseDigits(text).match(/\d{4,12}/g) ?? []) {
    const key = chequeNoKey(run);
    if (key) keys.add(key);
  }
  return [...keys];
}

// Amounts ------------------------------------------------------------------------------------

/**
 * A statement amount as signed integer fils. Accepts `1,234.56`, `-1,234.56`, `(1,234.56)`,
 * `1,234.56 DR`, `1234.56-`, `AED 1,234.56`, `١٬٢٣٤٫٥٦`. Returns null for an empty or unreadable
 * cell (debit/credit columns are often blank) and for more than two non-zero decimals.
 */
export function parseStatementAmount(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  let s = normaliseDigits(text)
    .replace(/(aed|درهم|د\.إ\.?)/gi, '')
    .trim();
  if (s === '' || s === '-') return null;
  let negative = false;
  const marker = /\s*(CR|DR)\.?$/i.exec(s);
  if (marker) {
    negative = marker[1]?.toUpperCase() === 'DR';
    s = s.slice(0, marker.index).trim();
  }
  if (/^\(.*\)$/.test(s)) {
    negative = !negative;
    s = s.slice(1, -1).trim();
  }
  if (/^[-−–]/.test(s)) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (/[-−–]$/.test(s)) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  s = s.replace(/[\s,'’]/g, '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const decimals = m[2] ?? '';
  // Some exports pad to three decimals (`1234.500`); anything finer than a fil is not money.
  if (decimals.length > 2 && /[1-9]/.test(decimals.slice(2))) return null;
  const fils = Number(whole) * FILS_PER_AED + Number(decimals.slice(0, 2).padEnd(2, '0'));
  if (!Number.isSafeInteger(fils)) return null;
  return negative && fils !== 0 ? -fils : fils;
}

export type StatementDirection = 'credit' | 'debit';

/** A debit/credit indicator cell: CR, C, Credit, دائن, + versus DR, D, Debit, مدين, -. */
export function parseDirection(text: string | null | undefined): StatementDirection | null {
  const s = (text ?? '').trim().toUpperCase();
  if (['CR', 'C', 'CREDIT', 'CRED', '+', 'دائن', 'إيداع', 'ايداع'].includes(s)) return 'credit';
  if (['DR', 'D', 'DEBIT', 'DEB', '-', 'مدين', 'سحب'].includes(s)) return 'debit';
  return null;
}

// Dates --------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  يناير: 1,
  فبراير: 2,
  مارس: 3,
  أبريل: 4,
  ابريل: 4,
  إبريل: 4,
  مايو: 5,
  يونيو: 6,
  يوليو: 7,
  أغسطس: 8,
  اغسطس: 8,
  سبتمبر: 9,
  أكتوبر: 10,
  اكتوبر: 10,
  نوفمبر: 11,
  ديسمبر: 12,
};

function monthFromName(name: string): number | null {
  const lower = name.toLowerCase();
  if (lower in MONTHS) return MONTHS[lower] ?? null;
  // English months may be written in full ("November") or as "Sept".
  if (/^[a-z]+$/.test(lower) && lower.length >= 3) return MONTHS[lower.slice(0, 3)] ?? null;
  return null;
}

function validDate(year: number, month: number, day: number): PlainDate | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const d = fromParts({ year, month, day });
  return isPlainDate(d) ? d : null;
}

/**
 * A statement date as a Dubai calendar date. Accepts dd/mm/yyyy (also with - or .), yyyy-mm-dd
 * and dd-MMM-yyyy (English or Arabic month names, two- or four-digit year), with or without a
 * time after it. A full timestamp with a zone (`2026-11-03T21:30:00Z`) is converted to the date
 * it was in Dubai, because that is the business day the bank posted it.
 */
export function parseStatementDate(text: string | null | undefined): PlainDate | null {
  const s = normaliseDigits(text ?? '').trim();
  if (s === '') return null;
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const instant = new Date(s);
    return Number.isNaN(instant.getTime()) ? null : todayInDubai(instant);
  }
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (ymd) return validDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s.*)?$/.exec(s);
  if (dmy) return validDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const named = /^(\d{1,2})[-\s/]+([A-Za-z؀-ۿ]+)\.?[-\s/,]+(\d{4}|\d{2})(?:\s.*)?$/.exec(s);
  if (named) {
    const month = monthFromName(named[2] ?? '');
    if (month === null) return null;
    const y = named[3] ?? '';
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return validDate(year, month, Number(named[1]));
  }
  return null;
}

// Bounce wording -----------------------------------------------------------------------------

const BOUNCE_LATIN = /(^|[^A-Z])(RETURN(ED|S)?|RTN|RTND|BOUNCE[DS]?)(?=[^A-Z]|$)/;
const BOUNCE_ARABIC = /مرتجع|ارتجاع/;

/** True when the description says the cheque came back unpaid (RETURN, RTN, BOUNCED, مرتجع). */
export function isBounceDescription(text: string | null | undefined): boolean {
  if (!text) return false;
  return BOUNCE_LATIN.test(text.toUpperCase()) || BOUNCE_ARABIC.test(text);
}

// Column mapping -----------------------------------------------------------------------------

const column = z.string().trim().min(1).max(120);

/**
 * How one bank's CSV maps to statement fields, by header text. With `debitColumn` the bank uses
 * separate debit and credit columns and `amountColumn` is the credit one; with `signColumn` one
 * amount column is paired with a CR/DR indicator; with neither, negative amounts are debits.
 */
export const bankCsvMappingSchema = z.object({
  bank: z.string().trim().min(1).max(80),
  dateColumn: column,
  amountColumn: column,
  chequeNoColumn: column.nullable().default(null),
  descriptionColumn: column.nullable().default(null),
  signColumn: column.nullable().default(null),
  debitColumn: column.nullable().default(null),
});
export type BankCsvMapping = z.infer<typeof bankCsvMappingSchema>;

export const BANK_CSV_MAPPINGS_KEY = 'bank_csv_mappings';
export const MAX_BANK_CSV_MAPPINGS = 50;

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

/** Add or replace a bank's mapping (bank names compare without case). */
export function upsertBankCsvMapping(
  list: readonly BankCsvMapping[],
  mapping: BankCsvMapping,
): BankCsvMapping[] {
  const key = mapping.bank.trim().toLowerCase();
  return [...list.filter((m) => m.bank.trim().toLowerCase() !== key), mapping].sort((a, b) =>
    a.bank.localeCompare(b.bank),
  );
}

/**
 * The header row of a statement grid. Banks put account details above the table, so it is the
 * first of the top rows that has as many filled cells as the widest row there.
 */
export function detectHeaderRow(grid: readonly (readonly string[])[], scan = 30): number {
  const filled = grid.slice(0, scan).map((row) => row.filter((c) => c.trim() !== '').length);
  const widest = Math.max(0, ...filled);
  const index = filled.findIndex((n) => n === widest && n >= 2);
  return index < 0 ? 0 : index;
}

export interface StatementLine {
  /** 1-based row in the file, so staff can find it in the bank's own view. */
  row: number;
  date: PlainDate;
  /** Always positive; `direction` carries the sign. */
  amountFils: number;
  direction: StatementDirection;
  chequeNo: string | null;
  description: string;
  bounce: boolean;
}

export type SkipReason = 'bad_date' | 'bad_amount' | 'zero_amount';

export interface ParsedStatement {
  lines: StatementLine[];
  skipped: { row: number; reason: SkipReason }[];
  /** Mapped columns that are not in the file's header (the mapping is for another layout). */
  missingColumns: string[];
}

function cellIndex(header: readonly string[], name: string | null): number {
  if (!name) return -1;
  const want = name.trim().toLowerCase();
  return header.findIndex((h) => h.trim().toLowerCase() === want);
}

/** Read the statement rows below `headerRow` with a column mapping. */
export function parseStatement(
  grid: readonly (readonly string[])[],
  mapping: BankCsvMapping,
  headerRow = detectHeaderRow(grid),
): ParsedStatement {
  const header = grid[headerRow] ?? [];
  const named = {
    date: mapping.dateColumn,
    amount: mapping.amountColumn,
    chequeNo: mapping.chequeNoColumn,
    description: mapping.descriptionColumn,
    sign: mapping.signColumn,
    debit: mapping.debitColumn,
  };
  const idx = Object.fromEntries(
    Object.entries(named).map(([k, v]) => [k, cellIndex(header, v)]),
  ) as Record<keyof typeof named, number>;
  const missingColumns = Object.entries(named).flatMap(([k, v]) =>
    v !== null && idx[k as keyof typeof named] < 0 ? [v] : [],
  );
  const out: ParsedStatement = { lines: [], skipped: [], missingColumns };
  if (missingColumns.length) return out;

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const cell = (i: number) => (i < 0 ? '' : (row[i] ?? '').trim());
    if (row.every((c) => c.trim() === '')) continue;
    const fileRow = r + 1;
    const date = parseStatementDate(cell(idx.date));
    if (!date) {
      out.skipped.push({ row: fileRow, reason: 'bad_date' });
      continue;
    }
    let signed: number | null;
    if (idx.debit >= 0) {
      const debit = parseStatementAmount(cell(idx.debit));
      const credit = parseStatementAmount(cell(idx.amount));
      signed = debit ? -Math.abs(debit) : credit === null ? null : Math.abs(credit);
    } else {
      signed = parseStatementAmount(cell(idx.amount));
      const direction = parseDirection(cell(idx.sign));
      if (signed !== null && direction)
        signed = direction === 'debit' ? -Math.abs(signed) : Math.abs(signed);
    }
    if (signed === null) {
      out.skipped.push({ row: fileRow, reason: 'bad_amount' });
      continue;
    }
    if (signed === 0) {
      out.skipped.push({ row: fileRow, reason: 'zero_amount' });
      continue;
    }
    const description = cell(idx.description);
    const chequeNo = cell(idx.chequeNo);
    out.lines.push({
      row: fileRow,
      date,
      amountFils: Math.abs(signed),
      direction: signed < 0 ? 'debit' : 'credit',
      chequeNo: chequeNo === '' ? null : chequeNo,
      description,
      bounce: isBounceDescription(description),
    });
  }
  return out;
}

// Matching -----------------------------------------------------------------------------------

/** How far apart the statement date and the cheque's due or deposit date may be for a weak match. */
export const WEAK_MATCH_DAYS = 3;

export interface CandidateCheque {
  id: string;
  chequeNo: string | null;
  amountFils: number | null;
  dueDate: PlainDate;
  status: 'upcoming' | 'deposited';
  depositedOn: PlainDate | null;
}

export type MatchStrength = 'strong' | 'weak';
export type MatchAction = 'cleared' | 'bounced';

export interface StatementMatch {
  line: StatementLine;
  chequeId: string;
  strength: MatchStrength;
  action: MatchAction;
  /** Days between the statement date and the nearer of the cheque's due and deposit dates. */
  dayGap: number;
  /** Other unclaimed cheques that fitted this line just as the chosen one did. */
  alternatives: number;
}

export type UnmatchedReason = 'debit' | 'no_match' | 'already_matched';

export interface MatchResult {
  matches: StatementMatch[];
  unmatched: { line: StatementLine; reason: UnmatchedReason }[];
}

function dayGap(line: StatementLine, c: CandidateCheque): number {
  const gaps = [Math.abs(diffDays(line.date, c.dueDate))];
  if (c.depositedOn) gaps.push(Math.abs(diffDays(line.date, c.depositedOn)));
  return Math.min(...gaps);
}

/**
 * Propose which cheques a statement settles.
 *
 * - Strong: the cheque number (from its column, or else a number inside the description) and the
 *   amount both equal the cheque's.
 * - Weak: the line has no cheque number, the amount is equal and the date is within
 *   WEAK_MATCH_DAYS of the cheque's due or deposit date. Shown for review, never pre-selected.
 * - A line whose description says RETURN/RTN/BOUNCED/مرتجع proposes `bounced`, otherwise a credit
 *   proposes `cleared`. Other debits are the account's own payments and are left alone.
 *
 * Each cheque is proposed once. Bounces are placed first, so when a statement shows the credit
 * and later its return, the cheque ends bounced and the credit is reported as already matched.
 */
export function matchStatement(
  lines: readonly StatementLine[],
  cheques: readonly CandidateCheque[],
): MatchResult {
  const usable = cheques.filter((c) => c.amountFils !== null);
  const byKey = new Map<string, CandidateCheque[]>();
  for (const c of usable) {
    const key = chequeNoKey(c.chequeNo);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }

  interface Pending {
    line: StatementLine;
    strength: MatchStrength;
    candidates: CandidateCheque[];
  }
  const pending: Pending[] = [];
  const unmatched: MatchResult['unmatched'] = [];

  for (const line of lines) {
    if (line.direction === 'debit' && !line.bounce) {
      unmatched.push({ line, reason: 'debit' });
      continue;
    }
    const columnKey = chequeNoKey(line.chequeNo);
    const keys = columnKey ? [columnKey] : chequeNumbersInText(line.description);
    const strong = keys
      .flatMap((k) => byKey.get(k) ?? [])
      .filter((c) => c.amountFils === line.amountFils);
    if (strong.length) {
      pending.push({ line, strength: 'strong', candidates: strong });
      continue;
    }
    if (columnKey) {
      // A number that matches no cheque means this is some other cheque; never guess by amount.
      unmatched.push({ line, reason: 'no_match' });
      continue;
    }
    const weak = usable.filter(
      (c) => c.amountFils === line.amountFils && dayGap(line, c) <= WEAK_MATCH_DAYS,
    );
    if (weak.length) pending.push({ line, strength: 'weak', candidates: weak });
    else unmatched.push({ line, reason: 'no_match' });
  }

  const tier = (p: Pending) => (p.strength === 'strong' ? 0 : 2) + (p.line.bounce ? 0 : 1);
  pending.sort((a, b) => tier(a) - tier(b) || a.line.row - b.line.row);

  const claimed = new Set<string>();
  const matches: StatementMatch[] = [];
  for (const p of pending) {
    const open = p.candidates
      .filter((c) => !claimed.has(c.id))
      .map((c) => ({ c, gap: dayGap(p.line, c) }))
      .sort(
        (a, b) =>
          a.gap - b.gap ||
          (a.c.dueDate < b.c.dueDate ? -1 : a.c.dueDate > b.c.dueDate ? 1 : 0) ||
          (a.c.id < b.c.id ? -1 : 1),
      );
    const best = open[0];
    if (!best) {
      unmatched.push({ line: p.line, reason: 'already_matched' });
      continue;
    }
    claimed.add(best.c.id);
    matches.push({
      line: p.line,
      chequeId: best.c.id,
      strength: p.strength,
      action: p.line.bounce ? 'bounced' : 'cleared',
      dayGap: best.gap,
      alternatives: open.length - 1,
    });
  }
  matches.sort((a, b) => a.line.row - b.line.row);
  unmatched.sort((a, b) => a.line.row - b.line.row);
  return { matches, unmatched };
}

export interface BulkStep {
  status: 'deposited' | MatchAction;
  date: PlainDate;
  ids: string[];
}

/**
 * Turn the matches staff ticked into bulk status calls. The state machine only clears or bounces
 * a deposited cheque, so an upcoming cheque the bank already settled is first marked deposited
 * on the statement date (the bank had it by then). Deposits go first, then clears, then bounces;
 * each step is grouped by date because one bulk call carries one date.
 */
export function planStatementApply(
  selected: readonly { chequeId: string; action: MatchAction; date: PlainDate }[],
  statusOf: (chequeId: string) => CandidateCheque['status'] | undefined,
): BulkStep[] {
  const groups = new Map<string, BulkStep>();
  const add = (status: BulkStep['status'], date: PlainDate, id: string) => {
    const key = `${status}|${date}`;
    const step = groups.get(key) ?? { status, date, ids: [] };
    if (!step.ids.includes(id)) step.ids.push(id);
    groups.set(key, step);
  };
  for (const s of selected) {
    if (statusOf(s.chequeId) === 'upcoming') add('deposited', s.date, s.chequeId);
    add(s.action, s.date, s.chequeId);
  }
  const order: Record<BulkStep['status'], number> = { deposited: 0, cleared: 1, bounced: 2 };
  const steps: BulkStep[] = [];
  for (const g of [...groups.values()].sort(
    (a, b) => order[a.status] - order[b.status] || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  )) {
    for (let i = 0; i < g.ids.length; i += MAX_BULK_CHEQUES)
      steps.push({ ...g, ids: g.ids.slice(i, i + MAX_BULK_CHEQUES) });
  }
  return steps;
}
