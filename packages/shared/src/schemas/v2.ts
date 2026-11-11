/**
 * Input schemas for the v2 features: periods and reports, expenses and their categories, vendors
 * and recurring rules, work orders, property records, calendar events, holidays, settings and
 * the dispute-to-cheque links. Every API body, query and param goes through one of these.
 */
import { z } from 'zod';
import {
  MAX_REPAIR_APPROVAL_SILENCE_DAYS,
  REPAIR_APPROVAL_DECISIONS,
  REPAIR_APPROVAL_STATUSES,
} from '../approvals.js';
import { CALENDAR_EVENT_TYPES, CALENDAR_ITEM_KINDS } from '../calendar.js';
import { diffDays } from '../dates.js';
import {
  ALLOCATION_METHODS,
  EXPENSE_KINDS,
  EXPENSE_SCOPES,
  EXPENSE_STATUSES,
  MANUAL_UNIT_STATUSES,
  PAYMENT_METHODS,
  RECURRING_FREQUENCIES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
} from '../expenses.js';
import { PERIOD_PRESETS, WEEK_STARTS } from '../periods.js';
import { createDisputeSchema } from './entities.js';
import {
  auditReasonSchema,
  emailSchema,
  filsNonNegativeSchema,
  filsSchema,
  longText,
  paginationQuerySchema,
  phoneE164Schema,
  plainDateSchema,
  shortText,
  uuidSchema,
} from './common.js';

// Enums --------------------------------------------------------------------------------------

export const expenseKindSchema = z.enum(EXPENSE_KINDS);
export const expenseScopeSchema = z.enum(EXPENSE_SCOPES);
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export const allocationMethodSchema = z.enum(ALLOCATION_METHODS);
export const recurringFrequencySchema = z.enum(RECURRING_FREQUENCIES);
export const workOrderPrioritySchema = z.enum(WORK_ORDER_PRIORITIES);
export const workOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);
export const manualUnitStatusSchema = z.enum(MANUAL_UNIT_STATUSES);
export const calendarEventTypeSchema = z.enum(CALENDAR_EVENT_TYPES);
export const calendarItemKindSchema = z.enum(CALENDAR_ITEM_KINDS);
export const periodPresetSchema = z.enum(PERIOD_PRESETS);
export const weekStartSchema = z.enum(WEEK_STARTS);
export const repairApprovalStatusSchema = z.enum(REPAIR_APPROVAL_STATUSES);

/** List filter: jobs still held back by a pending or rejected owner answer. */
const approvalFilter = z.literal('awaiting').optional();

// Periods and reports ------------------------------------------------------------------------

/** A period spans at most five years, so a report never scans a decade by mistake. */
export const MAX_PERIOD_DAYS = 366 * 5;

export const periodQuerySchema = z
  .object({
    preset: periodPresetSchema.optional(),
    from: plainDateSchema.optional(),
    to: plainDateSchema.optional(),
  })
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: 'from and to go together',
    path: ['to'],
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.to >= q.from, {
    message: 'to must be on or after from',
    path: ['to'],
  })
  .refine(
    (q) => q.from === undefined || q.to === undefined || diffDays(q.from, q.to) < MAX_PERIOD_DAYS,
    { message: 'Period is too long', path: ['to'] },
  );
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

const flag = z
  .enum(['1', '0', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

export const reportFiltersSchema = z.object({
  buildingId: uuidSchema.optional(),
  unitId: uuidSchema.optional(),
  ownerId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  kind: expenseKindSchema.optional(),
  compare: flag,
});
export const reportQuerySchema = periodQuerySchema.and(reportFiltersSchema);
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const ownerSummaryQuerySchema = periodQuerySchema.and(
  z.object({ buildingId: uuidSchema.optional(), unitId: uuidSchema.optional(), compare: flag }),
);

// Categories and vendors ---------------------------------------------------------------------

export const createExpenseCategorySchema = z.object({
  nameAr: shortText,
  nameEn: shortText,
  kind: expenseKindSchema,
  parentId: uuidSchema.nullable().default(null),
  sort: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
export const updateExpenseCategorySchema = createExpenseCategorySchema.partial();

/** UAE VAT registration numbers are 15 digits. */
export const trnSchema = z
  .string()
  .trim()
  .regex(/^\d{15}$/, { message: 'TRN must be 15 digits · رقم التسجيل الضريبي 15 رقماً' });

export const createVendorSchema = z.object({
  name: shortText,
  phone: phoneE164Schema.nullable().default(null),
  email: emailSchema.nullable().default(null),
  trn: trnSchema.nullable().default(null),
  notes: longText.default(''),
  active: z.boolean().default(true),
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export const updateVendorSchema = createVendorSchema.partial();

// Expenses -----------------------------------------------------------------------------------

const reasonText = z.string().trim().min(1).max(500);
const invoiceNoText = z.string().trim().min(1).max(60);

const expenseBase = {
  scope: expenseScopeSchema,
  buildingId: uuidSchema,
  unitId: uuidSchema.nullable(),
  categoryId: uuidSchema,
  vendorId: uuidSchema.nullable(),
  reasonAr: reasonText,
  reasonEn: reasonText,
  invoiceNo: invoiceNoText.nullable(),
  invoiceDate: plainDateSchema,
  coversFrom: plainDateSchema.nullable(),
  coversTo: plainDateSchema.nullable(),
  amountFils: filsSchema,
  vatFils: filsNonNegativeSchema,
  paidOn: plainDateSchema.nullable(),
  paymentMethod: paymentMethodSchema.nullable(),
  /** Omitted: by_area when every unit has a size, otherwise equal_units; single_unit for a unit. */
  allocationMethod: allocationMethodSchema.optional(),
  visibleToOwner: z.boolean(),
  disputeId: uuidSchema.nullable(),
  workOrderId: uuidSchema.nullable(),
};

const expenseFields = {
  ...expenseBase,
  unitId: expenseBase.unitId.default(null),
  vendorId: expenseBase.vendorId.default(null),
  invoiceNo: expenseBase.invoiceNo.default(null),
  coversFrom: expenseBase.coversFrom.default(null),
  coversTo: expenseBase.coversTo.default(null),
  /** Omitted: 5 % when the vendor has a TRN, otherwise 0. */
  vatFils: expenseBase.vatFils.optional(),
  paidOn: expenseBase.paidOn.default(null),
  paymentMethod: expenseBase.paymentMethod.default(null),
  visibleToOwner: expenseBase.visibleToOwner.default(true),
  disputeId: expenseBase.disputeId.default(null),
  workOrderId: expenseBase.workOrderId.default(null),
};

function scopeRules<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema
    .refine(
      (e) => !('scope' in e) || e['scope'] !== 'unit' || ('unitId' in e && e['unitId'] !== null),
      { message: 'A unit expense needs a unit', path: ['unitId'] },
    )
    .refine(
      (e) => {
        const from = 'coversFrom' in e ? (e['coversFrom'] as string | null) : null;
        const to = 'coversTo' in e ? (e['coversTo'] as string | null) : null;
        return from === null || to === null || to >= from;
      },
      { message: 'coversTo must be on or after coversFrom', path: ['coversTo'] },
    )
    .refine(
      (e) => {
        const scope = 'scope' in e ? e['scope'] : undefined;
        const method = 'allocationMethod' in e ? e['allocationMethod'] : undefined;
        if (method === undefined) return true;
        return scope === 'unit' ? method === 'single_unit' : method !== 'single_unit';
      },
      {
        message: 'single_unit is for unit expenses, the other methods for building expenses',
        path: ['allocationMethod'],
      },
    );
}

export const createExpenseSchema = scopeRules(z.object(expenseFields));
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/** Drafts can be edited freely; a posted expense is voided and re-posted instead. */
export const updateExpenseSchema = scopeRules(z.object(expenseBase).partial());
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const voidExpenseSchema = z.object({ reason: auditReasonSchema });

export const expenseListQuerySchema = paginationQuerySchema
  .extend({
    buildingId: uuidSchema.optional(),
    unitId: uuidSchema.optional(),
    categoryId: uuidSchema.optional(),
    vendorId: uuidSchema.optional(),
    kind: expenseKindSchema.optional(),
    status: expenseStatusSchema.optional(),
    search: z.string().trim().max(80).optional(),
    recurringRuleId: uuidSchema.optional(),
    disputeId: uuidSchema.optional(),
    approval: approvalFilter,
  })
  .and(periodQuerySchema);

export const ownerExpenseListQuerySchema = paginationQuerySchema
  .extend({
    buildingId: uuidSchema.optional(),
    unitId: uuidSchema.optional(),
    categoryId: uuidSchema.optional(),
    kind: expenseKindSchema.optional(),
  })
  .and(periodQuerySchema);

/** Preview the owners' shares before posting (same inputs as the allocation itself). */
export const allocationPreviewSchema = z.object({
  scope: expenseScopeSchema,
  buildingId: uuidSchema,
  unitId: uuidSchema.nullable().default(null),
  invoiceDate: plainDateSchema,
  totalFils: filsSchema,
  allocationMethod: allocationMethodSchema.optional(),
});

// Recurring rules ----------------------------------------------------------------------------

const ruleBase = {
  scope: expenseScopeSchema,
  buildingId: uuidSchema,
  unitId: uuidSchema.nullable(),
  categoryId: uuidSchema,
  vendorId: uuidSchema.nullable(),
  reasonAr: reasonText,
  reasonEn: reasonText,
  amountFils: filsSchema,
  vatFils: filsNonNegativeSchema,
  frequency: recurringFrequencySchema,
  dayOfMonth: z.number().int().min(1).max(31),
  startDate: plainDateSchema,
  endDate: plainDateSchema.nullable(),
  allocationMethod: allocationMethodSchema.optional(),
  visibleToOwner: z.boolean(),
  active: z.boolean(),
};

const ruleFields = {
  ...ruleBase,
  unitId: ruleBase.unitId.default(null),
  vendorId: ruleBase.vendorId.default(null),
  vatFils: ruleBase.vatFils.optional(),
  endDate: ruleBase.endDate.default(null),
  visibleToOwner: ruleBase.visibleToOwner.default(true),
  active: ruleBase.active.default(true),
};

export const createRecurringRuleSchema = scopeRules(z.object(ruleFields)).refine(
  (r) => r.endDate === null || r.endDate >= r.startDate,
  { message: 'endDate must be on or after startDate', path: ['endDate'] },
);
export type CreateRecurringRuleInput = z.infer<typeof createRecurringRuleSchema>;
export const updateRecurringRuleSchema = scopeRules(z.object(ruleBase).partial());

// Work orders --------------------------------------------------------------------------------

const workOrderBase = {
  buildingId: uuidSchema,
  unitId: uuidSchema.nullable(),
  titleAr: shortText,
  titleEn: shortText,
  description: longText,
  priority: workOrderPrioritySchema,
  status: workOrderStatusSchema,
  reportedOn: plainDateSchema.optional(),
  scheduledFor: plainDateSchema.nullable(),
  vendorId: uuidSchema.nullable(),
  expenseId: uuidSchema.nullable(),
  visibleToOwner: z.boolean(),
  /** What the job is expected to cost; at or above the threshold the owners are asked first. */
  estimateFils: filsSchema.nullable(),
};

const workOrderFields = {
  ...workOrderBase,
  unitId: workOrderBase.unitId.default(null),
  description: workOrderBase.description.default(''),
  priority: workOrderBase.priority.default('normal'),
  status: workOrderBase.status.default('open'),
  scheduledFor: workOrderBase.scheduledFor.default(null),
  vendorId: workOrderBase.vendorId.default(null),
  expenseId: workOrderBase.expenseId.default(null),
  visibleToOwner: workOrderBase.visibleToOwner.default(true),
  estimateFils: workOrderBase.estimateFils.default(null),
};
export const createWorkOrderSchema = z.object(workOrderFields);
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export const updateWorkOrderSchema = z.object(workOrderBase).partial();

export const workOrderListQuerySchema = paginationQuerySchema.extend({
  buildingId: uuidSchema.optional(),
  unitId: uuidSchema.optional(),
  status: workOrderStatusSchema.optional(),
  priority: workOrderPrioritySchema.optional(),
  vendorId: uuidSchema.optional(),
  search: z.string().trim().max(80).optional(),
  /** `1`: still open and past the scheduled date (the Today panel's link). */
  overdue: z.literal('1').optional(),
  approval: approvalFilter,
});

// Owner approval of large repairs ------------------------------------------------------------

/** The owner's answer; the note is optional either way. */
export const answerApprovalSchema = z.object({
  decision: z.enum(REPAIR_APPROVAL_DECISIONS),
  note: z.string().trim().max(500).nullable().default(null),
});
export type AnswerApprovalInput = z.infer<typeof answerApprovalSchema>;

/** An admin lets the job go ahead over pending or rejected answers; the reason is audited. */
export const overrideApprovalsSchema = z.object({ reason: auditReasonSchema });

export const ownerApprovalListQuerySchema = z.object({
  status: repairApprovalStatusSchema.optional(),
  workOrderId: uuidSchema.optional(),
});

// Property records ---------------------------------------------------------------------------

const identifier = z.string().trim().min(1).max(60).nullable();

export const unitIdentifiersSchema = z.object({
  titleDeedNo: identifier.optional(),
  plotNo: identifier.optional(),
  makaniNo: z
    .string()
    .trim()
    .regex(/^\d{10}$/, { message: 'Makani numbers are 10 digits · رقم مكاني 10 أرقام' })
    .nullable()
    .optional(),
  dewaPremiseNo: identifier.optional(),
  municipalityNo: identifier.optional(),
  handoverDate: plainDateSchema.nullable().optional(),
});
export type UnitIdentifiersInput = z.infer<typeof unitIdentifiersSchema>;

export const buildingIdentifiersSchema = z.object({
  plotNo: identifier.optional(),
  makaniNo: z
    .string()
    .trim()
    .regex(/^\d{10}$/, { message: 'Makani numbers are 10 digits · رقم مكاني 10 أرقام' })
    .nullable()
    .optional(),
  titleDeedNo: identifier.optional(),
  completionYear: z.number().int().min(1950).max(2100).nullable().optional(),
  floorsCount: z.number().int().min(0).max(300).nullable().optional(),
});
export type BuildingIdentifiersInput = z.infer<typeof buildingIdentifiersSchema>;

export const setUnitStatusSchema = z.object({
  status: manualUnitStatusSchema,
  reason: auditReasonSchema,
});
export type SetUnitStatusInput = z.infer<typeof setUnitStatusSchema>;

export const timelineQuerySchema = paginationQuerySchema.extend({
  kinds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
    .pipe(
      z
        .array(
          z.enum([
            'status',
            'contract',
            'tenant',
            'cheque',
            'expense',
            'work_order',
            'dispute',
            'ownership',
          ]),
        )
        .optional(),
    ),
});
export type TimelineKind = NonNullable<z.infer<typeof timelineQuerySchema>['kinds']>[number];

// Calendar -----------------------------------------------------------------------------------

const instant = z.iso.datetime({ offset: true });

const eventBase = {
  titleAr: shortText,
  titleEn: shortText,
  startsAt: instant,
  endsAt: instant,
  allDay: z.boolean(),
  type: calendarEventTypeSchema,
  buildingId: uuidSchema.nullable(),
  unitId: uuidSchema.nullable(),
  ownerId: uuidSchema.nullable(),
  visibleToOwner: z.boolean(),
  notes: longText,
};

const eventFields = {
  ...eventBase,
  allDay: eventBase.allDay.default(false),
  type: eventBase.type.default('other'),
  buildingId: eventBase.buildingId.default(null),
  unitId: eventBase.unitId.default(null),
  ownerId: eventBase.ownerId.default(null),
  visibleToOwner: eventBase.visibleToOwner.default(false),
  notes: eventBase.notes.default(''),
};

export const createCalendarEventSchema = z
  .object(eventFields)
  .refine((e) => Date.parse(e.endsAt) >= Date.parse(e.startsAt), {
    message: 'endsAt must be on or after startsAt',
    path: ['endsAt'],
  });
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;
export const updateCalendarEventSchema = z.object(eventBase).partial();

/** At most about 13 months per request: a year view plus the padding days around it. */
export const MAX_CALENDAR_RANGE_DAYS = 400;

export const calendarRangeQuerySchema = z
  .object({
    from: plainDateSchema,
    to: plainDateSchema,
    buildingId: uuidSchema.optional(),
    unitId: uuidSchema.optional(),
    ownerId: uuidSchema.optional(),
    kinds: z
      .string()
      .optional()
      .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
      .pipe(z.array(calendarItemKindSchema).optional()),
  })
  .refine((q) => q.to >= q.from, { message: 'to must be on or after from', path: ['to'] })
  .refine((q) => diffDays(q.from, q.to) <= MAX_CALENDAR_RANGE_DAYS, {
    message: 'Range is too long',
    path: ['to'],
  });
export type CalendarRangeQuery = z.infer<typeof calendarRangeQuerySchema>;

export const holidaySchema = z.object({
  date: plainDateSchema,
  nameAr: shortText,
  nameEn: shortText,
  /** Moon-sighting holidays stay tentative until the cabinet announces them. */
  tentative: z.boolean().default(false),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

// Settings -----------------------------------------------------------------------------------

export const updateSettingsSchema = z.object({
  weekStart: weekStartSchema.optional(),
  hijriDisplay: z.boolean().optional(),
  showBeforeFeeLabel: z.boolean().optional(),
  largeExpenseAlertFils: filsNonNegativeSchema.optional(),
  ownersSeeInvoiceFiles: z.boolean().optional(),
  repairApprovalThresholdFils: filsNonNegativeSchema.optional(),
  repairApprovalSilenceDays: z
    .number()
    .int()
    .min(0)
    .max(MAX_REPAIR_APPROVAL_SILENCE_DAYS)
    .optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// Disputes and cheques -----------------------------------------------------------------------

export const setDisputeChequesSchema = z.object({
  chequeIds: z.array(uuidSchema).max(50),
});

/** A case opened with the cheques it is about; a bounced-cheque case needs at least one. */
export const createDisputeWithChequesSchema = createDisputeSchema
  .extend({ chequeIds: z.array(uuidSchema).max(50).default([]) })
  .refine((d) => d.type !== 'bounced_cheque' || d.chequeIds.length > 0, {
    message:
      'A bounced-cheque case needs at least one cheque · قضية الشيك المرتجع تحتاج شيكاً واحداً على الأقل',
    path: ['chequeIds'],
  });

/** Dashboard search box (Ctrl+K): owner, phone, unit, deed, Makani, cheque, case or invoice. */
export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
