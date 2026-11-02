/**
 * Rows of the import sheets that need more than one record: ownership shares, contracts and
 * their cheques. The dashboard checks rows with these schemas before sending them and the API
 * checks them again. Amounts are typed in AED in the sheet and stored as integer fils.
 */
import { z } from 'zod';
import { FILS_PER_AED } from '../money.js';
import { TOTAL_SHARE_BP } from '../shares.js';
import {
  chequeCountSchema,
  ownerPhoneSchema,
  phoneE164Schema,
  plainDateSchema,
  shortText,
} from './common.js';
import { paymentMethodSchema } from './v2.js';

/** Unit numbers arrive as numbers (1204) or text (G-02) from a sheet; both become text. */
const unitNoText = z.coerce.string().trim().min(1).max(30);

const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

/** An amount typed in AED, at most two decimals. */
export const aedAmountSchema = z.number().positive().max(100_000_000).refine(twoDecimals, {
  message: 'At most two decimals (fils) · منزلتان عشريتان كحد أقصى',
});

/** AED (two decimals at most) to integer fils. */
export function aedAmountToFils(aed: number): number {
  return Math.round(aed * FILS_PER_AED);
}

/** A share in percent as typed in the sheet (60, 33.33), to basis points (6000, 3333). */
export const sharePctSchema = z
  .number()
  .positive()
  .max(100)
  .refine(twoDecimals, { message: 'At most two decimals · منزلتان عشريتان كحد أقصى' });

export function sharePctToBp(pct: number): number {
  return Math.round((pct * TOTAL_SHARE_BP) / 100);
}

/** Rows of one unit belong together; the key ignores case and spacing differences. */
export function unitKey(building: string, unitNo: string | number): string {
  return `${building.trim().toLowerCase()}|${String(unitNo).trim().toLowerCase()}`;
}

export const importShareRowSchema = z.object({
  building: shortText,
  unitNo: unitNoText,
  ownerPhone: ownerPhoneSchema(),
  sharePct: sharePctSchema,
  fromDate: plainDateSchema.optional(),
});
export type ImportShareRow = z.infer<typeof importShareRowSchema>;

export const importContractRowSchema = z
  .object({
    building: shortText,
    unitNo: unitNoText,
    tenantName: shortText,
    tenantPhone: phoneE164Schema.optional(),
    startDate: plainDateSchema,
    endDate: plainDateSchema,
    annualRentAed: aedAmountSchema,
    chequeCount: chequeCountSchema,
    ejariNo: z.coerce.string().trim().max(60).optional(),
  })
  .refine((r) => r.endDate >= r.startDate, {
    message: 'endDate must be on or after startDate · تاريخ النهاية بعد تاريخ البداية',
    path: ['endDate'],
  });
export type ImportContractRow = z.infer<typeof importContractRowSchema>;

export const importChequeRowSchema = z.object({
  building: shortText,
  unitNo: unitNoText,
  /** Start date of the contract the cheque belongs to (one contract per unit and start date). */
  contractStart: plainDateSchema,
  seq: z.number().int().min(1).max(12),
  dueDate: plainDateSchema,
  amountAed: aedAmountSchema,
  chequeNo: z.coerce.string().trim().min(1).max(40),
  bankName: z.string().trim().min(1).max(120),
});
export type ImportChequeRow = z.infer<typeof importChequeRowSchema>;

/** A yes/no cell as staff type it: true/false, yes/no, 1/0, نعم/لا (blank means the default). */
export const yesNoCellSchema = z
  .union([z.boolean(), z.number(), z.string()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const t = v.trim().toLowerCase();
    if (t === '') return undefined;
    if (['true', 'yes', 'y', '1', 'نعم'].includes(t)) return true;
    if (['false', 'no', 'n', '0', 'لا'].includes(t)) return false;
    ctx.addIssue({ code: 'custom', message: 'Use yes or no · اكتب نعم أو لا' });
    return z.NEVER;
  });

/** Optional text cell: numbers (an invoice number typed as 1234) become text; blank is absent. */
const optionalCellText = (max: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : String(v).trim()))
    .pipe(z.string().max(max).optional())
    .transform((v) => (v === '' ? undefined : v));

/** VAT typed in AED, zero allowed; blank means "5 % when the vendor has a TRN, else 0". */
export const aedVatSchema = z.number().min(0).max(100_000_000).refine(twoDecimals, {
  message: 'At most two decimals (fils) · منزلتان عشريتان كحد أقصى',
});

export const importExpenseRowSchema = z.object({
  building: shortText,
  unitNo: unitNoText.optional(),
  /** English or Arabic name of an active expense category. */
  category: shortText,
  vendor: optionalCellText(200),
  reasonAr: z.string().trim().min(1).max(500),
  reasonEn: z.string().trim().min(1).max(500),
  invoiceNo: optionalCellText(60),
  invoiceDate: plainDateSchema,
  amountAed: aedAmountSchema,
  vatAed: aedVatSchema.optional(),
  paidOn: plainDateSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  visibleToOwner: yesNoCellSchema,
});
export type ImportExpenseRow = z.infer<typeof importExpenseRowSchema>;
