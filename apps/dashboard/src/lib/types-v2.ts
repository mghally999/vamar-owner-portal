/** Response shapes of the v2 staff API: expenses, work orders, reports, calendar, settings, search. */
import type {
  AllocationMethod,
  CalendarItem,
  ExpenseKind,
  ExpenseStatus,
  PaymentMethod,
  PeriodPreset,
  RecurringFrequency,
  WorkOrderPriority,
  WorkOrderStatus,
} from '@vamar/shared';
import type { Attachment } from './types';

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

export interface ExpenseRow {
  id: string;
  scope: 'building' | 'unit';
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  unitId: string | null;
  unitNo: string | null;
  categoryId: string;
  categoryNameAr: string;
  categoryNameEn: string;
  kind: ExpenseKind;
  vendorId: string | null;
  vendorName: string | null;
  reasonAr: string;
  reasonEn: string;
  invoiceNo: string | null;
  invoiceDate: string;
  coversFrom: string | null;
  coversTo: string | null;
  amountFils: number;
  vatFils: number;
  totalFils: number;
  paidOn: string | null;
  paymentMethod: PaymentMethod | null;
  status: ExpenseStatus;
  allocationMethod: AllocationMethod;
  visibleToOwner: boolean;
  recurringRuleId: string | null;
  disputeId: string | null;
  correctsExpenseId: string | null;
  createdAt: string;
  postedAt: string | null;
  hasAttachments: boolean;
}

export interface ExpenseTotals {
  count: number;
  amountFils: number;
  vatFils: number;
  totalFils: number;
  fixedFils: number;
  variableFils: number;
}

export interface ExpenseAllocationRow {
  id: string;
  unitId: string;
  unitNo: string;
  ownerId: string;
  nameAr: string;
  nameEn: string;
  amountFils: number;
  onDate: string;
}

export interface ExpenseDetail extends ExpenseRow {
  voidReason: string | null;
  voidedAt: string | null;
  vendorTrn: string | null;
  vendorPhone: string | null;
  disputeCaseNo: string | null;
  allocations: ExpenseAllocationRow[];
  attachments: Attachment[];
  workOrder: { id: string; titleAr: string; titleEn: string; status: WorkOrderStatus } | null;
  correctedBy: { id: string; status: ExpenseStatus } | null;
  createdByName: string | null;
  postedByName: string | null;
  voidedByName: string | null;
}

export interface ExpenseWarnings {
  duplicateInvoice: { expenseId: string; invoiceDate: string; status: ExpenseStatus } | null;
  outlier: { averageFils: number; count: number } | null;
}

export interface AllocationPreviewRow {
  unitId: string;
  unitNo: string;
  ownerId: string;
  nameAr: string;
  nameEn: string;
  shareBp: number;
  amountFils: number;
}

export interface RecurringRule {
  id: string;
  scope: 'building' | 'unit';
  buildingId: string;
  buildingNameAr: string;
  buildingNameEn: string;
  unitId: string | null;
  unitNo: string | null;
  categoryId: string;
  categoryNameAr: string;
  categoryNameEn: string;
  vendorId: string | null;
  vendorName: string | null;
  reasonAr: string;
  reasonEn: string;
  amountFils: number;
  vatFils: number;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  allocationMethod: AllocationMethod;
  visibleToOwner: boolean;
  active: boolean;
  createdAt: string;
}

export interface WorkOrderRow {
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
  vendorId: string | null;
  vendorName: string | null;
  expenseId: string | null;
  expenseTotalFils: number | null;
  expenseStatus: ExpenseStatus | null;
  visibleToOwner: boolean;
  createdAt: string;
  photoCount: number;
}

export interface WorkOrderDetail extends WorkOrderRow {
  attachments: Attachment[];
}

export interface RentTotals {
  expectedFils: number;
  collectedFils: number;
  outstandingFils: number;
  atRiskFils: number;
  chequeCount: number;
  bouncedCount: number;
  collectionRatePct: number;
}

export interface ExpenseTotalsReport {
  fixedFils: number;
  variableFils: number;
  totalFils: number;
  vatFils: number;
  count: number;
}

export interface ReportBucket extends RentTotals, ExpenseTotalsReport {
  key: string;
  netFils: number;
  occupiedUnits: number;
  totalUnits: number;
}

export interface CategoryTotal {
  categoryId: string;
  nameAr: string;
  nameEn: string;
  kind: ExpenseKind;
  totalFils: number;
  count: number;
}

export interface ReportSummary {
  preset: PeriodPreset;
  period: { from: string; to: string };
  comparison: { from: string; to: string } | null;
  rent: RentTotals;
  expenses: ExpenseTotalsReport;
  netFils: number;
  previous: { rent: RentTotals; expenses: ExpenseTotalsReport; netFils: number } | null;
  change: {
    expectedPct: number | null;
    collectedPct: number | null;
    expensesPct: number | null;
    netPct: number | null;
  } | null;
  buckets: ReportBucket[];
  byCategory: CategoryTotal[];
  occupancy: { occupiedUnits: number; totalUnits: number; pct: number };
}

export type SearchHitType =
  'owner' | 'unit' | 'building' | 'cheque' | 'dispute' | 'expense' | 'tenant';

export interface SearchHit {
  type: SearchHitType;
  id: string;
  titleAr: string;
  titleEn: string;
  detail: string;
  parentId: string | null;
}

export interface Holiday {
  date: string;
  nameAr: string;
  nameEn: string;
  tentative: boolean;
}

export interface AppSettings {
  weekStart: 'monday' | 'saturday' | 'sunday';
  hijriDisplay: boolean;
  showBeforeFeeLabel: boolean;
  largeExpenseAlertFils: number;
  ownersSeeInvoiceFiles: boolean;
}

export type { CalendarItem };
