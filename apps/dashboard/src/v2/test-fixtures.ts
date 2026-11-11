/** API rows for the v2 page tests. */
import type { CalendarItem } from '@vamar/shared';
import type {
  ExpenseCategory,
  Holiday,
  Settings,
  TimelineEntry,
  UnitRecord,
  UnitStatusEvent,
  Vendor,
} from './types';

export const settings = (s: Partial<Settings> = {}): Settings => ({
  weekStart: 'monday',
  hijriDisplay: false,
  showBeforeFeeLabel: true,
  largeExpenseAlertFils: 500_000,
  ownersSeeInvoiceFiles: true,
  repairApprovalThresholdFils: 500_000,
  repairApprovalSilenceDays: 3,
  ...s,
});

export const holidays: Holiday[] = [
  { date: '2026-01-01', nameAr: 'رأس السنة الميلادية', nameEn: "New Year's Day", tentative: false },
  { date: '2026-03-20', nameAr: 'عيد الفطر', nameEn: 'Eid Al Fitr', tentative: true },
  { date: '2026-12-02', nameAr: 'اليوم الوطني', nameEn: 'National Day', tentative: false },
];

export const categories: ExpenseCategory[] = [
  {
    id: 'cat-sal',
    nameAr: 'رواتب',
    nameEn: 'Building staff salaries',
    kind: 'fixed',
    parentId: null,
    sort: 0,
    active: true,
  },
  {
    id: 'cat-ins',
    nameAr: 'تأمين',
    nameEn: 'Building insurance',
    kind: 'fixed',
    parentId: null,
    sort: 10,
    active: false,
  },
  {
    id: 'cat-plumb',
    nameAr: 'سباكة',
    nameEn: 'Plumbing',
    kind: 'variable',
    parentId: null,
    sort: 20,
    active: true,
  },
];

export const vendors: Vendor[] = [
  {
    id: 'ven-1',
    name: 'Cool Breeze AC Services',
    phone: '+971501112233',
    email: 'service@coolbreeze.ae',
    trn: '100345678900003',
    notes: '',
    active: true,
  },
  {
    id: 'ven-2',
    name: 'Clean & Shine Services',
    phone: null,
    email: null,
    trn: null,
    notes: 'Pest control',
    active: true,
  },
];

export function unitRecord(u: Partial<UnitRecord> = {}): UnitRecord {
  return {
    id: 'unit-801',
    buildingId: 'bld-1',
    unitNo: '801',
    type: 'apartment',
    bedrooms: 2,
    sizeSqft: 1250,
    active: true,
    status: 'vacant_ready',
    effectiveStatus: 'occupied',
    occupied: true,
    titleDeedNo: 'TD-1-0001',
    plotNo: '346-1180',
    makaniNo: '2735894120',
    dewaPremiseNo: '301000977',
    municipalityNo: '1001-801',
    handoverDate: '2016-06-01',
    building: {
      id: 'bld-1',
      nameAr: 'برج النور',
      nameEn: 'Al Noor Tower',
      area: 'Business Bay',
      plotNo: '346-1180',
      makaniNo: '2735894120',
    },
    owners: [
      {
        ownerId: 'own-1',
        nameAr: 'أحمد المنصوري',
        nameEn: 'Ahmed Al Mansouri',
        shareBp: 10000,
        fromDate: '2022-01-01',
      },
    ],
    contracts: [
      {
        id: 'con-1',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        annualRentFils: 9_500_000,
        chequeCount: 4,
        status: 'active',
        tenantId: 'ten-1',
        tenantName: 'Sara Khan',
      },
    ],
    ...u,
  };
}

export const statusHistory: UnitStatusEvent[] = [
  {
    id: 'use-1',
    fromStatus: 'vacant_ready',
    toStatus: 'under_maintenance',
    reason: 'Repainting before the next tenant',
    at: '2026-10-01T06:00:00.000Z',
    actorName: 'Mariam Haddad',
  },
];

export function timelineEntries(): TimelineEntry[] {
  return [
    {
      kind: 'status',
      id: 'status:use-1',
      at: '2026-10-01T06:00:00.000Z',
      date: '2026-10-01',
      titleAr: 'status',
      titleEn: 'under_maintenance',
      detailAr: 'Repainting',
      detailEn: 'vacant_ready',
      entityType: 'unit',
      entityId: 'unit-801',
      amountFils: null,
      status: 'under_maintenance',
    },
    {
      kind: 'cheque',
      id: 'cheque:chq-1',
      at: '2026-09-15T04:00:00.000Z',
      date: '2026-09-15',
      titleAr: 'cheque_cleared',
      titleEn: '000101',
      detailAr: '',
      detailEn: '',
      entityType: 'cheque',
      entityId: 'chq-1',
      amountFils: 2_375_000,
      status: 'cleared',
    },
    {
      kind: 'expense',
      id: 'expense:exp-1',
      at: '2026-09-10T04:00:00.000Z',
      date: '2026-09-10',
      titleAr: 'expense_variable',
      titleEn: 'AC breakdown',
      detailAr: 'عطل تكييف',
      detailEn: 'CB-2026-1',
      entityType: 'expense',
      entityId: 'exp-1',
      amountFils: 330_750,
      status: 'posted',
    },
    {
      kind: 'contract',
      id: 'contract:con-1',
      at: '2026-01-01T04:00:00.000Z',
      date: '2026-01-01',
      titleAr: 'contract_start',
      titleEn: 'Sara Khan',
      detailAr: '0123456789',
      detailEn: '',
      entityType: 'contract',
      entityId: 'con-1',
      amountFils: 9_500_000,
      status: 'active',
    },
  ];
}

export function calendarItems(): CalendarItem[] {
  return [
    {
      kind: 'cheque_due',
      id: 'cheque:chq-1',
      date: '2026-10-05',
      endDate: '2026-10-05',
      titleAr: 'شيك 000101 · برج النور 801',
      titleEn: 'Cheque 000101 · Al Noor Tower 801',
      entityType: 'cheque',
      entityId: 'chq-1',
      amountFils: 2_375_000,
      status: 'upcoming',
      unitId: 'unit-801',
      buildingId: 'bld-1',
      allDay: true,
    },
    {
      kind: 'hearing',
      id: 'hearing:dsp-1',
      date: '2026-10-21',
      endDate: '2026-10-21',
      titleAr: 'جلسة RDC-2026-0412 (000101)',
      titleEn: 'Hearing RDC-2026-0412 (000101)',
      entityType: 'dispute',
      entityId: 'dsp-1',
      status: 'in_progress',
      unitId: 'unit-801',
      buildingId: 'bld-1',
      allDay: true,
    },
    {
      kind: 'event',
      id: 'event:evt-1',
      date: '2026-10-15',
      endDate: '2026-10-15',
      titleAr: 'معاينة سنوية',
      titleEn: 'Annual inspection',
      entityType: 'calendar_event',
      entityId: 'evt-1',
      status: 'inspection',
      unitId: null,
      buildingId: 'bld-1',
      allDay: false,
      time: '10:00',
    },
    {
      kind: 'holiday',
      id: 'holiday:2026-12-02',
      date: '2026-12-02',
      endDate: '2026-12-02',
      titleAr: 'اليوم الوطني',
      titleEn: 'National Day',
      entityType: 'holiday',
      entityId: '2026-12-02',
      allDay: true,
    },
  ];
}

export const calendarEvent = {
  id: 'evt-1',
  titleAr: 'معاينة سنوية',
  titleEn: 'Annual inspection',
  startsAt: '2026-10-15T06:00:00.000Z',
  endsAt: '2026-10-15T07:30:00.000Z',
  allDay: false,
  type: 'inspection' as const,
  buildingId: 'bld-1',
  unitId: null,
  ownerId: null,
  visibleToOwner: true,
  notes: '',
};
