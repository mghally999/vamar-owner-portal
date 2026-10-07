/**
 * Input schemas for staff data entry. Every API body, query and param is validated with
 * one of these (or a schema derived from them). Output row types come from the db package.
 */
import { z } from 'zod';
import {
  auditReasonSchema,
  chequeCountSchema,
  emailSchema,
  filsNonNegativeSchema,
  filsSchema,
  longText,
  phoneE164Schema,
  plainDateSchema,
  shareBpSchema,
  shortText,
  uuidSchema,
} from './common.js';
import {
  chequeStatusSchema,
  disputeStatusSchema,
  disputeTypeSchema,
  langSchema,
  staffRoleSchema,
  unitTypeSchema,
} from './enums.js';

// Owners -------------------------------------------------------------------------------------

export const createOwnerSchema = z.object({
  nameAr: shortText,
  nameEn: shortText,
  phoneE164: phoneE164Schema,
  email: emailSchema.nullable().default(null),
  preferredLang: langSchema.default('ar'),
});
export type CreateOwnerInput = z.infer<typeof createOwnerSchema>;

export const updateOwnerSchema = createOwnerSchema.partial();

// Buildings and units ----------------------------------------------------------------------

export const createBuildingSchema = z.object({
  nameAr: shortText,
  nameEn: shortText,
  area: shortText,
  address: longText.default(''),
  notes: longText.default(''),
});
export type CreateBuildingInput = z.infer<typeof createBuildingSchema>;

export const updateBuildingSchema = createBuildingSchema.partial();

export const createUnitSchema = z.object({
  buildingId: uuidSchema,
  unitNo: z.string().trim().min(1).max(30),
  type: unitTypeSchema,
  bedrooms: z.number().int().min(0).max(20).nullable().default(null),
  sizeSqft: z.number().int().positive().max(1_000_000).nullable().default(null),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = createUnitSchema.omit({ buildingId: true }).partial().extend({
  active: z.boolean().optional(),
});

/** Replace the current owners of a unit. Shares must sum to 10000 bp (checked in the service). */
export const setUnitOwnersSchema = z.object({
  fromDate: plainDateSchema,
  owners: z
    .array(z.object({ ownerId: uuidSchema, shareBp: shareBpSchema }))
    .min(1)
    .max(20),
});
export type SetUnitOwnersInput = z.infer<typeof setUnitOwnersSchema>;

// Tenants ------------------------------------------------------------------------------------

export const createTenantSchema = z.object({
  name: shortText,
  phone: phoneE164Schema.nullable().default(null),
  email: emailSchema.nullable().default(null),
  company: shortText.nullable().default(null),
  notes: longText.default(''),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = createTenantSchema.partial();

// Contracts and the cheque grid --------------------------------------------------------------

export const chequeGridRowSchema = z.object({
  seq: z.number().int().min(1).max(12),
  dueDate: plainDateSchema,
  amountFils: filsSchema.nullable(),
  chequeNo: z.string().trim().max(40).nullable(),
  bankName: z.string().trim().max(120).nullable(),
});
export type ChequeGridRowInput = z.infer<typeof chequeGridRowSchema>;

export const createContractSchema = z
  .object({
    unitId: uuidSchema,
    tenantId: uuidSchema,
    startDate: plainDateSchema,
    endDate: plainDateSchema,
    annualRentFils: filsSchema,
    chequeCount: chequeCountSchema,
    ejariNo: z.string().trim().max(60).nullable().default(null),
    notes: longText.default(''),
    /** Grid rows; when omitted the API generates the schedule with empty amounts. */
    cheques: z.array(chequeGridRowSchema).max(12).optional(),
  })
  .refine((c) => c.endDate >= c.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })
  .refine((c) => c.cheques === undefined || c.cheques.length === c.chequeCount, {
    message: 'cheques must have exactly chequeCount rows',
    path: ['cheques'],
  });
export type CreateContractInput = z.infer<typeof createContractSchema>;

export const updateContractSchema = z.object({
  tenantId: uuidSchema.optional(),
  startDate: plainDateSchema.optional(),
  endDate: plainDateSchema.optional(),
  annualRentFils: filsSchema.optional(),
  ejariNo: z.string().trim().max(60).nullable().optional(),
  notes: longText.optional(),
  cheques: z.array(chequeGridRowSchema).max(12).optional(),
});

/** Activating a draft. `reason` is required when the grid total differs from the annual rent. */
export const activateContractSchema = z.object({
  totalMismatchReason: auditReasonSchema.optional(),
});

// Cheques ------------------------------------------------------------------------------------

export const chequeStatusChangeSchema = z.object({
  to: chequeStatusSchema,
  note: longText.default(''),
  bounceReason: z.string().trim().max(500).optional(),
  /** Admin correction of a terminal status. */
  overrideReason: auditReasonSchema.optional(),
  /** Required when `to` is `replaced`: the replacement cheque created in the same transaction. */
  replacement: z
    .object({
      dueDate: plainDateSchema,
      amountFils: filsSchema,
      chequeNo: z.string().trim().min(1).max(40),
      bankName: z.string().trim().min(1).max(120),
    })
    .optional(),
});
export type ChequeStatusChangeInput = z.infer<typeof chequeStatusChangeSchema>;

export const bulkChequeStatusChangeSchema = z.object({
  chequeIds: z.array(uuidSchema).min(1).max(200),
  to: chequeStatusSchema.exclude(['replaced']),
  note: longText.default(''),
});

export const updateChequeSchema = z.object({
  dueDate: plainDateSchema.optional(),
  amountFils: filsSchema.nullable().optional(),
  chequeNo: z.string().trim().max(40).nullable().optional(),
  bankName: z.string().trim().max(120).nullable().optional(),
});

// Disputes -----------------------------------------------------------------------------------

export const createDisputeSchema = z.object({
  unitId: uuidSchema,
  contractId: uuidSchema.nullable().default(null),
  tenantId: uuidSchema.nullable().default(null),
  type: disputeTypeSchema,
  amountClaimedFils: filsNonNegativeSchema.nullable().default(null),
  nextHearingDate: plainDateSchema.nullable().default(null),
  notes: longText.default(''),
});
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;

export const updateDisputeSchema = z.object({
  status: disputeStatusSchema.optional(),
  amountClaimedFils: filsNonNegativeSchema.nullable().optional(),
  nextHearingDate: plainDateSchema.nullable().optional(),
  notes: longText.optional(),
});

export const createDisputeUpdateSchema = z.object({
  note: z.string().trim().min(1).max(5000),
  visibleToOwner: z.boolean().default(false),
});

// Staff --------------------------------------------------------------------------------------

export const inviteStaffSchema = z.object({
  email: emailSchema,
  name: shortText,
  role: staffRoleSchema,
});

export const updateStaffSchema = z.object({
  name: shortText.optional(),
  role: staffRoleSchema.optional(),
  active: z.boolean().optional(),
});
