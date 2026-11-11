/** Realistic rows of the v2 API for the dashboard tests. */
import type { Attachment } from '@/lib/types';
import type {
  AppSettings,
  ExpenseCategory,
  ExpenseDetail,
  ExpenseRow,
  ExpenseTotals,
  Holiday,
  RecurringRule,
  ReportBucket,
  ReportSummary,
  SearchHit,
  Vendor,
  WorkOrderDetail,
  WorkOrderRow,
} from '@/lib/types-v2';

export const settings = (s: Partial<AppSettings> = {}): AppSettings => ({
  weekStart: 'monday',
  hijriDisplay: false,
  showBeforeFeeLabel: true,
  largeExpenseAlertFils: 500_000,
  ownersSeeInvoiceFiles: true,
  repairApprovalThresholdFils: 500_000,
  repairApprovalSilenceDays: 3,
  ...s,
});

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
    id: 'cat-dewa',
    nameAr: 'ديوا',
    nameEn: 'Common-area electricity and water',
    kind: 'fixed',
    parentId: null,
    sort: 10,
    active: true,
  },
  {
    id: 'cat-lift',
    nameAr: 'إصلاح المصاعد',
    nameEn: 'Lifts (repairs)',
    kind: 'variable',
    parentId: null,
    sort: 50,
    active: true,
  },
  {
    id: 'cat-ac',
    nameAr: 'تكييف',
    nameEn: 'Air conditioning',
    kind: 'variable',
    parentId: null,
    sort: 60,
    active: true,
  },
];

export const vendors: Vendor[] = [
  {
    id: 'ven-lifts',
    name: 'Gulf Lifts Technical Services',
    phone: '+97142221133',
    email: null,
    trn: '100456789000003',
    notes: '',
    active: true,
  },
  {
    id: 'ven-clean',
    name: 'Clean & Shine Services',
    phone: null,
    email: null,
    trn: null,
    notes: '',
    active: true,
  },
];

export const holidays: Holiday[] = [
  { date: '2026-12-02', nameAr: 'اليوم الوطني', nameEn: 'National Day', tentative: false },
  { date: '2026-12-03', nameAr: 'اليوم الوطني', nameEn: 'National Day', tentative: false },
];

export function expenseRow(e: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id: 'exp-1',
    scope: 'building',
    buildingId: 'bld-1',
    buildingNameAr: 'برج النور',
    buildingNameEn: 'Al Noor Tower',
    unitId: null,
    unitNo: null,
    categoryId: 'cat-lift',
    categoryNameAr: 'إصلاح المصاعد',
    categoryNameEn: 'Lifts (repairs)',
    kind: 'variable',
    vendorId: 'ven-lifts',
    vendorName: 'Gulf Lifts Technical Services',
    reasonAr: 'إصلاح المصعد رقم 2',
    reasonEn: 'Lift 2 repair',
    invoiceNo: 'GL-2026-0417',
    invoiceDate: '2026-10-12',
    coversFrom: null,
    coversTo: null,
    amountFils: 1_240_000,
    vatFils: 62_000,
    totalFils: 1_302_000,
    paidOn: '2026-10-19',
    paymentMethod: 'transfer',
    status: 'posted',
    allocationMethod: 'by_area',
    visibleToOwner: true,
    recurringRuleId: null,
    disputeId: null,
    correctsExpenseId: null,
    createdAt: '2026-10-12T08:00:00.000Z',
    postedAt: '2026-10-13T08:00:00.000Z',
    approvalState: 'none',
    hasAttachments: true,
    ...e,
  };
}

export const expenseTotals = (t: Partial<ExpenseTotals> = {}): ExpenseTotals => ({
  count: 2,
  amountFils: 1_740_000,
  vatFils: 62_000,
  totalFils: 1_802_000,
  fixedFils: 500_000,
  variableFils: 1_302_000,
  ...t,
});

export const attachment = (a: Partial<Attachment> = {}): Attachment => ({
  id: 'att-inv',
  fileName: 'invoice-GL-2026-0417.jpg',
  mime: 'image/jpeg',
  sizeBytes: 14_360,
  createdAt: '2026-10-12T09:00:00.000Z',
  ...a,
});

export function expenseDetail(e: Partial<ExpenseDetail> = {}): ExpenseDetail {
  return {
    ...expenseRow(),
    voidReason: null,
    voidedAt: null,
    vendorTrn: '100456789000003',
    vendorPhone: '+97142221133',
    disputeCaseNo: null,
    allocations: [
      {
        id: 'al-1',
        unitId: 'unit-801',
        unitNo: '801',
        ownerId: 'own-1',
        nameAr: 'خالد المنصوري',
        nameEn: 'Khalid Al Mansoori',
        amountFils: 651_000,
        onDate: '2026-10-12',
      },
      {
        id: 'al-2',
        unitId: 'unit-802',
        unitNo: '802',
        ownerId: 'own-1',
        nameAr: 'خالد المنصوري',
        nameEn: 'Khalid Al Mansoori',
        amountFils: 651_000,
        onDate: '2026-10-12',
      },
    ],
    attachments: [attachment()],
    workOrder: {
      id: 'wo-1',
      titleAr: 'توقف المصعد',
      titleEn: 'Lift 2 out of service',
      status: 'done',
    },
    correctedBy: null,
    createdByName: 'Mariam Haddad',
    postedByName: 'Omar Saeed',
    voidedByName: null,
    approvals: { source: null, state: 'none', items: [] },
    ...e,
  };
}

export function rule(r: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rule-1',
    scope: 'building',
    buildingId: 'bld-1',
    buildingNameAr: 'برج النور',
    buildingNameEn: 'Al Noor Tower',
    unitId: null,
    unitNo: null,
    categoryId: 'cat-sal',
    categoryNameAr: 'رواتب',
    categoryNameEn: 'Building staff salaries',
    vendorId: null,
    vendorName: null,
    reasonAr: 'رواتب الحارس',
    reasonEn: 'Guard salaries',
    amountFils: 650_000,
    vatFils: 0,
    frequency: 'monthly',
    dayOfMonth: 25,
    startDate: '2025-05-01',
    endDate: null,
    allocationMethod: 'by_area',
    visibleToOwner: true,
    active: true,
    createdAt: '2025-05-01T08:00:00.000Z',
    ...r,
  };
}

export function workOrderRow(w: Partial<WorkOrderRow> = {}): WorkOrderRow {
  return {
    id: 'wo-1',
    buildingId: 'bld-1',
    buildingNameAr: 'برج النور',
    buildingNameEn: 'Al Noor Tower',
    unitId: 'unit-801',
    unitNo: '801',
    titleAr: 'عطل في التكييف',
    titleEn: 'AC not cooling',
    description: 'Compressor failure.',
    priority: 'urgent',
    status: 'in_progress',
    reportedOn: '2026-10-20',
    scheduledFor: '2026-10-22',
    completedAt: null,
    vendorId: 'ven-clean',
    vendorName: 'Clean & Shine Services',
    expenseId: null,
    expenseTotalFils: null,
    expenseStatus: null,
    visibleToOwner: true,
    estimateFils: null,
    approvalState: 'none',
    createdAt: '2026-10-20T08:00:00.000Z',
    photoCount: 0,
    ...w,
  };
}

export function workOrderDetail(w: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    ...workOrderRow(),
    attachments: [],
    approvals: { source: null, state: 'none', items: [] },
    ...w,
  };
}

export function bucket(key: string, b: Partial<ReportBucket> = {}): ReportBucket {
  return {
    key,
    expectedFils: 4_000_000,
    collectedFils: 3_000_000,
    outstandingFils: 800_000,
    atRiskFils: 200_000,
    chequeCount: 6,
    bouncedCount: 1,
    collectionRatePct: 75,
    fixedFils: 500_000,
    variableFils: 300_000,
    totalFils: 800_000,
    vatFils: 20_000,
    count: 4,
    netFils: 2_200_000,
    occupiedUnits: 30,
    totalUnits: 40,
    ...b,
  };
}

export function reportSummary(s: Partial<ReportSummary> = {}): ReportSummary {
  const buckets = [bucket('2026-09'), bucket('2026-10')];
  return {
    preset: 'last_3_months',
    period: { from: '2026-09-01', to: '2026-10-31' },
    comparison: null,
    rent: {
      expectedFils: 8_000_000,
      collectedFils: 6_000_000,
      outstandingFils: 1_600_000,
      atRiskFils: 400_000,
      chequeCount: 12,
      bouncedCount: 2,
      collectionRatePct: 75,
    },
    expenses: {
      fixedFils: 1_000_000,
      variableFils: 600_000,
      totalFils: 1_600_000,
      vatFils: 40_000,
      count: 8,
    },
    netFils: 4_400_000,
    previous: null,
    change: null,
    buckets,
    byCategory: [
      {
        categoryId: 'cat-sal',
        nameAr: 'رواتب',
        nameEn: 'Building staff salaries',
        kind: 'fixed',
        totalFils: 1_000_000,
        count: 4,
      },
      {
        categoryId: 'cat-lift',
        nameAr: 'إصلاح المصاعد',
        nameEn: 'Lifts (repairs)',
        kind: 'variable',
        totalFils: 600_000,
        count: 4,
      },
    ],
    occupancy: { occupiedUnits: 30, totalUnits: 40, pct: 75 },
    ...s,
  };
}

export const searchHits: SearchHit[] = [
  {
    type: 'cheque',
    id: 'chq-9',
    titleAr: 'شيك 000909 · برج النور 801',
    titleEn: 'Cheque 000909 · Al Noor Tower 801',
    detail: '2026-10-05 · bounced',
    parentId: 'con-1',
  },
  {
    type: 'owner',
    id: 'own-1',
    titleAr: 'أحمد المنصوري',
    titleEn: 'Ahmed Al Mansouri',
    detail: '+971501234567',
    parentId: null,
  },
  {
    type: 'unit',
    id: 'unit-801',
    titleAr: 'برج النور 801',
    titleEn: 'Al Noor Tower 801',
    detail: 'TD-1-001',
    parentId: 'bld-1',
  },
];

/** Routes every page needs for its reference data (buildings come from the base fixtures). */
export function v2Routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/expense-categories': { items: categories },
    'GET /api/staff/vendors': { items: vendors },
    'GET /api/staff/holidays': { items: holidays },
    'GET /api/staff/settings': settings(),
    ...extra,
  };
}
