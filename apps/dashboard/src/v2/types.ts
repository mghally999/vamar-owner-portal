/** Response shapes of the v2 staff endpoints used by the pages under src/v2. */
import type {
  AllocationMethod,
  AppSettings,
  CalendarEventType,
  CalendarItem,
  ChequeStatus,
  ContractStatus,
  DisputeStatus,
  ExpenseKind,
  ExpenseStatus,
  RecurringFrequency,
  TimelineKind,
  UnitStatus,
  UnitType,
} from '@vamar/shared';
import type { DisputeDetail, DisputeRow } from '@/lib/types';

export type { CalendarItem };

export interface CalendarEvent {
  id: string;
  titleAr: string;
  titleEn: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  type: CalendarEventType;
  buildingId: string | null;
  unitId: string | null;
  ownerId: string | null;
  visibleToOwner: boolean;
  notes: string;
}

export interface Holiday {
  date: string;
  nameAr: string;
  nameEn: string;
  tentative: boolean;
}

export type Settings = AppSettings;

export interface ExpenseCategory {
  id: string;
  nameAr: string;
  nameEn: string;
  kind: ExpenseKind;
  parentId: string | null;
  sort: number;
  active: boolean;
}

export interface Vendor {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  trn: string | null;
  notes: string;
  active: boolean;
}

/** The identifiers the building record carries beyond the base BuildingDetail. */
export interface BuildingIdentifiers {
  plotNo: string | null;
  makaniNo: string | null;
  titleDeedNo: string | null;
  completionYear: number | null;
  floorsCount: number | null;
}

/** The unit rows of a building detail carry the manual and effective status and the numbers. */
export interface BuildingUnitRecord {
  status?: UnitStatus;
  effectiveStatus?: UnitStatus;
  titleDeedNo?: string | null;
  makaniNo?: string | null;
}

export interface UnitStatusEvent {
  id: string;
  fromStatus: UnitStatus | null;
  toStatus: UnitStatus;
  reason: string;
  at: string;
  actorName: string | null;
}

export interface UnitRecord {
  id: string;
  buildingId: string;
  unitNo: string;
  type: UnitType;
  bedrooms: number | null;
  sizeSqft: number | null;
  active: boolean;
  status: UnitStatus;
  effectiveStatus: UnitStatus;
  occupied: boolean;
  titleDeedNo: string | null;
  plotNo: string | null;
  makaniNo: string | null;
  dewaPremiseNo: string | null;
  municipalityNo: string | null;
  handoverDate: string | null;
  building: {
    id: string;
    nameAr: string;
    nameEn: string;
    area: string;
    plotNo: string | null;
    makaniNo: string | null;
  } | null;
  owners: { ownerId: string; nameAr: string; nameEn: string; shareBp: number; fromDate: string }[];
  contracts: {
    id: string;
    startDate: string;
    endDate: string;
    annualRentFils: number;
    chequeCount: number;
    status: ContractStatus;
    tenantId: string;
    tenantName: string;
  }[];
}

export interface TimelineEntry {
  kind: TimelineKind;
  id: string;
  at: string;
  date: string;
  titleAr: string;
  titleEn: string;
  detailAr: string;
  detailEn: string;
  entityType: string;
  entityId: string;
  amountFils: number | null;
  status: string | null;
  /** Building timelines carry the unit. */
  unitId?: string;
  unitNo?: string;
}

export interface TimelinePage {
  items: TimelineEntry[];
  nextCursor: string | null;
}

export interface DisputeCheque {
  id: string;
  chequeNo: string | null;
  bankName: string | null;
  amountFils: number | null;
  dueDate: string;
  status: ChequeStatus;
  bouncedAt: string | null;
  bounceReason: string | null;
  contractId: string;
}

export type DisputeRowV2 = DisputeRow & { chequeNos: string[] };
export type DisputeDetailV2 = DisputeDetail & { cheques: DisputeCheque[] };

export interface ExpenseRowV2 {
  id: string;
  reasonAr: string;
  reasonEn: string;
  invoiceNo: string | null;
  invoiceDate: string;
  totalFils: number;
  vatFils: number;
  status: ExpenseStatus;
  kind: ExpenseKind;
  vendorName: string | null;
  categoryNameAr: string;
  categoryNameEn: string;
  allocationMethod: AllocationMethod;
}

export interface UnitCheque {
  id: string;
  chequeNo: string | null;
  bankName: string | null;
  amountFils: number | null;
  dueDate: string;
  status: ChequeStatus;
  tenantName: string;
  contractId: string;
}

export type { DisputeStatus, RecurringFrequency, UnitStatus };
