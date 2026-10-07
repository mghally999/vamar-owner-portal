import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ATTACHMENT_ENTITY_TYPES,
  AUDIT_ACTOR_TYPES,
  CHEQUE_STATUSES,
  CONTRACT_STATUSES,
  DEVICE_PLATFORMS,
  DISPUTE_STATUSES,
  DISPUTE_TYPES,
  IMPORT_STATUSES,
  NOTIFICATION_TYPES,
  OWNER_STATUSES,
  STAFF_ROLES,
  SUBJECT_TYPES,
  UNIT_TYPES,
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
