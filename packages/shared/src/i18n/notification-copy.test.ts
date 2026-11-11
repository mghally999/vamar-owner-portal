/**
 * Every push's text in both languages, including the optional parts (a job's cost, a hearing's
 * cheque numbers), so a missing translation or a broken template shows up here and not on a phone.
 */
import { describe, expect, it } from 'vitest';
import type { Lang, PlainDate } from '../dates.js';
import { formatAmount } from '../money.js';
import { notificationCopy, type NotificationParams } from './notifications.js';

const D = (s: string) => s as PlainDate;
const ARABIC = /[؀-ۿ]/;

const cases: NotificationParams[] = [
  {
    type: 'cheque_due_soon',
    amountFils: 2_125_000,
    dueDate: D('2026-11-20'),
    unitLabel: 'Al Noor 801',
  },
  { type: 'cheque_bounced', amountFils: 1_375_000, unitLabel: 'Al Noor 1205' },
  { type: 'contract_ending_60', unitLabel: 'Al Safa 201', endDate: D('2027-01-10') },
  { type: 'contract_ending_30', unitLabel: 'Al Safa 201', endDate: D('2026-12-10') },
  { type: 'new_device_login', deviceLabel: 'Pixel 8' },
  {
    type: 'monthly_summary',
    month: D('2026-10-01'),
    collectedFils: 31_221_090,
    expensesFils: 507_500,
    netFils: 30_713_590,
  },
  {
    type: 'hearing_soon',
    caseNo: 'D-2026-0001',
    chequeNos: ['849342', '849343'],
    hearingDate: D('2026-12-04'),
    unitLabel: 'Al Noor 1205',
  },
  {
    type: 'hearing_soon',
    caseNo: 'D-2026-0002',
    chequeNos: [],
    hearingDate: D('2026-11-18'),
    unitLabel: 'Al Khan 302',
  },
  { type: 'work_order_done', title: 'Lift repair', unitLabel: 'Al Noor', costFils: 1_302_000 },
  { type: 'work_order_done', title: 'Leak check', unitLabel: 'Al Noor 801', costFils: null },
  {
    type: 'large_expense',
    reason: 'Lift 2 repair',
    totalFils: 1_302_000,
    placeLabel: 'Al Noor Tower',
  },
  {
    type: 'repair_approval_needed',
    title: 'Fire inspection',
    placeLabel: 'Al Noor Tower',
    totalFils: 1_850_000,
    shareFils: 925_000,
  },
  { type: 'message_reply', subject: 'Lift repair' },
];

describe('notificationCopy', () => {
  for (const params of cases) {
    for (const lang of ['ar', 'en'] as Lang[]) {
      it(`${params.type} in ${lang}`, () => {
        const copy = notificationCopy(params, lang);
        expect(copy.title.trim()).not.toBe('');
        expect(copy.body.trim()).not.toBe('');
        expect(copy.body).not.toMatch(/undefined|null|NaN|\[object/);
        if (lang === 'ar') expect(copy.title + copy.body).toMatch(ARABIC);
        else expect(copy.title + copy.body).not.toMatch(ARABIC);
      });
    }
  }

  it('names the amounts, the cheques and the cost only when there are some', () => {
    const due = notificationCopy(cases[0]!, 'en');
    expect(due.body).toContain(formatAmount(2_125_000, 'en'));
    const withCheques = notificationCopy(cases[6]!, 'en').body;
    const withoutCheques = notificationCopy(cases[7]!, 'en').body;
    expect(withCheques).toContain('849342');
    expect(withoutCheques).not.toContain('849342');
    const costed = notificationCopy(cases[8]!, 'en').body;
    const free = notificationCopy(cases[9]!, 'en').body;
    expect(costed).toContain(formatAmount(1_302_000, 'en'));
    expect(costed.length).toBeGreaterThan(free.length);
    const approval = notificationCopy(cases[11]!, 'ar').body;
    expect(approval).toContain(formatAmount(1_850_000, 'ar'));
    expect(approval).toContain(formatAmount(925_000, 'ar'));
  });
});
