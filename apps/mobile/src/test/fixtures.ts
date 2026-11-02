/** API payloads shaped like the owner endpoints return them. */
import type {
  BuildingItem,
  CalendarItem,
  ChequeDetail,
  ExpenseDetail,
  ExpenseItem,
  Summary,
  TimelineEntry,
  WorkOrderDetail,
  WorkOrderItem,
  ChequeItem,
  DeviceItem,
  DisputeDetail,
  DisputeItem,
  Home,
  OwnerProfile,
  UnitDetail,
  UnitItem,
} from '@/lib/types';

export const owner: Pick<OwnerProfile, 'id' | 'nameAr' | 'nameEn' | 'preferredLang'> = {
  id: 'owner-1',
  nameAr: 'سالم الكعبي',
  nameEn: 'Salem Al Kaabi',
  preferredLang: 'en',
};

export function cheque(over: Partial<ChequeItem> = {}): ChequeItem {
  return {
    id: 'chq-1',
    seq: 1,
    dueDate: '2026-10-05',
    grossAmountFils: 2_500_000,
    amountFils: 2_500_000,
    shareBp: 10_000,
    shared: false,
    chequeNo: '000123',
    bankName: 'Emirates NBD',
    status: 'upcoming',
    statusChangedAt: '2026-09-01T08:00:00Z',
    bounceReason: null,
    hasImage: false,
    unitId: 'unit-1',
    unitNo: '1204',
    buildingId: 'bld-1',
    buildingNameAr: 'برج الواحة',
    buildingNameEn: 'Oasis Tower',
    tenantName: 'Ahmed Rahman',
    contractId: 'ctr-1',
    ...over,
  };
}

export function chequeDetail(over: Partial<ChequeDetail> = {}): ChequeDetail {
  return {
    ...cheque(),
    timeline: [
      { id: 'ev-1', fromStatus: null, toStatus: 'upcoming', at: '2026-09-01T08:00:00Z' },
      { id: 'ev-2', fromStatus: 'upcoming', toStatus: 'deposited', at: '2026-10-05T09:00:00Z' },
    ],
    ...over,
  };
}

export function home(over: Partial<Home> = {}): Home {
  return {
    month: '2026-10',
    expectedFils: 7_500_000,
    clearedFils: 2_500_000,
    pendingFils: 4_000_000,
    bouncedCount: 1,
    bouncedFils: 1_000_000,
    nextCheque: {
      id: 'chq-9',
      dueDate: '2026-10-28',
      amountFils: 3_000_000,
      unitNo: '1204',
      buildingNameAr: 'برج الواحة',
      buildingNameEn: 'Oasis Tower',
      tenantName: 'Ahmed Rahman',
      status: 'upcoming',
    },
    nextMonthFils: 1_800_000,
    occupancy: { occupied: 3, total: 4, pct: 75 },
    vacantUnits: [
      {
        unitId: 'unit-7',
        unitNo: '702',
        buildingNameAr: 'برج الواحة',
        buildingNameEn: 'Oasis Tower',
        vacantSince: '2026-08-01',
      },
      {
        unitId: 'unit-8',
        unitNo: 'G01',
        buildingNameAr: 'فيلا الندى',
        buildingNameEn: 'Al Nada Villa',
        vacantSince: null,
      },
    ],
    openDisputes: 2,
    ...over,
  };
}

export function building(over: Partial<BuildingItem> = {}): BuildingItem {
  return {
    id: 'bld-1',
    nameAr: 'برج الواحة',
    nameEn: 'Oasis Tower',
    area: 'Dubai Marina',
    unitCount: 3,
    occupiedCount: 2,
    ...over,
  };
}

export function unit(over: Partial<UnitItem> = {}): UnitItem {
  return {
    id: 'unit-1',
    unitNo: '1204',
    type: 'apartment',
    bedrooms: 2,
    sizeSqft: 1200,
    shareBp: 10_000,
    buildingId: 'bld-1',
    buildingNameAr: 'برج الواحة',
    buildingNameEn: 'Oasis Tower',
    contractId: 'ctr-1',
    tenantName: 'Ahmed Rahman',
    contractEndDate: '2027-03-31',
    annualRentFils: 12_000_000,
    vacantSince: null,
    occupied: true,
    ...over,
  };
}

export function unitDetail(over: Partial<UnitDetail> = {}): UnitDetail {
  return {
    ...unit(),
    contracts: [
      {
        id: 'ctr-1',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        annualRentFils: 12_000_000,
        chequeCount: 4,
        status: 'active',
        tenantName: 'Ahmed Rahman',
      },
      {
        id: 'ctr-0',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        annualRentFils: 11_000_000,
        chequeCount: 4,
        status: 'expired',
        tenantName: 'Old Tenant LLC',
      },
    ],
    cheques: [
      cheque(),
      cheque({ id: 'chq-2', dueDate: '2027-01-05', chequeNo: null, bankName: null }),
    ],
    ...over,
  };
}

export function dispute(over: Partial<DisputeItem> = {}): DisputeItem {
  return {
    id: 'dsp-1',
    caseNo: 'RDC-2026-0042',
    type: 'rent_arrears',
    status: 'hearing_scheduled',
    amountClaimedFils: 4_500_000,
    nextHearingDate: '2026-11-12',
    openedAt: '2026-07-01T10:00:00Z',
    closedAt: null,
    unitId: 'unit-1',
    unitNo: '1204',
    buildingNameAr: 'برج الواحة',
    buildingNameEn: 'Oasis Tower',
    tenantName: 'Ahmed Rahman',
    chequeNos: [],
    ...over,
  };
}

export function disputeDetail(over: Partial<DisputeDetail> = {}): DisputeDetail {
  return {
    ...dispute(),
    updates: [
      {
        id: 'up-1',
        note: 'Case filed with the Rental Dispute Centre.',
        at: '2026-07-02T10:00:00Z',
      },
      { id: 'up-2', note: 'First hearing set for 12 November.', at: '2026-10-01T10:00:00Z' },
    ],
    cheques: [],
    ...over,
  };
}

export function deviceItem(over: Partial<DeviceItem> = {}): DeviceItem {
  return {
    id: 'dev-1',
    deviceId: 'android-id-0001',
    platform: 'android',
    model: 'Pixel 8',
    firstSeen: '2026-09-01T10:00:00Z',
    lastSeen: '2026-10-20T10:00:00Z',
    revokedAt: null,
    current: true,
    ...over,
  };
}

// v2 -------------------------------------------------------------------------------------------

export function summary(over: Partial<Summary> = {}): Summary {
  return {
    preset: 'this_month',
    period: { from: '2026-10-01', to: '2026-10-31' },
    comparison: null,
    isFuture: false,
    rent: {
      expectedFils: 7_500_000,
      collectedFils: 2_500_000,
      outstandingFils: 4_000_000,
      atRiskFils: 1_000_000,
      chequeCount: 3,
      bouncedCount: 1,
    },
    expenses: {
      fixedFils: 600_000,
      variableFils: 150_000,
      totalFils: 750_000,
      count: 4,
      projectedFixedFils: 0,
    },
    netFils: 1_750_000,
    projectedNetFils: 6_900_000,
    previous: null,
    buckets: [
      {
        key: '2026-10',
        expectedFils: 7_500_000,
        collectedFils: 2_500_000,
        outstandingFils: 4_000_000,
        atRiskFils: 1_000_000,
        chequeCount: 3,
        bouncedCount: 1,
        fixedFils: 600_000,
        variableFils: 150_000,
        totalFils: 750_000,
        count: 4,
        projectedFixedFils: 0,
        netFils: 1_750_000,
      },
    ],
    nextCheque: home().nextCheque,
    contractsEnding: [
      {
        id: 'ctr-2',
        unitId: 'unit-3',
        unitNo: '305',
        buildingNameAr: 'برج الواحة',
        buildingNameEn: 'Oasis Tower',
        tenantName: 'Lina Haddad',
        endDate: '2026-12-15',
      },
    ],
    openWorkOrders: 2,
    openDisputes: 2,
    occupancy: { occupied: 3, total: 4, pct: 75 },
    ...over,
  };
}

export function expense(over: Partial<ExpenseItem> = {}): ExpenseItem {
  return {
    id: 'exp-1',
    scope: 'building',
    buildingId: 'bld-1',
    buildingNameAr: 'برج الواحة',
    buildingNameEn: 'Oasis Tower',
    unitId: null,
    unitNo: null,
    unitIds: ['unit-1'],
    categoryId: 'cat-lift',
    categoryNameAr: 'إصلاح المصاعد',
    categoryNameEn: 'Lifts (repairs)',
    kind: 'variable',
    vendorName: 'Gulf Lifts Technical Services',
    reasonAr: 'إصلاح المصعد رقم 2',
    reasonEn: 'Lift 2 repair',
    invoiceNo: 'GL-2026-0417',
    invoiceDate: '2026-10-12',
    coversFrom: null,
    coversTo: null,
    grossAmountFils: 1_240_000,
    grossVatFils: 62_000,
    grossTotalFils: 1_302_000,
    amountFils: 1_302_000,
    shared: false,
    paidOn: '2026-10-19',
    hasAttachments: true,
    ...over,
  };
}

export function expenseDetail(over: Partial<ExpenseDetail> = {}): ExpenseDetail {
  const { hasAttachments: _h, ...base } = expense();
  return {
    ...base,
    paymentMethod: 'transfer',
    allocationMethod: 'by_area',
    disputeId: null,
    disputeCaseNo: null,
    attachments: [
      {
        id: 'att-1',
        fileName: 'invoice-GL-2026-0417.jpg',
        mime: 'image/jpeg',
        sizeBytes: 14_000,
        createdAt: '2026-10-12T08:00:00Z',
      },
    ],
    workOrder: {
      id: 'wo-1',
      titleAr: 'توقف المصعد رقم 2',
      titleEn: 'Lift 2 out of service',
      status: 'done',
      completedAt: '2026-10-12T08:00:00Z',
    },
    ...over,
  };
}

export function workOrder(over: Partial<WorkOrderItem> = {}): WorkOrderItem {
  return {
    id: 'wo-1',
    buildingId: 'bld-1',
    buildingNameAr: 'برج الواحة',
    buildingNameEn: 'Oasis Tower',
    unitId: 'unit-1',
    unitNo: '1204',
    titleAr: 'عطل في التكييف',
    titleEn: 'AC not cooling',
    description: 'Compressor replaced.',
    priority: 'urgent',
    status: 'done',
    reportedOn: '2026-10-01',
    scheduledFor: '2026-10-02',
    completedAt: '2026-10-03T09:00:00Z',
    vendorName: 'Cool Breeze AC Services',
    expenseId: 'exp-1',
    photoCount: 2,
    ...over,
  };
}

export function workOrderDetail(over: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    ...workOrder(),
    expenseTotalFils: 330_750,
    attachments: [
      {
        id: 'ph-1',
        fileName: 'ac-before.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1,
        createdAt: '2026-10-02T08:00:00Z',
      },
      {
        id: 'ph-2',
        fileName: 'ac-after.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1,
        createdAt: '2026-10-03T08:00:00Z',
      },
    ],
    ...over,
  };
}

export function timelineEntry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    kind: 'cheque',
    id: 'cheque:ev-9',
    at: '2026-10-05T05:00:00.000Z',
    date: '2026-10-05',
    titleAr: 'cheque_cleared',
    titleEn: '000123',
    detailAr: '',
    detailEn: '',
    entityType: 'cheque',
    entityId: 'chq-1',
    amountFils: 2_500_000,
    status: 'cleared',
    ...over,
  };
}

export function calendarItem(over: Partial<CalendarItem> = {}): CalendarItem {
  return {
    kind: 'cheque_due',
    id: 'cheque:chq-1',
    date: '2026-10-05',
    endDate: '2026-10-05',
    titleAr: 'شيك 000123 · برج الواحة 1204',
    titleEn: 'Cheque 000123 · Oasis Tower 1204',
    entityType: 'cheque',
    entityId: 'chq-1',
    amountFils: 2_500_000,
    status: 'upcoming',
    unitId: 'unit-1',
    buildingId: 'bld-1',
    allDay: true,
    ...over,
  };
}
