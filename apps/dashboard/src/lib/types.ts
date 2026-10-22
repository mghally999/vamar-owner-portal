/** Response shapes of the staff API as consumed by the dashboard. Kept close to the services. */
import type {
  ChequeStatus,
  ContractStatus,
  DisputeStatus,
  DisputeType,
  Lang,
  OwnerStatus,
  StaffRole,
  UnitType,
} from '@vamar/shared';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OwnerRow {
  id: string;
  nameAr: string;
  nameEn: string;
  phoneE164: string;
  email: string | null;
  preferredLang: Lang;
  status: OwnerStatus;
  createdAt: string;
  unitCount: number;
}

export interface OwnerDetail extends Omit<OwnerRow, 'unitCount'> {
  holdings: {
    unitId: string;
    unitNo: string;
    type: UnitType;
    shareBp: number;
    fromDate: string;
    buildingId: string;
    buildingNameAr: string;
    buildingNameEn: string;
  }[];
  devices: {
    id: string;
    platform: 'ios' | 'android' | 'web';
    model: string;
    firstSeen: string;
    lastSeen: string;
    revokedAt: string | null;
    hasPushToken: boolean;
  }[];
}

export interface BuildingRow {
  id: string;
  nameAr: string;
  nameEn: string;
  area: string;
  address: string;
  unitCount: number;
  occupiedCount: number;
}

export interface UnitOwnerRef {
  ownerId: string;
  nameAr: string;
  nameEn: string;
  shareBp: number;
}

export interface BuildingUnit {
  id: string;
  buildingId: string;
  unitNo: string;
  type: UnitType;
  bedrooms: number | null;
  sizeSqft: number | null;
  active: boolean;
  owners: UnitOwnerRef[];
  occupied: boolean;
  contract: {
    id: string;
    startDate: string;
    endDate: string;
    annualRentFils: number;
    status: ContractStatus;
    tenantName: string;
  } | null;
}

export interface BuildingDetail {
  id: string;
  nameAr: string;
  nameEn: string;
  area: string;
  address: string;
  notes: string;
  units: BuildingUnit[];
}

export interface Tenant {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  notes: string;
}

export interface ContractRow {
  id: string;
  unitId: string;
  unitNo: string;
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  tenantId: string;
  tenantName: string;
  startDate: string;
  endDate: string;
  annualRentFils: number;
  chequeCount: number;
  status: ContractStatus;
  createdAt: string;
}

export interface ChequeRowBase {
  id: string;
  contractId: string;
  seq: number;
  dueDate: string;
  amountFils: number | null;
  chequeNo: string | null;
  bankName: string | null;
  status: ChequeStatus;
  statusChangedAt: string;
  depositedAt: string | null;
  clearedAt: string | null;
  bouncedAt: string | null;
  bounceReason: string | null;
  replacesChequeId: string | null;
  imageKey: string | null;
}

export interface ContractDetail {
  id: string;
  unitId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  annualRentFils: number;
  chequeCount: number;
  status: ContractStatus;
  previousContractId: string | null;
  ejariNo: string | null;
  notes: string;
  createdAt: string;
  unit: { id: string; unitNo: string; type: UnitType; buildingId: string } | null;
  building: { id: string; nameAr: string; nameEn: string } | null;
  tenant: Tenant | null;
  cheques: ChequeRowBase[];
  gridValidation: {
    totalFils: number;
    annualRentFils: number;
    differenceFils: number;
    complete: boolean;
    matchesRent: boolean;
    missingSeqs: number[];
    duplicateChequeNos: string[];
  };
}

export interface ChequeRow {
  id: string;
  contractId: string;
  seq: number;
  dueDate: string;
  amountFils: number | null;
  chequeNo: string | null;
  bankName: string | null;
  status: ChequeStatus;
  statusChangedAt: string;
  bounceReason: string | null;
  replacesChequeId: string | null;
  hasImage: boolean;
  unitId: string;
  unitNo: string;
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  tenantName: string;
  contractStatus: ContractStatus;
}

export interface ChequeDetail extends ChequeRow {
  imageKey: string | null;
  depositedAt: string | null;
  clearedAt: string | null;
  bouncedAt: string | null;
  tenantId: string;
  timeline: {
    id: string;
    fromStatus: ChequeStatus | null;
    toStatus: ChequeStatus;
    note: string;
    at: string;
    actorName: string | null;
  }[];
  replacedBy: {
    id: string;
    chequeNo: string | null;
    dueDate: string;
    amountFils: number | null;
    status: ChequeStatus;
  } | null;
}

export interface DisputeRow {
  id: string;
  caseNo: string;
  type: DisputeType;
  status: DisputeStatus;
  amountClaimedFils: number | null;
  nextHearingDate: string | null;
  openedAt: string;
  closedAt: string | null;
  unitId: string;
  unitNo: string;
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  tenantName: string | null;
}

export interface Attachment {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DisputeDetail {
  id: string;
  caseNo: string;
  unitId: string;
  contractId: string | null;
  tenantId: string | null;
  type: DisputeType;
  amountClaimedFils: number | null;
  status: DisputeStatus;
  nextHearingDate: string | null;
  openedAt: string;
  closedAt: string | null;
  notes: string;
  unit: { id: string; unitNo: string; buildingId: string } | null;
  building: { id: string; nameAr: string; nameEn: string } | null;
  tenant: Tenant | null;
  updates: {
    id: string;
    note: string;
    visibleToOwner: boolean;
    at: string;
    actorName: string | null;
  }[];
  attachments: Attachment[];
}

export interface Overview {
  month: string;
  expectedFils: number;
  clearedFils: number;
  pendingFils: number;
  bouncedFils: number;
  bouncedCount: number;
  chequeCount: number;
  dueSoon: ChequeRow[];
  endingSoon: {
    id: string;
    endDate: string;
    annualRentFils: number;
    unitId: string;
    unitNo: string;
    buildingNameAr: string;
    buildingNameEn: string;
    tenantName: string;
    hasRenewalDraft: boolean;
  }[];
  bounced: ChequeRow[];
  occupancy: { total: number; occupied: number };
  deletionRequests: {
    id: string;
    ownerId: string | null;
    at: string;
    nameEn: string | null;
    nameAr: string | null;
    phoneE164: string | null;
  }[];
}

export interface StaffRow {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  totpEnabled: boolean;
  totpRequired: boolean;
  active: boolean;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  actorType: 'staff' | 'owner' | 'system';
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  at: string;
}
