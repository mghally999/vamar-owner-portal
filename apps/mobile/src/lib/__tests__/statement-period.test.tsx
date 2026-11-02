import type { PlainDate } from '@vamar/shared';
import { periodStatementHtml, shareStatementForPeriod } from '@/lib/statement-period';
import { mockApi, sent } from '@/test/api';
import { cheque, expense, summary } from '@/test/fixtures';
import { sharing } from '@/test/native';

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

  it('loads the cheques and expenses of the period and shares the PDF', async () => {
    mockApi({
      'GET /api/owner/cheques': { body: { items: [cheque()], nextCursor: null } },
      'GET /api/owner/expenses': { body: { items: [expense()], nextCursor: null } },
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
});
