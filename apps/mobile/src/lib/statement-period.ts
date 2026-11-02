/**
 * The period statement: rent (expected, collected, bounced), expenses (fixed and variable with
 * reason and invoice number) and net for the period the owner chose on Home. Data comes from
 * the summary already on screen plus the cheques and expenses of the period.
 */
import {
  formatAmount,
  formatDate,
  formatPeriod,
  NET_BEFORE_FEE_LABEL,
  todayInDubai,
  type Lang,
  type Period,
  type PlainDate,
} from '@vamar/shared';
import { CHEQUE_STATUS_LABEL } from '@vamar/shared';
import { qs, request } from './api';
import type { PeriodQuery } from './period';
import { sharePeriodStatementHtml } from './statement';
import type { ChequeItem, ExpenseItem, Page, Summary } from './types';

export interface PeriodStatementInput {
  ownerName: string;
  lang: Lang;
  period: Period;
  summary: Summary;
  cheques: ChequeItem[];
  expenses: ExpenseItem[];
  generatedOn: PlainDate;
  beforeFeeLabel: boolean;
}

export function periodStatementHtml(input: PeriodStatementInput, fontSrc: string): string {
  const { lang, summary } = input;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const t = (ar: string, en: string) => (lang === 'ar' ? ar : en);
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
        <td>${lang === 'ar' ? e.categoryNameAr : e.categoryNameEn} · ${e.kind === 'fixed' ? t('ثابت', 'Fixed') : t('متغير', 'Variable')}</td>
        <td>${lang === 'ar' ? e.reasonAr : e.reasonEn}</td>
        <td>${lang === 'ar' ? e.buildingNameAr : e.buildingNameEn}${e.unitNo ? ` ${e.unitNo}` : ''}</td>
        <td class="n">${e.invoiceNo ?? '—'}</td>
        <td class="n amt">${amt(e.amountFils)}</td>
      </tr>`,
    )
    .join('');
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
.n{font-variant-numeric:tabular-nums}
.amt{white-space:nowrap}
.foot{margin-top:24px;font-size:10px;color:#5e676c}
</style></head><body>
<h1>${t('كشف حساب', 'Statement')}</h1>
<div class="muted">${input.ownerName} · ${formatPeriod(input.period, lang)}</div>
<div class="tiles">
<div class="tile"><div class="muted">${t('الإيجار المتوقع', 'Expected rent')}</div><div class="v">${amt(summary.rent.expectedFils)}</div></div>
<div class="tile"><div class="muted">${t('المحصّل', 'Collected')}</div><div class="v">${amt(summary.rent.collectedFils)}</div></div>
<div class="tile"><div class="muted">${t('مرتجع', 'Bounced')}</div><div class="v">${amt(summary.rent.atRiskFils)}</div></div>
<div class="tile"><div class="muted">${t('مصروفات ثابتة', 'Fixed expenses')}</div><div class="v">${amt(summary.expenses.fixedFils)}</div></div>
<div class="tile"><div class="muted">${t('مصروفات متغيرة', 'Variable expenses')}</div><div class="v">${amt(summary.expenses.variableFils)}</div></div>
<div class="tile"><div class="muted">${summary.isFuture ? t('الصافي المتوقع', 'Projected net') : t('الصافي', 'Net')}${input.beforeFeeLabel ? ` · ${NET_BEFORE_FEE_LABEL[lang]}` : ''}</div><div class="v">${amt(net)}</div></div>
</div>
<h2>${t('الإيجار', 'Rent')}</h2>
<table><thead><tr>
<th>${t('التاريخ', 'Date')}</th><th>${t('الوحدة', 'Unit')}</th><th>${t('المستأجر', 'Tenant')}</th><th>${t('رقم الشيك', 'Cheque no.')}</th><th>${t('المبلغ', 'Amount')}</th><th>${t('الحالة', 'Status')}</th>
</tr></thead><tbody>${chequeRows || `<tr><td colspan="6" class="muted">${t('لا توجد شيكات في هذه الفترة.', 'No cheques in this period.')}</td></tr>`}</tbody></table>
<h2>${t('المصروفات', 'Expenses')}</h2>
<table><thead><tr>
<th>${t('التاريخ', 'Date')}</th><th>${t('التصنيف', 'Category')}</th><th>${t('السبب', 'Reason')}</th><th>${t('العقار', 'Property')}</th><th>${t('رقم الفاتورة', 'Invoice no.')}</th><th>${t('حصتك', 'Your share')}</th>
</tr></thead><tbody>${expenseRows || `<tr><td colspan="6" class="muted">${t('لا توجد مصروفات في هذه الفترة.', 'No expenses in this period.')}</td></tr>`}</tbody></table>
<div class="foot">${t('صادر من بوابة ملاك فامار بتاريخ', 'Generated by the Vamar owner portal on')} ${formatDate(input.generatedOn, lang)}. ${t('المبالغ تمثل حصة المالك من الإيجار الإجمالي ومن كل مصروف.', 'Amounts are the owner’s share of the gross rent and of each expense.')}</div>
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
}): Promise<void> {
  const [cheques, expenses] = await Promise.all([
    request<Page<ChequeItem>>(
      `/api/owner/cheques${qs({ from: input.period.from, to: input.period.to, limit: 100 })}`,
    ),
    request<Page<ExpenseItem>>(`/api/owner/expenses${qs({ ...input.query, limit: 100 })}`),
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
        generatedOn: todayInDubai(),
        beforeFeeLabel: input.beforeFeeLabel ?? true,
      },
      fontSrc,
    );
  await sharePeriodStatementHtml(html, formatPeriod(input.period, input.lang));
}
