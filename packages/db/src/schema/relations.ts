import { relations } from 'drizzle-orm';
import { chequeEvents, cheques, contracts } from './contracts.js';
import { attachments, disputeCheques, disputeUpdates, disputes } from './disputes.js';
import {
  expenseAllocations,
  expenseCategories,
  expenses,
  recurringExpenseRules,
  vendors,
} from './expenses.js';
import { workOrders } from './work-orders.js';
import { calendarEvents } from './calendar.js';
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

// v2 -----------------------------------------------------------------------------------------------

export const expenseCategoriesRelations = relations(expenseCategories, ({ one, many }) => ({
  parent: one(expenseCategories, {
    fields: [expenseCategories.parentId],
    references: [expenseCategories.id],
    relationName: 'subcategories',
  }),
  expenses: many(expenses),
}));

export const vendorsRelations = relations(vendors, ({ many }) => ({
  expenses: many(expenses),
  workOrders: many(workOrders),
}));

export const recurringExpenseRulesRelations = relations(recurringExpenseRules, ({ one, many }) => ({
  building: one(buildings, {
    fields: [recurringExpenseRules.buildingId],
    references: [buildings.id],
  }),
  category: one(expenseCategories, {
    fields: [recurringExpenseRules.categoryId],
    references: [expenseCategories.id],
  }),
  expenses: many(expenses),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  building: one(buildings, { fields: [expenses.buildingId], references: [buildings.id] }),
  unit: one(units, { fields: [expenses.unitId], references: [units.id] }),
  category: one(expenseCategories, {
    fields: [expenses.categoryId],
    references: [expenseCategories.id],
  }),
  vendor: one(vendors, { fields: [expenses.vendorId], references: [vendors.id] }),
  rule: one(recurringExpenseRules, {
    fields: [expenses.recurringRuleId],
    references: [recurringExpenseRules.id],
  }),
  dispute: one(disputes, { fields: [expenses.disputeId], references: [disputes.id] }),
  allocations: many(expenseAllocations),
}));

export const expenseAllocationsRelations = relations(expenseAllocations, ({ one }) => ({
  expense: one(expenses, { fields: [expenseAllocations.expenseId], references: [expenses.id] }),
  unit: one(units, { fields: [expenseAllocations.unitId], references: [units.id] }),
  owner: one(owners, { fields: [expenseAllocations.ownerId], references: [owners.id] }),
}));

export const workOrdersRelations = relations(workOrders, ({ one }) => ({
  building: one(buildings, { fields: [workOrders.buildingId], references: [buildings.id] }),
  unit: one(units, { fields: [workOrders.unitId], references: [units.id] }),
  vendor: one(vendors, { fields: [workOrders.vendorId], references: [vendors.id] }),
  expense: one(expenses, { fields: [workOrders.expenseId], references: [expenses.id] }),
}));

export const calendarEventsRelations = relations(calendarEvents, ({ one }) => ({
  building: one(buildings, { fields: [calendarEvents.buildingId], references: [buildings.id] }),
  unit: one(units, { fields: [calendarEvents.unitId], references: [units.id] }),
  owner: one(owners, { fields: [calendarEvents.ownerId], references: [owners.id] }),
}));

export const disputeChequesRelations = relations(disputeCheques, ({ one }) => ({
  dispute: one(disputes, { fields: [disputeCheques.disputeId], references: [disputes.id] }),
  cheque: one(cheques, { fields: [disputeCheques.chequeId], references: [cheques.id] }),
}));
