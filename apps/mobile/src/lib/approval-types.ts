/** Shapes of the owner approval endpoints (apps/api/src/services/approvals.ts). */
import type { RepairApprovalStatus } from '@vamar/shared';

export interface ApprovalItem {
  id: string;
  kind: 'work_order' | 'expense';
  workOrderId: string | null;
  expenseId: string | null;
  titleAr: string;
  titleEn: string;
  buildingNameAr: string;
  buildingNameEn: string;
  unitNo: string | null;
  vendorName: string | null;
  /** The estimate (or expense total) the owner is asked about. */
  amountFils: number;
  /** The owner's own part of it. */
  shareFils: number;
  status: RepairApprovalStatus;
  note: string | null;
  askedOn: string;
  answeredAt: string | null;
  /** If not answered by this day it counts as approved; null when that is switched off. */
  deadline: string | null;
  /** The job has not started (or the expense been posted), so an answer still matters. */
  waiting: boolean;
  canAnswer: boolean;
}

export interface ApprovalDetail extends ApprovalItem {
  description: string;
  attachments: { id: string; fileName: string; mime: string; sizeBytes: number }[];
}

export interface ApprovalAnswer {
  decision: 'approve' | 'reject';
  note: string | null;
}
