import { formatAmount, type PlainDate } from '@vamar/shared';
import {
  disputeInPeriod,
  fetchAllPages,
  monthRows,
  periodStatementHtml,
  shareStatementForPeriod,
  shareYearStatement,
  STATEMENT_MAX_PAGES,
} from '@/lib/statement-period';
import type { Summary } from '@/lib/types';
import { mockApi, sent, type SentRequest } from '@/test/api';
import { cheque, dispute, expense, summary } from '@/test/fixtures';
import { print, sharing } from '@/test/native';

/** Two pages: the first answers with a cursor, the second (asked with that cursor) ends the list. */
function twoPages<T>(first: T[], second: T[]) {
  return (req: SentRequest) =>
    req.query.get('cursor') === 'page-2'
      ? { body: { items: second, nextCursor: null } }
      : { body: { items: first, nextCursor: 'page-2' } };
}

const printedHtml = () =>
  (print.printToFileAsync as jest.Mock).mock.calls.at(-1)?.[0]?.html as string;

const base = {
  ownerName: 'Salem Al Kaabi',
  period: { from: '2026-10-01' as PlainDate, to: '2026-10-31' as PlainDate },
  summary: summary(),
  cheques: [cheque({ status: 'cleared' }), cheque({ id: 'x', status: 'cancelled' })],
  expenses: [
    expense(),
    expense({
      id: 'e2',
      kind: 'fixed',
      reasonEn: 'October salaries',
      reasonAr: 'رواتب',
      invoiceNo: null,
      amountFils: 260_000,
    }),
  ],
  generatedOn: '2026-11-02' as PlainDate,
  beforeFeeLabel: true,
};

describe('period statement', () => {
  it('lays out rent, expenses with reason and invoice number, and net, in both languages', () => {
    const en = periodStatementHtml({ ...base, lang: 'en' }, 'x');
    expect(en).toContain('Salem Al Kaabi · October 2026');
    expect(en).toContain('AED 75,000'); // expected
    expect(en).toContain('AED 25,000'); // collected
    expect(en).toContain('AED 17,500'); // net
    expect(en).toContain("Net · Before Vamar's management fee");
    expect(en).toContain('<td>Lifts (repairs) · Variable</td>');
    expect(en).toContain('<td>Lift 2 repair</td>');
    expect(en).toContain('<td class="n">GL-2026-0417</td>');
    expect(en).toContain('<td>October salaries</td>');
    // Two header rows, one live cheque (the cancelled one never counts) and two expenses.
    expect(en.match(/<tr>/g)).toHaveLength(5);
    const ar = periodStatementHtml({ ...base, lang: 'ar', beforeFeeLabel: false }, 'x');
    expect(ar).toContain('<html lang="ar" dir="rtl">');
    expect(ar).toContain('كشف حساب');
    expect(ar).toContain('رواتب');
    expect(ar).not.toContain('رسوم إدارة');
    const future = periodStatementHtml(
      { ...base, lang: 'en', summary: summary({ isFuture: true }) },
      'x',
    );
    expect(future).toContain('Projected net');
    const empty = periodStatementHtml({ ...base, lang: 'en', cheques: [], expenses: [] }, 'x');
    expect(empty).toContain('No cheques in this period.');
    expect(empty).toContain('No expenses in this period.');
  });

  it('lists the cases open during the period with their cheque numbers', () => {
    const bounced = dispute({
      id: 'd1',
      caseNo: 'D-2026-0001',
      type: 'bounced_cheque',
      chequeNos: ['700101', '700102'],
    });
    const closedBefore = dispute({
      id: 'd2',
      caseNo: 'D-2025-0009',
      status: 'closed',
      openedAt: '2025-03-01T08:00:00Z',
      closedAt: '2026-08-30T08:00:00Z',
    });
    const openedAfter = dispute({
      id: 'd3',
      caseNo: 'D-2026-0099',
      openedAt: '2026-11-15T08:00:00Z',
    });
    expect(disputeInPeriod(bounced, base.period)).toBe(true);
    expect(disputeInPeriod(closedBefore, base.period)).toBe(false);
    expect(disputeInPeriod(openedAfter, base.period)).toBe(false);
    const en = periodStatementHtml(
      { ...base, lang: 'en', disputes: [bounced, closedBefore, openedAfter] },
      'x',
    );
    expect(en).toContain('<h2>Cases</h2>');
    expect(en).toContain('<td class="n">D-2026-0001</td>');
    expect(en).toContain('<td class="n">700101, 700102</td>');
    expect(en).not.toContain('D-2025-0009');
    expect(en).not.toContain('D-2026-0099');
    const ar = periodStatementHtml({ ...base, lang: 'ar', disputes: [bounced] }, 'x');
    expect(ar).toContain('<h2>القضايا</h2>');
    expect(ar).toContain('<td class="n">700101، 700102</td>');
    expect(periodStatementHtml({ ...base, lang: 'en' }, 'x')).not.toContain('<h2>Cases</h2>');
  });

  it('loads the cheques and expenses of the period and shares the PDF', async () => {
    mockApi({
      'GET /api/owner/cheques': { body: { items: [cheque()], nextCursor: null } },
      'GET /api/owner/expenses': { body: { items: [expense()], nextCursor: null } },
      'GET /api/owner/disputes': { body: { items: [], nextCursor: null } },
    });
    await shareStatementForPeriod({
      ownerName: 'S',
      lang: 'en',
      period: base.period,
      query: { preset: 'this_month' },
      summary: summary(),
    });
    expect(Object.fromEntries(sent('GET /api/owner/expenses')[0]!.query)).toEqual({
      preset: 'this_month',
      limit: '100',
    });
    expect(sharing.shareAsync).toHaveBeenCalledWith(
      'file:///cache/vamar-statement-October-2026.pdf',
      expect.anything(),
    );
  });

  it('follows the cursor so every cheque and expense of a long period is listed', async () => {
    mockApi({
      'GET /api/owner/cheques': twoPages(
        [cheque({ id: 'c1', chequeNo: '700001', status: 'cleared' })],
        [cheque({ id: 'c2', chequeNo: '700002', status: 'upcoming' })],
      ),
      'GET /api/owner/disputes': { body: { items: [], nextCursor: null } },
      'GET /api/owner/expenses': twoPages(
        [expense({ id: 'e1', reasonEn: 'First page repair' })],
        [expense({ id: 'e2', reasonEn: 'Second page repair' })],
      ),
    });
    await shareStatementForPeriod({
      ownerName: 'S',
      lang: 'en',
      period: base.period,
      query: { preset: 'this_year' },
      summary: summary(),
    });
    const cheques = sent('GET /api/owner/cheques');
    expect(cheques).toHaveLength(2);
    expect(cheques[0]!.query.get('from')).toBe('2026-10-01');
    expect(cheques[0]!.query.get('limit')).toBe('100');
    expect(cheques[1]!.query.get('cursor')).toBe('page-2');
    expect(sent('GET /api/owner/expenses')).toHaveLength(2);
    const html = printedHtml();
    expect(html).toContain('700001');
    expect(html).toContain('700002');
    expect(html).toContain('First page repair');
    expect(html).toContain('Second page repair');
    expect(html).not.toContain('too long to list every cheque');
  });

  it('stops at the page cap and says the lists are incomplete, in both languages', async () => {
    let n = 0;
    mockApi({
      'GET /api/owner/cheques': () => {
        n += 1;
        return { body: { items: [cheque({ id: `c${String(n)}` })], nextCursor: `p${String(n)}` } };
      },
    });
    const all = await fetchAllPages('/api/owner/cheques', { from: '2026-01-01', to: '2026-12-31' });
    expect(all.truncated).toBe(true);
    expect(all.items).toHaveLength(STATEMENT_MAX_PAGES);
    expect(sent('GET /api/owner/cheques')).toHaveLength(STATEMENT_MAX_PAGES);

    mockApi({
      'GET /api/owner/expenses': { body: { items: [], nextCursor: null } },
      'GET /api/owner/disputes': { body: { items: [], nextCursor: null } },
    });
    await shareStatementForPeriod({
      ownerName: 'S',
      lang: 'ar',
      period: base.period,
      query: { preset: 'this_year' },
      summary: summary(),
    });
    expect(printedHtml()).toContain('الفترة طويلة جداً');
    const en = periodStatementHtml({ ...base, lang: 'en', truncated: true }, 'x');
    expect(en).toContain('This period is too long to list every cheque and expense below');
  });

  it('says the amounts are the owner’s share and never shows a commission', () => {
    for (const monthly of [false, true]) {
      const en = periodStatementHtml({ ...base, lang: 'en', monthly }, 'x');
      expect(en).toContain('Amounts are the owner’s share of the gross rent and of each expense.');
      expect(en).not.toMatch(/commission/i);
      const ar = periodStatementHtml({ ...base, lang: 'ar', monthly }, 'x');
      expect(ar).toContain('المبالغ تمثل حصة المالك من الإيجار الإجمالي ومن كل مصروف.');
      expect(ar).not.toContain('عمولة');
    }
  });
});

/** A calendar year of buckets with different figures each month, and totals that match them. */
function yearSummary(year: number): Summary {
  const one = summary().buckets[0]!;
  const buckets = Array.from({ length: 12 }, (_, i) => ({
    ...one,
    key: `${String(year)}-${String(i + 1).padStart(2, '0')}`,
    expectedFils: 1_000_000 + i * 10_000,
    collectedFils: 900_000 + i * 10_000,
    fixedFils: 100_000,
    variableFils: i % 3 === 0 ? 55_000 : 0,
    totalFils: 100_000 + (i % 3 === 0 ? 55_000 : 0),
    projectedFixedFils: 0,
    netFils: 800_000 + i * 10_000 - (i % 3 === 0 ? 55_000 : 0),
  }));
  const total = (pick: (b: (typeof buckets)[number]) => number) =>
    buckets.reduce((a, b) => a + pick(b), 0);
  const collected = total((b) => b.collectedFils);
  const fixed = total((b) => b.fixedFils);
  const variable = total((b) => b.variableFils);
  return summary({
    preset: 'custom',
    period: { from: `${String(year)}-01-01`, to: `${String(year)}-12-31` },
    rent: {
      ...summary().rent,
      expectedFils: total((b) => b.expectedFils),
      collectedFils: collected,
    },
    expenses: {
      fixedFils: fixed,
      variableFils: variable,
      totalFils: fixed + variable,
      count: 16,
      projectedFixedFils: 0,
    },
    netFils: collected - fixed - variable,
    buckets,
  });
}

const year2025 = {
  ...base,
  period: { from: '2025-01-01' as PlainDate, to: '2025-12-31' as PlainDate },
  summary: yearSummary(2025),
  monthly: true,
};

/** The amount in a total cell of the month table. */
const totalCell = (html: string, which: 'collected' | 'expenses' | 'net') =>
  new RegExp(`data-total="${which}">([^<]+)<`).exec(html)?.[1];

describe('yearly statement', () => {
  it('has twelve month rows whose totals equal the sum of the months and the year', () => {
    const rows = monthRows(year2025.period, year2025.summary.buckets);
    expect(rows.map((r) => r.key)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`),
    );
    const sum = (pick: (r: (typeof rows)[number]) => number) =>
      rows.reduce((a, r) => a + pick(r), 0);
    expect(sum((r) => r.collectedFils)).toBe(year2025.summary.rent.collectedFils);
    expect(sum((r) => r.expensesFils)).toBe(year2025.summary.expenses.totalFils);
    expect(sum((r) => r.netFils)).toBe(year2025.summary.netFils);
    for (const r of rows) expect(r.netFils).toBe(r.collectedFils - r.expensesFils);

    const en = periodStatementHtml({ ...year2025, lang: 'en' }, 'x');
    expect(en.match(/<tr class="month"/g)).toHaveLength(12);
    expect(en).toContain('<h1>Yearly statement</h1>');
    expect(en).toContain('Salem Al Kaabi · 2025');
    expect(en).toContain('<h2>Month by month</h2>');
    expect(en).toContain('<td>January 2025</td>');
    expect(en).toContain('<td>December 2025</td>');
    expect(en).toContain('Total for the year');
    expect(totalCell(en, 'collected')).toBe(
      formatAmount(
        sum((r) => r.collectedFils),
        'en',
      ),
    );
    expect(totalCell(en, 'expenses')).toBe(
      formatAmount(
        sum((r) => r.expensesFils),
        'en',
      ),
    );
    expect(totalCell(en, 'net')).toBe(formatAmount(year2025.summary.netFils, 'en'));
    // March: collected 9,200, expenses 1,000 fixed only, net 8,200.
    expect(en).toMatch(
      /data-month="2025-03">\s*<td>March 2025<\/td>\s*<td class="n amt">AED 9,200<\/td>\s*<td class="n amt">AED 1,000<\/td>\s*<td class="n amt">AED 8,200<\/td>/,
    );
    // The rest of the period statement is still there: rent, expenses with reason and invoice
    // number, net before the fee.
    expect(en).toContain('<td class="n">GL-2026-0417</td>');
    expect(en).toContain('<td>October salaries</td>');
    expect(en).toContain("Net · Before Vamar's management fee");
    // A period statement has no month table.
    expect(periodStatementHtml({ ...base, lang: 'en' }, 'x')).not.toContain('class="month"');
  });

  it('is in Arabic, right to left, with Western digits', () => {
    const ar = periodStatementHtml({ ...year2025, lang: 'ar' }, 'x');
    expect(ar).toContain('<html lang="ar" dir="rtl">');
    expect(ar).toContain('<h1>كشف الحساب السنوي</h1>');
    expect(ar).toContain('<h2>حسب الشهر</h2>');
    expect(ar).toContain('<td>يناير 2025</td>');
    expect(ar).toContain('إجمالي السنة');
    expect(ar.match(/<tr class="month"/g)).toHaveLength(12);
    expect(totalCell(ar, 'net')).toBe(formatAmount(year2025.summary.netFils, 'ar'));
    expect(ar).not.toMatch(/[٠-٩]/);
  });

  it('keeps twelve rows when the summary leaves months out', () => {
    const sparse = { ...year2025.summary, buckets: year2025.summary.buckets.slice(0, 3) };
    const rows = monthRows(year2025.period, sparse.buckets);
    expect(rows).toHaveLength(12);
    expect(rows[11]).toEqual({ key: '2025-12', collectedFils: 0, expensesFils: 0, netFils: 0 });
  });

  it('loads the year summary, then the year’s cheques and expenses, and shares one PDF', async () => {
    mockApi({
      'GET /api/owner/summary': { body: yearSummary(2025) },
      'GET /api/owner/cheques': { body: { items: [cheque()], nextCursor: null } },
      'GET /api/owner/expenses': { body: { items: [expense()], nextCursor: null } },
      'GET /api/owner/disputes': { body: { items: [], nextCursor: null } },
    });
    await shareYearStatement({ ownerName: 'S', lang: 'en', year: 2025 });
    expect(Object.fromEntries(sent('GET /api/owner/summary')[0]!.query)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
    expect(sent('GET /api/owner/cheques')[0]!.query.get('from')).toBe('2025-01-01');
    expect(sent('GET /api/owner/cheques')[0]!.query.get('to')).toBe('2025-12-31');
    expect(Object.fromEntries(sent('GET /api/owner/expenses')[0]!.query)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
      limit: '100',
    });
    expect(printedHtml().match(/<tr class="month"/g)).toHaveLength(12);
    expect(sharing.shareAsync).toHaveBeenCalledWith(
      'file:///cache/vamar-statement-2025.pdf',
      expect.anything(),
    );
  });
});
