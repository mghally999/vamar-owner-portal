import { z } from 'zod';
import { CHEQUE_STATUSES } from '../cheques.js';
import { CONTRACT_STATUSES } from '../occupancy.js';
import { NOTIFICATION_TYPES } from '../alerts.js';

export const langSchema = z.enum(['ar', 'en'], {
  error: 'Language must be ar or en · اللغة يجب أن تكون ar أو en',
});

export const STAFF_ROLES = ['admin', 'editor', 'viewer'] as const;
export const staffRoleSchema = z.enum(STAFF_ROLES);
export type StaffRole = (typeof STAFF_ROLES)[number];

export const OWNER_STATUSES = ['invited', 'active', 'disabled'] as const;
export const ownerStatusSchema = z.enum(OWNER_STATUSES);
export type OwnerStatus = (typeof OWNER_STATUSES)[number];

export const UNIT_TYPES = ['apartment', 'villa', 'shop', 'office', 'warehouse', 'other'] as const;
export const unitTypeSchema = z.enum(UNIT_TYPES);
export type UnitType = (typeof UNIT_TYPES)[number];

export const contractStatusSchema = z.enum(CONTRACT_STATUSES);
export const chequeStatusSchema = z.enum(CHEQUE_STATUSES);
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const DISPUTE_TYPES = [
  'rent_arrears',
  'bounced_cheque',
  'eviction',
  'damages',
  'other',
] as const;
export const disputeTypeSchema = z.enum(DISPUTE_TYPES);
export type DisputeType = (typeof DISPUTE_TYPES)[number];

export const DISPUTE_STATUSES = [
  'open',
  'in_progress',
  'hearing_scheduled',
  'judgment_issued',
  'closed',
] as const;
export const disputeStatusSchema = z.enum(DISPUTE_STATUSES);
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const ATTACHMENT_ENTITY_TYPES = ['cheque', 'dispute', 'contract', 'unit'] as const;
export const attachmentEntityTypeSchema = z.enum(ATTACHMENT_ENTITY_TYPES);
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export const SUBJECT_TYPES = ['owner', 'staff'] as const;
export const subjectTypeSchema = z.enum(SUBJECT_TYPES);
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/** 'web' is the owner web app at /app (iPhone home-screen app). */
export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const IMPORT_STATUSES = ['validating', 'ready', 'committing', 'done', 'failed'] as const;
export const importStatusSchema = z.enum(IMPORT_STATUSES);
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const AUDIT_ACTOR_TYPES = ['staff', 'owner', 'system'] as const;
export const auditActorTypeSchema = z.enum(AUDIT_ACTOR_TYPES);
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
