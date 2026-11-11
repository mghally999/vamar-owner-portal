import type { StaffToday } from '@/pages/today-panel';

/** GET /api/staff/today as the API answers it for 7 Oct 2026. */
export function staffToday(o: Partial<StaffToday> = {}): StaffToday {
  return {
    today: '2026-10-07',
    dueToday: { count: 9, amountFils: 15_524_800 },
    dueSoon: { count: 3, amountFils: 4_500_000, from: '2026-10-08', to: '2026-10-10' },
    bouncedNoCase: {
      count: 2,
      amountFils: 23_700_000,
      oldestDueDate: '2026-07-07',
      newestDueDate: '2026-09-07',
    },
    hearings: { count: 1, from: '2026-10-07', to: '2026-10-14', next: '2026-10-14' },
    overdueWorkOrders: { count: 1, oldestScheduledFor: '2026-10-02' },
    expenseDrafts: {
      count: 0,
      totalFils: 0,
      oldestInvoiceDate: null,
      newestInvoiceDate: null,
    },
    contractsEnding: { count: 1, from: '2026-10-07', to: '2026-11-06' },
    ownerApprovals: { workOrders: 1, expenses: 0, rejected: 0, silentLast7Days: 0 },
    budgets: { year: 2026, near: 1, over: 0 },
    ownerMessages: { waiting: 1, oldestAt: '2026-10-06T14:20:00.000Z' },
    ...o,
  };
}

/** Every figure at zero: nothing needs action. */
export function staffTodayClear(): StaffToday {
  return staffToday({
    dueToday: { count: 0, amountFils: 0 },
    dueSoon: { count: 0, amountFils: 0, from: '2026-10-08', to: '2026-10-10' },
    bouncedNoCase: { count: 0, amountFils: 0, oldestDueDate: null, newestDueDate: null },
    hearings: { count: 0, from: '2026-10-07', to: '2026-10-14', next: null },
    overdueWorkOrders: { count: 0, oldestScheduledFor: null },
    contractsEnding: { count: 0, from: '2026-10-07', to: '2026-11-06' },
    ownerApprovals: { workOrders: 0, expenses: 0, rejected: 0, silentLast7Days: 0 },
    budgets: { year: 2026, near: 0, over: 0 },
    ownerMessages: { waiting: 0, oldestAt: null },
  });
}
