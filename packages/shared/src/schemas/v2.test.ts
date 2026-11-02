import { describe, expect, it } from 'vitest';
import {
  allocationPreviewSchema,
  buildingIdentifiersSchema,
  calendarRangeQuerySchema,
  createCalendarEventSchema,
  createExpenseSchema,
  createRecurringRuleSchema,
  createVendorSchema,
  createWorkOrderSchema,
  expenseListQuerySchema,
  holidaySchema,
  periodQuerySchema,
  reportQuerySchema,
  setDisputeChequesSchema,
  setUnitStatusSchema,
  timelineQuerySchema,
  unitIdentifiersSchema,
  updateExpenseSchema,
  updateSettingsSchema,
} from './v2.js';

const uuid = '019a0000-0000-7000-8000-000000000001';

const expense = {
  scope: 'building',
  buildingId: uuid,
  categoryId: uuid,
  reasonAr: 'رواتب أكتوبر',
  reasonEn: 'October salaries',
  invoiceDate: '2026-10-25',
  amountFils: 1_200_000,
};

describe('period queries', () => {
  it('accepts a preset, a from/to pair, or nothing', () => {
    expect(periodQuerySchema.parse({ preset: 'this_year' })).toEqual({ preset: 'this_year' });
    expect(periodQuerySchema.parse({ from: '2026-01-01', to: '2026-01-31' })).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(periodQuerySchema.parse({})).toEqual({});
    expect(periodQuerySchema.safeParse({ from: '2026-01-01' }).success).toBe(false);
    expect(periodQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-31' }).success).toBe(
      false,
    );
    expect(periodQuerySchema.safeParse({ from: '2020-01-01', to: '2026-01-31' }).success).toBe(
      false,
    );
    expect(periodQuerySchema.safeParse({ preset: 'yesterday' }).success).toBe(false);
    expect(periodQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(
      false,
    );
  });
  it('report filters carry a compare flag', () => {
    expect(reportQuerySchema.parse({ preset: 'last_month', compare: '1' })).toMatchObject({
      compare: true,
    });
    expect(reportQuerySchema.parse({ preset: 'last_month' })).toMatchObject({ compare: false });
    expect(reportQuerySchema.parse({ kind: 'fixed', buildingId: uuid })).toMatchObject({
      kind: 'fixed',
      buildingId: uuid,
    });
    expect(
      expenseListQuerySchema.parse({
        status: 'draft',
        limit: '10',
        from: '2026-01-01',
        to: '2026-01-31',
      }),
    ).toMatchObject({ status: 'draft', limit: 10, from: '2026-01-01' });
  });
});

describe('expenses', () => {
  it('fills the defaults and applies the scope rules', () => {
    const e = createExpenseSchema.parse(expense);
    expect(e).toMatchObject({
      unitId: null,
      vendorId: null,
      invoiceNo: null,
      vatFils: 0,
      paidOn: null,
      paymentMethod: null,
      visibleToOwner: true,
      disputeId: null,
    });
    expect(createExpenseSchema.safeParse({ ...expense, scope: 'unit' }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...expense, scope: 'unit', unitId: uuid }).success).toBe(
      true,
    );
    expect(
      createExpenseSchema.safeParse({ ...expense, allocationMethod: 'single_unit' }).success,
    ).toBe(false);
    expect(
      createExpenseSchema.safeParse({
        ...expense,
        scope: 'unit',
        unitId: uuid,
        allocationMethod: 'by_area',
      }).success,
    ).toBe(false);
    expect(
      createExpenseSchema.safeParse({
        ...expense,
        coversFrom: '2026-10-01',
        coversTo: '2026-09-30',
      }).success,
    ).toBe(false);
    expect(createExpenseSchema.safeParse({ ...expense, amountFils: 0 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...expense, vatFils: -1 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...expense, reasonAr: '' }).success).toBe(false);
    expect(updateExpenseSchema.parse({ amountFils: 5 })).toEqual({ amountFils: 5 });
    expect(updateExpenseSchema.safeParse({ scope: 'unit', unitId: null }).success).toBe(false);
  });
  it('previews need the same inputs as the allocation', () => {
    expect(
      allocationPreviewSchema.parse({
        scope: 'building',
        buildingId: uuid,
        invoiceDate: '2026-10-25',
        totalFils: 100,
      }),
    ).toMatchObject({ unitId: null });
  });
  it('recurring rules carry a frequency and a day of month', () => {
    const rule = createRecurringRuleSchema.parse({
      ...expense,
      frequency: 'monthly',
      dayOfMonth: 25,
      startDate: '2026-01-01',
    });
    expect(rule).toMatchObject({ endDate: null, active: true, vatFils: 0 });
    expect(
      createRecurringRuleSchema.safeParse({
        ...expense,
        frequency: 'monthly',
        dayOfMonth: 32,
        startDate: '2026-01-01',
      }).success,
    ).toBe(false);
    expect(
      createRecurringRuleSchema.safeParse({
        ...expense,
        frequency: 'monthly',
        dayOfMonth: 1,
        startDate: '2026-01-01',
        endDate: '2025-12-31',
      }).success,
    ).toBe(false);
  });
  it('vendors need a 15-digit TRN when they have one', () => {
    expect(createVendorSchema.parse({ name: 'Cool Air LLC' })).toMatchObject({ trn: null });
    expect(createVendorSchema.safeParse({ name: 'x', trn: '100123456700003' }).success).toBe(true);
    expect(createVendorSchema.safeParse({ name: 'x', trn: '1234' }).success).toBe(false);
  });
});

describe('work orders, records, calendar, settings, disputes', () => {
  it('work orders default to open and normal', () => {
    expect(
      createWorkOrderSchema.parse({ buildingId: uuid, titleAr: 'عطل', titleEn: 'Fault' }),
    ).toMatchObject({
      status: 'open',
      priority: 'normal',
      unitId: null,
      visibleToOwner: true,
    });
  });
  it('identifiers are validated where they have a known shape', () => {
    expect(unitIdentifiersSchema.parse({ makaniNo: '1234567890', titleDeedNo: 'TD-1' })).toEqual({
      makaniNo: '1234567890',
      titleDeedNo: 'TD-1',
    });
    expect(unitIdentifiersSchema.safeParse({ makaniNo: '12345' }).success).toBe(false);
    expect(unitIdentifiersSchema.parse({ makaniNo: null, handoverDate: null })).toEqual({
      makaniNo: null,
      handoverDate: null,
    });
    expect(buildingIdentifiersSchema.safeParse({ completionYear: 1800 }).success).toBe(false);
    expect(buildingIdentifiersSchema.parse({ floorsCount: 12, plotNo: '345-0' })).toEqual({
      floorsCount: 12,
      plotNo: '345-0',
    });
    expect(
      setUnitStatusSchema.safeParse({ status: 'occupied', reason: 'tenant moved in' }).success,
    ).toBe(false);
    expect(setUnitStatusSchema.parse({ status: 'reserved', reason: 'deposit received' })).toEqual({
      status: 'reserved',
      reason: 'deposit received',
    });
    expect(timelineQuerySchema.parse({ kinds: 'cheque,expense' })).toMatchObject({
      kinds: ['cheque', 'expense'],
    });
    expect(timelineQuerySchema.safeParse({ kinds: 'cheque,x' }).success).toBe(false);
  });
  it('calendar events and ranges', () => {
    expect(
      createCalendarEventSchema.parse({
        titleAr: 'معاينة',
        titleEn: 'Inspection',
        startsAt: '2026-11-05T10:00:00+04:00',
        endsAt: '2026-11-05T11:00:00+04:00',
      }),
    ).toMatchObject({ type: 'other', allDay: false, visibleToOwner: false });
    expect(
      createCalendarEventSchema.safeParse({
        titleAr: 'x',
        titleEn: 'x',
        startsAt: '2026-11-05T11:00:00+04:00',
        endsAt: '2026-11-05T10:00:00+04:00',
      }).success,
    ).toBe(false);
    expect(
      calendarRangeQuerySchema.parse({
        from: '2026-01-01',
        to: '2026-12-31',
        kinds: 'cheque_due,holiday',
      }),
    ).toMatchObject({ kinds: ['cheque_due', 'holiday'] });
    expect(
      calendarRangeQuerySchema.safeParse({ from: '2026-01-01', to: '2027-12-31' }).success,
    ).toBe(false);
    expect(
      calendarRangeQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success,
    ).toBe(false);
    expect(
      holidaySchema.parse({ date: '2026-12-02', nameAr: 'اليوم الوطني', nameEn: 'National Day' }),
    ).toMatchObject({ tentative: false });
  });
  it('settings and dispute cheques', () => {
    expect(updateSettingsSchema.parse({ weekStart: 'sunday', largeExpenseAlertFils: 0 })).toEqual({
      weekStart: 'sunday',
      largeExpenseAlertFils: 0,
    });
    expect(updateSettingsSchema.safeParse({ weekStart: 'friday' }).success).toBe(false);
    expect(setDisputeChequesSchema.parse({ chequeIds: [uuid] })).toEqual({ chequeIds: [uuid] });
    expect(setDisputeChequesSchema.safeParse({ chequeIds: ['x'] }).success).toBe(false);
  });
});
