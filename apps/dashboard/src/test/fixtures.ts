/** Realistic API rows for the dashboard tests. Each builder takes overrides for the case at hand. */
import type { StaffUser } from '@/lib/api';
import type {
  AuditRow,
  BuildingDetail,
  BuildingRow,
  BuildingUnit,
  ChequeDetail,
  ChequeRow,
  ContractDetail,
  ContractRow,
  DisputeDetail,
  DisputeRow,
  OwnerDetail,
  OwnerRow,
  Overview,
  Page,
  StaffRow,
  Tenant,
} from '@/lib/types';

export const page = <T>(items: T[], nextCursor: string | null = null): Page<T> => ({
  items,
  nextCursor,
});

export function staffUser(role: StaffUser['role'] = 'admin'): StaffUser {
  return {
    id: 'staff-me',
    name: role === 'admin' ? 'Mariam Haddad' : 'Omar Saeed',
    email: role === 'admin' ? 'mariam@vamar.ae' : 'omar@vamar.ae',
    role,
  };
}

export function owner(o: Partial<OwnerRow> = {}): OwnerRow {
  return {
    id: 'own-1',
    nameAr: 'أحمد المنصوري',
    nameEn: 'Ahmed Al Mansouri',
    phoneE164: '+971501234567',
    email: 'ahmed@example.ae',
    preferredLang: 'ar',
    status: 'active',
    createdAt: '2026-01-10T08:00:00.000Z',
    unitCount: 2,
    ...o,
  };
}

export function ownerDetail(o: Partial<OwnerDetail> = {}): OwnerDetail {
  const { unitCount: _unitCount, ...base } = owner();
  return {
    ...base,
    holdings: [
      {
        unitId: 'unit-801',
        unitNo: '801',
        type: 'apartment',
        shareBp: 5000,
        fromDate: '2025-06-01',
        buildingId: 'bld-1',
        buildingNameAr: 'برج النور',
        buildingNameEn: 'Al Noor Tower',
      },
    ],
    devices: [
      {
        id: 'dev-1',
        platform: 'ios',
        model: 'iPhone 15',
        firstSeen: '2026-02-01T09:00:00.000Z',
        lastSeen: '2026-10-20T09:00:00.000Z',
        revokedAt: null,
        hasPushToken: true,
      },
    ],
    ...o,
  };
}

export function building(b: Partial<BuildingRow> = {}): BuildingRow {
  return {
    id: 'bld-1',
    nameAr: 'برج النور',
    nameEn: 'Al Noor Tower',
    area: 'Business Bay',
    address: 'Marasi Drive',
    unitCount: 12,
    occupiedCount: 9,
    ...b,
  };
}

export function unit(u: Partial<BuildingUnit> = {}): BuildingUnit {
  return {
    id: 'unit-801',
    buildingId: 'bld-1',
    unitNo: '801',
    type: 'apartment',
    bedrooms: 2,
    sizeSqft: 1250,
    active: true,
    owners: [
      { ownerId: 'own-1', nameAr: 'أحمد المنصوري', nameEn: 'Ahmed Al Mansouri', shareBp: 10000 },
    ],
    occupied: true,
    contract: {
      id: 'con-1',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      annualRentFils: 9_500_000,
      status: 'active',
      tenantName: 'Sara Khan',
    },
    ...u,
  };
}

export function buildingDetail(b: Partial<BuildingDetail> = {}): BuildingDetail {
  return {
    id: 'bld-1',
    nameAr: 'برج النور',
    nameEn: 'Al Noor Tower',
    area: 'Business Bay',
    address: 'Marasi Drive',
    notes: '',
    units: [
      unit(),
      unit({
        id: 'unit-802',
        unitNo: '802',
        owners: [],
        occupied: false,
        contract: null,
        bedrooms: null,
      }),
    ],
    ...b,
  };
}

export function tenant(t: Partial<Tenant> = {}): Tenant {
  return {
    id: 'ten-1',
    name: 'Sara Khan',
    phone: '+971551112222',
    email: null,
    company: null,
    notes: '',
    ...t,
  };
}

export function contractRow(c: Partial<ContractRow> = {}): ContractRow {
  return {
    id: 'con-1',
    unitId: 'unit-801',
    unitNo: '801',
    buildingId: 'bld-1',
    buildingNameAr: 'برج النور',
    buildingNameEn: 'Al Noor Tower',
    tenantId: 'ten-1',
    tenantName: 'Sara Khan',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    annualRentFils: 9_500_000,
    chequeCount: 4,
    status: 'active',
    createdAt: '2025-12-20T10:00:00.000Z',
    ...c,
  };
}

export function contractDetail(c: Partial<ContractDetail> = {}): ContractDetail {
  const cheque = (seq: number, dueDate: string, status: ChequeRow['status']) => ({
    id: `chq-${String(seq)}`,
    contractId: 'con-1',
    seq,
    dueDate,
    amountFils: 2_375_000,
    chequeNo: `00010${String(seq)}`,
    bankName: 'Emirates NBD',
    status,
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    depositedAt: null,
    clearedAt: null,
    bouncedAt: null,
    bounceReason: null,
    replacesChequeId: null,
    imageKey: null,
  });
  return {
    id: 'con-1',
    unitId: 'unit-801',
    tenantId: 'ten-1',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    annualRentFils: 9_500_000,
    chequeCount: 4,
    status: 'active',
    previousContractId: null,
    ejariNo: '0123456789',
    notes: 'Parking bay 14 included.',
    createdAt: '2025-12-20T10:00:00.000Z',
    unit: { id: 'unit-801', unitNo: '801', type: 'apartment', buildingId: 'bld-1' },
    building: { id: 'bld-1', nameAr: 'برج النور', nameEn: 'Al Noor Tower' },
    tenant: tenant(),
    cheques: [
      cheque(1, '2026-01-01', 'cleared'),
      cheque(2, '2026-04-01', 'cleared'),
      cheque(3, '2026-07-01', 'deposited'),
      cheque(4, '2026-10-01', 'upcoming'),
    ],
    gridValidation: {
      totalFils: 9_500_000,
      annualRentFils: 9_500_000,
      differenceFils: 0,
      complete: true,
      matchesRent: true,
      missingSeqs: [],
      duplicateChequeNos: [],
    },
    ...c,
  };
}

export function chequeRow(c: Partial<ChequeRow> = {}): ChequeRow {
  return {
    id: 'chq-1',
    contractId: 'con-1',
    seq: 1,
    dueDate: '2026-10-05',
    amountFils: 2_375_000,
    chequeNo: '000101',
    bankName: 'Emirates NBD',
    status: 'upcoming',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    bounceReason: null,
    replacesChequeId: null,
    hasImage: false,
    unitId: 'unit-801',
    unitNo: '801',
    buildingId: 'bld-1',
    buildingNameAr: 'برج النور',
    buildingNameEn: 'Al Noor Tower',
    tenantName: 'Sara Khan',
    contractStatus: 'active',
    ...c,
  };
}

export function chequeDetail(c: Partial<ChequeDetail> = {}): ChequeDetail {
  return {
    ...chequeRow(),
    imageKey: null,
    depositedAt: null,
    clearedAt: null,
    bouncedAt: null,
    tenantId: 'ten-1',
    timeline: [
      {
        id: 'ev-1',
        fromStatus: null,
        toStatus: 'upcoming',
        note: 'Created with the contract',
        at: '2026-01-01T06:00:00.000Z',
        actorName: 'Mariam Haddad',
      },
    ],
    replacedBy: null,
    ...c,
  };
}

export function disputeRow(d: Partial<DisputeRow> = {}): DisputeRow {
  return {
    id: 'dsp-1',
    caseNo: 'RDC-2026-0412',
    type: 'rent_arrears',
    status: 'open',
    amountClaimedFils: 4_750_000,
    nextHearingDate: '2026-11-12',
    openedAt: '2026-09-01T07:00:00.000Z',
    closedAt: null,
    unitId: 'unit-801',
    unitNo: '801',
    buildingId: 'bld-1',
    buildingNameAr: 'برج النور',
    buildingNameEn: 'Al Noor Tower',
    tenantName: 'Sara Khan',
    ...d,
  };
}

export function disputeDetail(d: Partial<DisputeDetail> = {}): DisputeDetail {
  return {
    id: 'dsp-1',
    caseNo: 'RDC-2026-0412',
    unitId: 'unit-801',
    contractId: 'con-1',
    tenantId: 'ten-1',
    type: 'rent_arrears',
    amountClaimedFils: 4_750_000,
    status: 'open',
    nextHearingDate: '2026-11-12',
    openedAt: '2026-09-01T07:00:00.000Z',
    closedAt: null,
    notes: 'Tenant asked for a payment plan.',
    unit: { id: 'unit-801', unitNo: '801', buildingId: 'bld-1' },
    building: { id: 'bld-1', nameAr: 'برج النور', nameEn: 'Al Noor Tower' },
    tenant: tenant(),
    updates: [
      {
        id: 'upd-1',
        note: 'Case filed at the Rental Dispute Centre.',
        visibleToOwner: true,
        at: '2026-09-02T07:00:00.000Z',
        actorName: 'Mariam Haddad',
      },
      {
        id: 'upd-2',
        note: 'Lawyer fee agreed.',
        visibleToOwner: false,
        at: '2026-09-03T07:00:00.000Z',
        actorName: null,
      },
    ],
    attachments: [
      {
        id: 'att-1',
        fileName: 'claim.pdf',
        mime: 'application/pdf',
        sizeBytes: 204_800,
        createdAt: '2026-09-02T07:00:00.000Z',
      },
    ],
    ...d,
  };
}

export function overview(o: Partial<Overview> = {}): Overview {
  return {
    month: '2026-10',
    expectedFils: 47_500_000,
    clearedFils: 30_000_000,
    pendingFils: 12_750_000,
    bouncedFils: 4_750_000,
    bouncedCount: 2,
    chequeCount: 18,
    dueSoon: [chequeRow({ id: 'chq-due', chequeNo: '000555', tenantName: 'Liam Carter' })],
    endingSoon: [
      {
        id: 'con-9',
        endDate: '2026-12-01',
        annualRentFils: 8_000_000,
        unitId: 'unit-301',
        unitNo: '301',
        buildingNameAr: 'برج النور',
        buildingNameEn: 'Al Noor Tower',
        tenantName: 'Nadia Rahman',
        hasRenewalDraft: false,
      },
      {
        id: 'con-10',
        endDate: '2026-11-20',
        annualRentFils: 7_000_000,
        unitId: 'unit-302',
        unitNo: '302',
        buildingNameAr: 'برج النور',
        buildingNameEn: 'Al Noor Tower',
        tenantName: 'Hassan Ali',
        hasRenewalDraft: true,
      },
    ],
    bounced: [
      chequeRow({ id: 'chq-b', status: 'bounced', tenantName: 'Yusuf Tariq', unitNo: '1204' }),
    ],
    occupancy: { total: 40, occupied: 30 },
    deletionRequests: [
      {
        id: 'del-1',
        ownerId: 'own-7',
        at: '2026-10-21T10:00:00.000Z',
        nameEn: 'Khalid Noor',
        nameAr: 'خالد نور',
        phoneE164: '+971509998888',
      },
      {
        id: 'del-2',
        ownerId: null,
        at: '2026-10-22T10:00:00.000Z',
        nameEn: null,
        nameAr: null,
        phoneE164: '+971507776666',
      },
    ],
    ...o,
  };
}

export function staffRow(s: Partial<StaffRow> = {}): StaffRow {
  return {
    id: 'stf-2',
    email: 'omar@vamar.ae',
    name: 'Omar Saeed',
    role: 'editor',
    totpEnabled: false,
    totpRequired: false,
    active: true,
    createdAt: '2026-03-01T08:00:00.000Z',
    ...s,
  };
}

export function auditRow(a: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'aud-1',
    actorType: 'staff',
    actorId: 'staff-me',
    actorName: 'Mariam Haddad',
    action: 'owner.create',
    entityType: 'owner',
    entityId: '3f1c9a2e-7b5d-4c1e-9f0a-1234567890ab',
    before: null,
    after: { nameEn: 'Ahmed Al Mansouri' },
    ip: '10.0.0.1',
    at: '2026-10-20T08:30:00.000Z',
    ...a,
  };
}
