import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type * as s from './schema/index.js';

export type StaffUser = InferSelectModel<typeof s.staffUsers>;
export type NewStaffUser = InferInsertModel<typeof s.staffUsers>;

export type Owner = InferSelectModel<typeof s.owners>;
export type NewOwner = InferInsertModel<typeof s.owners>;

export type Device = InferSelectModel<typeof s.devices>;
export type Session = InferSelectModel<typeof s.sessions>;
export type NotificationLogRow = InferSelectModel<typeof s.notificationLog>;

export type Building = InferSelectModel<typeof s.buildings>;
export type NewBuilding = InferInsertModel<typeof s.buildings>;
export type Unit = InferSelectModel<typeof s.units>;
export type NewUnit = InferInsertModel<typeof s.units>;
export type UnitOwnership = InferSelectModel<typeof s.unitOwnerships>;
export type Tenant = InferSelectModel<typeof s.tenants>;
export type NewTenant = InferInsertModel<typeof s.tenants>;

export type Contract = InferSelectModel<typeof s.contracts>;
export type NewContract = InferInsertModel<typeof s.contracts>;
export type Cheque = InferSelectModel<typeof s.cheques>;
export type NewCheque = InferInsertModel<typeof s.cheques>;
export type ChequeEvent = InferSelectModel<typeof s.chequeEvents>;

export type Dispute = InferSelectModel<typeof s.disputes>;
export type NewDispute = InferInsertModel<typeof s.disputes>;
export type DisputeUpdate = InferSelectModel<typeof s.disputeUpdates>;
export type Attachment = InferSelectModel<typeof s.attachments>;

export type AuditLogRow = InferSelectModel<typeof s.auditLog>;
export type NewAuditLogRow = InferInsertModel<typeof s.auditLog>;
export type ImportRow = InferSelectModel<typeof s.imports>;
export type RateLimitRow = InferSelectModel<typeof s.rateLimits>;
