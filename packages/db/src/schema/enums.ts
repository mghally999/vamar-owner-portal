import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ALLOCATION_METHODS,
  ATTACHMENT_ENTITY_TYPES,
  AUDIT_ACTOR_TYPES,
  CALENDAR_EVENT_TYPES,
  CHEQUE_STATUSES,
  CONTRACT_STATUSES,
  DEVICE_PLATFORMS,
  DISPUTE_STATUSES,
  DISPUTE_TYPES,
  EXPENSE_KINDS,
  EXPENSE_SCOPES,
  EXPENSE_STATUSES,
  IMPORT_STATUSES,
  NOTIFICATION_TYPES,
  OWNER_STATUSES,
  PAYMENT_METHODS,
  RECURRING_FREQUENCIES,
  REPAIR_APPROVAL_STATUSES,
  STAFF_ROLES,
  SUBJECT_TYPES,
  UNIT_STATUSES,
  UNIT_TYPES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
} from '@vamar/shared';

// Postgres enums mirror the shared constants so the database rejects anything the code does not know.
export const staffRole = pgEnum('staff_role', STAFF_ROLES);
export const ownerStatus = pgEnum('owner_status', OWNER_STATUSES);
export const lang = pgEnum('lang', ['ar', 'en']);
export const unitType = pgEnum('unit_type', UNIT_TYPES);
export const contractStatus = pgEnum('contract_status', CONTRACT_STATUSES);
export const chequeStatus = pgEnum('cheque_status', CHEQUE_STATUSES);
export const disputeType = pgEnum('dispute_type', DISPUTE_TYPES);
export const disputeStatus = pgEnum('dispute_status', DISPUTE_STATUSES);
export const attachmentEntityType = pgEnum('attachment_entity_type', ATTACHMENT_ENTITY_TYPES);
export const devicePlatform = pgEnum('device_platform', DEVICE_PLATFORMS);
export const subjectType = pgEnum('subject_type', SUBJECT_TYPES);
export const notificationType = pgEnum('notification_type', NOTIFICATION_TYPES);
export const importStatus = pgEnum('import_status', IMPORT_STATUSES);
export const auditActorType = pgEnum('audit_actor_type', AUDIT_ACTOR_TYPES);

// v2
export const expenseKind = pgEnum('expense_kind', EXPENSE_KINDS);
export const expenseScope = pgEnum('expense_scope', EXPENSE_SCOPES);
export const expenseStatus = pgEnum('expense_status', EXPENSE_STATUSES);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);
export const allocationMethod = pgEnum('allocation_method', ALLOCATION_METHODS);
export const recurringFrequency = pgEnum('recurring_frequency', RECURRING_FREQUENCIES);
export const workOrderPriority = pgEnum('work_order_priority', WORK_ORDER_PRIORITIES);
export const workOrderStatus = pgEnum('work_order_status', WORK_ORDER_STATUSES);
export const unitStatus = pgEnum('unit_status', UNIT_STATUSES);
export const calendarEventType = pgEnum('calendar_event_type', CALENDAR_EVENT_TYPES);

// v3
export const repairApprovalStatus = pgEnum('repair_approval_status', REPAIR_APPROVAL_STATUSES);
