import { relations } from 'drizzle-orm';
import { chequeEvents, cheques, contracts } from './contracts.js';
import { attachments, disputeUpdates, disputes } from './disputes.js';
import { devices, notificationLog, owners } from './owners.js';
import { buildings, tenants, unitOwnerships, units } from './properties.js';
import { staffUsers } from './staff.js';

export const ownersRelations = relations(owners, ({ many }) => ({
  ownerships: many(unitOwnerships),
  devices: many(devices),
  notifications: many(notificationLog),
}));

export const devicesRelations = relations(devices, ({ one }) => ({
  owner: one(owners, { fields: [devices.ownerId], references: [owners.id] }),
}));

export const buildingsRelations = relations(buildings, ({ many }) => ({
  units: many(units),
}));

export const unitsRelations = relations(units, ({ one, many }) => ({
  building: one(buildings, { fields: [units.buildingId], references: [buildings.id] }),
  ownerships: many(unitOwnerships),
  contracts: many(contracts),
  disputes: many(disputes),
}));

export const unitOwnershipsRelations = relations(unitOwnerships, ({ one }) => ({
  unit: one(units, { fields: [unitOwnerships.unitId], references: [units.id] }),
  owner: one(owners, { fields: [unitOwnerships.ownerId], references: [owners.id] }),
}));

export const tenantsRelations = relations(tenants, ({ many }) => ({
  contracts: many(contracts),
}));

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  unit: one(units, { fields: [contracts.unitId], references: [units.id] }),
  tenant: one(tenants, { fields: [contracts.tenantId], references: [tenants.id] }),
  previous: one(contracts, {
    fields: [contracts.previousContractId],
    references: [contracts.id],
    relationName: 'renewal',
  }),
  cheques: many(cheques),
  createdByStaff: one(staffUsers, { fields: [contracts.createdBy], references: [staffUsers.id] }),
}));

export const chequesRelations = relations(cheques, ({ one, many }) => ({
  contract: one(contracts, { fields: [cheques.contractId], references: [contracts.id] }),
  replaces: one(cheques, {
    fields: [cheques.replacesChequeId],
    references: [cheques.id],
    relationName: 'replacement',
  }),
  events: many(chequeEvents),
}));

export const chequeEventsRelations = relations(chequeEvents, ({ one }) => ({
  cheque: one(cheques, { fields: [chequeEvents.chequeId], references: [cheques.id] }),
  actor: one(staffUsers, { fields: [chequeEvents.actorStaffId], references: [staffUsers.id] }),
}));

export const disputesRelations = relations(disputes, ({ one, many }) => ({
  unit: one(units, { fields: [disputes.unitId], references: [units.id] }),
  contract: one(contracts, { fields: [disputes.contractId], references: [contracts.id] }),
  tenant: one(tenants, { fields: [disputes.tenantId], references: [tenants.id] }),
  updates: many(disputeUpdates),
}));

export const disputeUpdatesRelations = relations(disputeUpdates, ({ one }) => ({
  dispute: one(disputes, { fields: [disputeUpdates.disputeId], references: [disputes.id] }),
  actor: one(staffUsers, { fields: [disputeUpdates.actorStaffId], references: [staffUsers.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  uploader: one(staffUsers, { fields: [attachments.uploadedBy], references: [staffUsers.id] }),
}));
