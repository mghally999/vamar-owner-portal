import type {
  CalendarItem,
  ChequeStatus,
  ContractStatus,
  DisputeStatus,
  DisputeType,
  ExpenseKind,
  Lang,
  OwnerVisibleSettings,
  PeriodPreset,
  TimelineKind,
  UnitStatus,
  UnitType,
  WorkOrderPriority,
  WorkOrderStatus,
} from '@vamar/shared';

export interface OwnerProfile {
  id: string;
  nameAr: string;
  nameEn: string;
  phoneE164: string;
  email: string | null;
  preferredLang: Lang;
  status: 'invited' | 'active' | 'disabled';
  /** Display settings the admin chose; absent on older API builds. */
  settings?: OwnerVisibleSettings;
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
  /** Property record (v2); present once the owner units endpoint carries it. */
  status?: UnitStatus | null;
  titleDeedNo?: string | null;
  plotNo?: string | null;
  makaniNo?: string | null;
  dewaPremiseNo?: string | null;
  municipalityNo?: string | null;
  handoverDate?: string | null;
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
  /** Numbers of the cheques the case is about, oldest first. */
  chequeNos: string[];
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

export interface DisputeDetail extends DisputeItem {
  updates: { id: string; note: string; at: string }[];
  cheques: DisputeCheque[];
}

export interface DeviceItem {
  id: string;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  model: string;
  firstSeen: string;
  lastSeen: string;
  revokedAt: string | null;
  current: boolean;
}

// v2 -------------------------------------------------------------------------------------------

export interface Period {
  from: string;
  to: string;
}

export interface SummaryRent {
  expectedFils: number;
  collectedFils: number;
  outstandingFils: number;
  atRiskFils: number;
  chequeCount: number;
  bouncedCount: number;
}

export interface SummaryExpenses {
  fixedFils: number;
  variableFils: number;
  totalFils: number;
  count: number;
  projectedFixedFils: number;
}

export interface SummaryBucket extends SummaryRent, SummaryExpenses {
  key: string;
  netFils: number;
}

/** GET /api/owner/summary */
export interface Summary {
  preset: PeriodPreset;
  period: Period;
  comparison: Period | null;
  isFuture: boolean;
  rent: SummaryRent;
  expenses: SummaryExpenses;
  netFils: number;
  projectedNetFils: number;
  previous: { rent: SummaryRent; expenses: SummaryExpenses; netFils: number } | null;
  buckets: SummaryBucket[];
  nextCheque: Home['nextCheque'];
  contractsEnding: {
    id: string;
    unitId: string;
    unitNo: string;
    buildingNameAr: string;
    buildingNameEn: string;
    tenantName: string;
    endDate: string;
  }[];
  openWorkOrders: number;
  openDisputes: number;
  occupancy: { occupied: number; total: number; pct: number };
}

export interface ExpenseItem {
  id: string;
  scope: 'building' | 'unit';
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  unitId: string | null;
  unitNo: string | null;
  unitIds: string[];
  categoryId: string;
  categoryNameAr: string;
  categoryNameEn: string;
  kind: ExpenseKind;
  vendorName: string | null;
  reasonAr: string;
  reasonEn: string;
  invoiceNo: string | null;
  invoiceDate: string;
  coversFrom: string | null;
  coversTo: string | null;
  grossAmountFils: number;
  grossVatFils: number;
  grossTotalFils: number;
  /** The owner's share of the total. */
  amountFils: number;
  shared: boolean;
  paidOn: string | null;
  hasAttachments: boolean;
}

export interface AttachmentItem {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ExpenseDetail extends Omit<ExpenseItem, 'hasAttachments'> {
  paymentMethod: 'cash' | 'cheque' | 'transfer' | 'card' | null;
  allocationMethod: string;
  disputeId: string | null;
  disputeCaseNo: string | null;
  attachments: AttachmentItem[];
  workOrder: {
    id: string;
    titleAr: string;
    titleEn: string;
    status: WorkOrderStatus;
    completedAt: string | null;
  } | null;
}

export interface WorkOrderItem {
  id: string;
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  unitId: string | null;
  unitNo: string | null;
  titleAr: string;
  titleEn: string;
  description: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  reportedOn: string;
  scheduledFor: string | null;
  completedAt: string | null;
  vendorName: string | null;
  expenseId: string | null;
  photoCount: number;
}

export interface WorkOrderDetail extends WorkOrderItem {
  expenseTotalFils: number | null;
  attachments: AttachmentItem[];
}

/** One line of a unit's history (GET /api/owner/units/:id/timeline). */
export interface TimelineEntry {
  kind: TimelineKind;
  id: string;
  at: string;
  date: string;
  /** A key the app translates (status_x, cheque_cleared, expense_fixed...), or a name. */
  titleAr: string;
  titleEn: string;
  detailAr: string;
  detailEn: string;
  entityType: string;
  entityId: string;
  amountFils: number | null;
  status: string | null;
}

export interface CalendarResponse {
  items: CalendarItem[];
  holidays: string[];
}

export type { CalendarItem };
