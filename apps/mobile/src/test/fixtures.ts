/** API payloads shaped like the owner endpoints return them. */
import type {
  BuildingItem,
  ChequeDetail,
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
