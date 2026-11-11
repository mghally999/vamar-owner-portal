/**
 * The period statement: rent (expected, collected, bounced), expenses (fixed and variable with
 * reason and invoice number), net, and the cases in the period with their cheque numbers, for the
 * period the owner chose on Home. Data comes from the summary already on screen plus the cheques
 * and expenses of the period. The yearly statement is the same document for a calendar year with
 * a month-by-month table added from the summary's monthly buckets.
 *
 * Every amount is the owner's share; the footer says so. Vamar's commission is never shown: the
 * owner sees net before the fee, as on Home.
 */
import {
  formatAmount,
  formatDate,
  formatMonth,
  formatPeriod,
  monthBuckets,
  NET_BEFORE_FEE_LABEL,
  todayInDubai,
  yearPeriod,
  type Lang,
  type Period,
  type PlainDate,
} from '@vamar/shared';
import { CHEQUE_STATUS_LABEL, DISPUTE_STATUS_LABEL } from '@vamar/shared';
import { qs, request } from './api';
import { messages, type MessageKey } from './messages';
import type { PeriodQuery } from './period';
import { sharePeriodStatementHtml } from './statement';
import type { ChequeItem, DisputeItem, ExpenseItem, Page, Summary, SummaryBucket } from './types';

export interface PeriodStatementInput {
  ownerName: string;
  lang: Lang;
  period: Period;
  summary: Summary;
  cheques: ChequeItem[];
  expenses: ExpenseItem[];
  /** The owner's cases; the statement lists those open during the period. */
  disputes?: DisputeItem[] | undefined;
  generatedOn: PlainDate;
  beforeFeeLabel: boolean;
  /** The cheque or expense list was longer than the statement fetches; a note says so. */
  truncated?: boolean | undefined;
  /** A yearly statement: titled as one, with a row per month of the period from the summary. */
  monthly?: boolean | undefined;
}

/** The paged owner lists a statement reads, and the row each one returns. */
interface StatementList {
  '/api/owner/cheques': ChequeItem;
  '/api/owner/expenses': ExpenseItem;
  '/api/owner/disputes': DisputeItem;
}

/** Rows per page and the most pages a statement fetches per list (5,000 rows). */
export const STATEMENT_PAGE_SIZE = 100;
export const STATEMENT_MAX_PAGES = 50;

/**
 * Every row of a paged owner list for the statement, following `nextCursor` until the end. Stops
 * after `maxPages` pages and reports it, so the statement says it is incomplete instead of
 * quietly dropping rows.
 */
export async function fetchAllPages<P extends keyof StatementList>(
  path: P,
  params: Record<string, string | number | boolean | undefined | null>,
  maxPages = STATEMENT_MAX_PAGES,
): Promise<{ items: StatementList[P][]; truncated: boolean }> {
  const items: StatementList[P][] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await request<Page<StatementList[P]>>(
      `${path}${qs({ ...params, limit: STATEMENT_PAGE_SIZE, cursor })}`,
    );
    items.push(...res.items);
    if (!res.nextCursor) return { items, truncated: false };
    cursor = res.nextCursor;
  }
  return { items, truncated: true };
}

/** A case belongs on the statement when it was open at any time during the period. */
export function disputeInPeriod(d: DisputeItem, period: Period): boolean {
  const opened = todayInDubai(new Date(d.openedAt));
  const closed = d.closedAt ? todayInDubai(new Date(d.closedAt)) : null;
  return opened <= period.to && (closed === null || closed >= period.from);
}

export interface MonthRow {
  /** `YYYY-MM`. */
  key: string;
  collectedFils: number;
  expensesFils: number;
  netFils: number;
}

/**
 * One row per calendar month of the period, from the summary's buckets; a month the API left out
 * is a row of zeros, so a year always has twelve. Net is collected minus expenses, as on Home.
 */
export function monthRows(period: Period, buckets: SummaryBucket[]): MonthRow[] {
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  return monthBuckets(period, Number.POSITIVE_INFINITY).map(({ key }) => {
    const b = byKey.get(key);
    const collectedFils = b?.collectedFils ?? 0;
    const expensesFils = b ? b.fixedFils + b.variableFils : 0;
    return { key, collectedFils, expensesFils, netFils: collectedFils - expensesFils };
  });
}

export function periodStatementHtml(input: PeriodStatementInput, fontSrc: string): string {
  const { lang, summary } = input;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const dict = messages[lang];
  const t = (key: MessageKey, vars: Record<string, string> = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), dict[key]);
  const listSep = lang === 'ar' ? '، ' : ', ';
  const amt = (fils: number | null | undefined) =>
    fils === null || fils === undefined ? '—' : formatAmount(fils, lang);
  const chequeRows = input.cheques
    .filter((c) => c.status !== 'cancelled' && c.status !== 'replaced')
    .map(
      (c) => `<tr>
        <td class="n">${formatDate(c.dueDate as PlainDate, lang)}</td>
        <td>${lang === 'ar' ? c.buildingNameAr : c.buildingNameEn} ${c.unitNo}</td>
        <td>${c.tenantName}</td>
        <td class="n">${c.chequeNo ?? '—'}</td>
        <td class="n amt">${amt(c.amountFils)}</td>
        <td>${CHEQUE_STATUS_LABEL[c.status][lang]}</td>
      </tr>`,
    )
    .join('');
  const expenseRows = input.expenses
    .map(
      (e) => `<tr>
        <td class="n">${formatDate(e.invoiceDate as PlainDate, lang)}</td>
        <td>${lang === 'ar' ? e.categoryNameAr : e.categoryNameEn} · ${e.kind === 'fixed' ? t('statement_fixed') : t('statement_variable')}</td>
        <td>${lang === 'ar' ? e.reasonAr : e.reasonEn}</td>
        <td>${lang === 'ar' ? e.buildingNameAr : e.buildingNameEn}${e.unitNo ? ` ${e.unitNo}` : ''}</td>
        <td class="n">${e.invoiceNo ?? '—'}</td>
        <td class="n amt">${amt(e.amountFils)}</td>
      </tr>`,
    )
    .join('');
  const disputes = (input.disputes ?? []).filter((d) => disputeInPeriod(d, input.period));
  const disputeRows = disputes
    .map(
      (d) => `<tr>
        <td class="n">${d.caseNo}</td>
        <td class="n">${d.chequeNos.length ? d.chequeNos.join(listSep) : '—'}</td>
        <td>${lang === 'ar' ? d.buildingNameAr : d.buildingNameEn} ${d.unitNo}</td>
        <td>${DISPUTE_STATUS_LABEL[d.status][lang]}</td>
        <td class="n">${d.nextHearingDate ? formatDate(d.nextHearingDate as PlainDate, lang) : '—'}</td>
        <td class="n amt">${amt(d.amountClaimedFils)}</td>
      </tr>`,
    )
    .join('');
  let monthTable = '';
  if (input.monthly) {
    const rows = monthRows(input.period, summary.buckets);
    const sum = (pick: (r: MonthRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
    monthTable = `<h2>${t('statement_months')}</h2>
<table class="months"><thead><tr>
<th>${t('statement_col_month')}</th><th>${t('statement_collected')}</th><th>${t('statement_expenses')}</th><th>${t('statement_net')}</th>
</tr></thead><tbody>${rows
      .map(
        (r) => `<tr class="month" data-month="${r.key}">
        <td>${formatMonth(`${r.key}-01` as PlainDate, lang)}</td>
        <td class="n amt">${amt(r.collectedFils)}</td>
        <td class="n amt">${amt(r.expensesFils)}</td>
        <td class="n amt">${amt(r.netFils)}</td>
      </tr>`,
      )
      .join('')}</tbody><tfoot><tr class="total">
        <th>${t('statement_yearTotal')}</th>
        <th class="n amt" data-total="collected">${amt(sum((r) => r.collectedFils))}</th>
        <th class="n amt" data-total="expenses">${amt(sum((r) => r.expensesFils))}</th>
        <th class="n amt" data-total="net">${amt(sum((r) => r.netFils))}</th>
      </tr></tfoot></table>`;
  }
  const net = summary.isFuture ? summary.projectedNetFils : summary.netFils;
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8">
<style>
@font-face{font-family:'Almarai';src:${fontSrc}}
body{font-family:'Almarai',sans-serif;color:#25323a;margin:28px;font-size:12px}
h1{font-size:20px;margin:0 0 4px;font-weight:600}
h2{font-size:14px;margin:22px 0 6px;font-weight:600}
.muted{color:#5e676c}
.tiles{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.tile{flex:1;min-width:120px;border:1px solid #b8b9b2;border-radius:10px;padding:10px}
.tile .v{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
table{width:100%;border-collapse:collapse;margin-top:6px}
th,td{padding:6px 5px;border-bottom:1px solid #b8b9b2;text-align:start;vertical-align:top}
th{font-size:11px;color:#5e676c;font-weight:500}
tfoot th{color:#25323a;font-weight:600;border-bottom:none;border-top:1.5px solid #25323a}
.n{font-variant-numeric:tabular-nums}
.amt{white-space:nowrap}
.foot{margin-top:24px;font-size:10px;color:#5e676c}
.note{margin-top:10px;padding:8px 10px;border:1px solid #8a5a12;border-radius:8px;color:#8a5a12}
</style></head><body>
<h1>${input.monthly ? t('statement_yearTitle') : t('statement_title')}</h1>
<div class="muted">${input.ownerName} · ${formatPeriod(input.period, lang)}</div>
${input.truncated ? `<div class="note">${t('statement_truncated')}</div>` : ''}
<div class="tiles">
<div class="tile"><div class="muted">${t('statement_expectedRent')}</div><div class="v">${amt(summary.rent.expectedFils)}</div></div>
<div class="tile"><div class="muted">${t('statement_collected')}</div><div class="v">${amt(summary.rent.collectedFils)}</div></div>
<div class="tile"><div class="muted">${t('statement_bounced')}</div><div class="v">${amt(summary.rent.atRiskFils)}</div></div>
<div class="tile"><div class="muted">${t('statement_fixedExpenses')}</div><div class="v">${amt(summary.expenses.fixedFils)}</div></div>
<div class="tile"><div class="muted">${t('statement_variableExpenses')}</div><div class="v">${amt(summary.expenses.variableFils)}</div></div>
<div class="tile"><div class="muted">${summary.isFuture ? t('statement_projectedNet') : t('statement_net')}${input.beforeFeeLabel ? ` · ${NET_BEFORE_FEE_LABEL[lang]}` : ''}</div><div class="v">${amt(net)}</div></div>
</div>
${monthTable}
<h2>${t('statement_rent')}</h2>
<table><thead><tr>
<th>${t('statement_col_date')}</th><th>${t('statement_col_unit')}</th><th>${t('statement_col_tenant')}</th><th>${t('statement_col_chequeNo')}</th><th>${t('statement_col_amount')}</th><th>${t('statement_col_status')}</th>
</tr></thead><tbody>${chequeRows || `<tr><td colspan="6" class="muted">${t('statement_noCheques')}</td></tr>`}</tbody></table>
<h2>${t('statement_expenses')}</h2>
<table><thead><tr>
<th>${t('statement_col_date')}</th><th>${t('statement_col_category')}</th><th>${t('statement_col_reason')}</th><th>${t('statement_col_property')}</th><th>${t('statement_col_invoiceNo')}</th><th>${t('statement_col_share')}</th>
</tr></thead><tbody>${expenseRows || `<tr><td colspan="6" class="muted">${t('statement_noExpenses')}</td></tr>`}</tbody></table>
${
  disputeRows
    ? `<h2>${t('statement_cases')}</h2>
<table><thead><tr>
<th>${t('statement_col_caseNo')}</th><th>${t('statement_col_chequeNo')}</th><th>${t('statement_col_unit')}</th><th>${t('statement_col_status')}</th><th>${t('statement_col_nextHearing')}</th><th>${t('statement_col_claimed')}</th>
</tr></thead><tbody>${disputeRows}</tbody></table>`
    : ''
}
<div class="foot">${t('statement_generated', { date: formatDate(input.generatedOn, lang) })} ${t('statement_ownerShare')}</div>
</body></html>`;
}

/** Loads the period's cheques and expenses, then opens the share sheet (or the print dialog on the web). */
export async function shareStatementForPeriod(input: {
  ownerName: string;
  lang: Lang;
  period: Period;
  query: PeriodQuery;
  summary: Summary;
  beforeFeeLabel?: boolean;
  monthly?: boolean;
}): Promise<void> {
  const [cheques, expenses, disputes] = await Promise.all([
    fetchAllPages('/api/owner/cheques', {
      from: input.period.from,
      to: input.period.to,
    }),
    fetchAllPages('/api/owner/expenses', { ...input.query }),
    fetchAllPages('/api/owner/disputes', {}),
  ]);
  const html = (fontSrc: string) =>
    periodStatementHtml(
      {
        ownerName: input.ownerName,
        lang: input.lang,
        period: input.period,
        summary: input.summary,
        cheques: cheques.items,
        expenses: expenses.items,
        disputes: disputes.items,
        generatedOn: todayInDubai(),
        beforeFeeLabel: input.beforeFeeLabel ?? true,
        truncated: cheques.truncated || expenses.truncated,
        monthly: input.monthly,
      },
      fontSrc,
    );
  await sharePeriodStatementHtml(html, formatPeriod(input.period, input.lang));
}

/**
 * The yearly statement: the summary of the calendar year (its twelve monthly buckets feed the
 * month table), then the same cheques, expenses and cases as any period statement.
 */
export async function shareYearStatement(input: {
  ownerName: string;
  lang: Lang;
  year: number;
  beforeFeeLabel?: boolean;
}): Promise<void> {
  const period = yearPeriod(input.year);
  const query: PeriodQuery = { from: period.from, to: period.to };
  const summary = await request<Summary>(`/api/owner/summary${qs(query)}`);
  await shareStatementForPeriod({
    ownerName: input.ownerName,
    lang: input.lang,
    period,
    query,
    summary,
    beforeFeeLabel: input.beforeFeeLabel ?? true,
    monthly: true,
  });
}
