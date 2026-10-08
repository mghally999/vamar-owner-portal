import type {
  ChequeStatus,
  ContractStatus,
  DisputeStatus,
  DisputeType,
  Lang,
  UnitType,
} from '@vamar/shared';

export interface OwnerProfile {
  id: string;
  nameAr: string;
  nameEn: string;
  phoneE164: string;
  email: string | null;
  preferredLang: Lang;
  status: 'invited' | 'active' | 'disabled';
}

export interface Home {
  month: string;
  expectedFils: number;
  clearedFils: number;
  pendingFils: number;
  bouncedCount: number;
  bouncedFils: number;
  nextCheque: {
    id: string;
    dueDate: string;
    amountFils: number;
    unitNo: string;
    buildingNameAr: string;
    buildingNameEn: string;
    tenantName: string;
    status: ChequeStatus;
  } | null;
  nextMonthFils: number;
  occupancy: { occupied: number; total: number; pct: number };
  vacantUnits: {
    unitId: string;
    unitNo: string;
    buildingNameAr: string;
    buildingNameEn: string;
    vacantSince: string | null;
  }[];
  openDisputes: number;
}

export interface ChequeItem {
  id: string;
  seq: number;
  dueDate: string;
  grossAmountFils: number | null;
  amountFils: number | null;
  shareBp: number;
  shared: boolean;
  chequeNo: string | null;
  bankName: string | null;
  status: ChequeStatus;
  statusChangedAt: string;
  bounceReason: string | null;
  hasImage: boolean;
  unitId: string;
  unitNo: string;
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  tenantName: string;
  contractId: string;
}

export interface ChequeDetail extends ChequeItem {
  timeline: { id: string; fromStatus: ChequeStatus | null; toStatus: ChequeStatus; at: string }[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface BuildingItem {
  id: string;
  nameAr: string;
  nameEn: string;
  area: string;
  unitCount: number;
  occupiedCount: number;
}

export interface UnitItem {
  id: string;
  unitNo: string;
  type: UnitType;
  bedrooms: number | null;
  sizeSqft: number | null;
  shareBp: number;
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  contractId: string | null;
  tenantName: string | null;
  contractEndDate: string | null;
  annualRentFils: number | null;
  vacantSince: string | null;
  occupied: boolean;
}

export interface UnitDetail extends UnitItem {
  contracts: {
    id: string;
    startDate: string;
    endDate: string;
    annualRentFils: number;
    chequeCount: number;
    status: ContractStatus;
    tenantName: string;
  }[];
  cheques: ChequeItem[];
}

export interface DisputeItem {
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
  buildingNameAr: string;
  buildingNameEn: string;
  tenantName: string | null;
}

export interface DisputeDetail extends DisputeItem {
  updates: { id: string; note: string; at: string }[];
}

export interface DeviceItem {
  id: string;
  deviceId: string;
  platform: 'ios' | 'android';
  model: string;
  firstSeen: string;
  lastSeen: string;
  revokedAt: string | null;
  current: boolean;
}
