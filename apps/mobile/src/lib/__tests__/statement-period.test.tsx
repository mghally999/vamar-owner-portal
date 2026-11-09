import type { PlainDate } from '@vamar/shared';
import {
  disputeInPeriod,
  fetchAllPages,
  periodStatementHtml,
  shareStatementForPeriod,
  STATEMENT_MAX_PAGES,
} from '@/lib/statement-period';
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
});
