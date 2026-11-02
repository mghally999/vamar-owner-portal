import { describe, expect, it } from 'vitest';
import { notificationCopy } from './i18n/notifications.js';
import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_KEYS,
  ownerVisibleSettings,
  parseAppSettings,
} from './settings.js';

describe('app settings', () => {
  it('starts from the defaults and accepts only well-typed values', () => {
    expect(parseAppSettings([])).toEqual(APP_SETTING_DEFAULTS);
    const s = parseAppSettings([
      { key: 'week_start', value: 'sunday' },
      { key: 'hijri_display', value: true },
      { key: 'show_before_fee_label', value: false },
      { key: 'large_expense_alert_fils', value: 1_000_000 },
      { key: 'owners_see_invoice_files', value: false },
      { key: 'unknown', value: 1 },
    ]);
    expect(s).toEqual({
      weekStart: 'sunday',
      hijriDisplay: true,
      showBeforeFeeLabel: false,
      largeExpenseAlertFils: 1_000_000,
      ownersSeeInvoiceFiles: false,
    });
    const bad = parseAppSettings([
      { key: 'week_start', value: 'tuesday' },
      { key: 'hijri_display', value: 'yes' },
      { key: 'show_before_fee_label', value: 1 },
      { key: 'large_expense_alert_fils', value: -5 },
      { key: 'large_expense_alert_fils', value: 1.5 },
      { key: 'owners_see_invoice_files', value: null },
    ]);
    expect(bad).toEqual(APP_SETTING_DEFAULTS);
    expect(Object.values(APP_SETTING_KEYS)).toHaveLength(5);
  });
  it('owners get the display settings only', () => {
    expect(Object.keys(ownerVisibleSettings(APP_SETTING_DEFAULTS))).toEqual([
      'weekStart',
      'hijriDisplay',
      'showBeforeFeeLabel',
      'ownersSeeInvoiceFiles',
    ]);
  });
});

describe('v2 notification copy', () => {
  it('monthly summary, hearing, work order and large expense in both languages', () => {
    const month = notificationCopy(
      {
        type: 'monthly_summary',
        month: '2026-10-01',
        collectedFils: 4_500_000,
        expensesFils: 1_200_000,
        netFils: 3_300_000,
      },
      'en',
    );
    expect(month.title).toBe('October 2026 summary');
    expect(month.body).toContain('AED 45,000');
    expect(month.body).toContain('AED 12,000');
    expect(month.body).toContain('AED 33,000');
    expect(
      notificationCopy(
        {
          type: 'monthly_summary',
          month: '2026-10-01',
          collectedFils: 0,
          expensesFils: 0,
          netFils: 0,
        },
        'ar',
      ).title,
    ).toBe('ملخص أكتوبر 2026');

    const hearing = notificationCopy(
      {
        type: 'hearing_soon',
        caseNo: 'D-2026-0001',
        chequeNos: ['100200', '100201'],
        hearingDate: '2026-11-05',
        unitLabel: 'Al Noor Tower 801',
      },
      'en',
    );
    expect(hearing.body).toBe(
      'Case D-2026-0001 (cheque 100200, 100201) for Al Noor Tower 801: hearing on 5 Nov 2026.',
    );
    expect(
      notificationCopy(
        {
          type: 'hearing_soon',
          caseNo: 'D-1',
          chequeNos: [],
          hearingDate: '2026-11-05',
          unitLabel: 'x',
        },
        'ar',
      ).body,
    ).toBe('القضية D-1 للوحدة x: الجلسة بتاريخ 5 نوفمبر 2026.');

    expect(
      notificationCopy(
        { type: 'work_order_done', title: 'AC repair', unitLabel: 'Al Safa 101', costFils: 85_000 },
        'en',
      ).body,
    ).toBe('AC repair at Al Safa 101 is done at a cost of AED 850.');
    expect(
      notificationCopy(
        { type: 'work_order_done', title: 'إصلاح', unitLabel: 'الصفا 101', costFils: null },
        'ar',
      ).body,
    ).toBe('إصلاح في الصفا 101 تم إنجازها.');

    const large = notificationCopy(
      {
        type: 'large_expense',
        reason: 'Lift repair',
        totalFils: 1_050_000,
        placeLabel: 'Al Noor Tower',
      },
      'en',
    );
    expect(large.title).toBe('Large expense recorded');
    expect(large.body).toContain('AED 10,500');
    expect(
      notificationCopy(
        {
          type: 'large_expense',
          reason: 'إصلاح المصعد',
          totalFils: 1_050_000,
          placeLabel: 'برج النور',
        },
        'ar',
      ).body,
    ).toContain('10,500 درهم');
  });
});
