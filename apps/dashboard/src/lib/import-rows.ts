/**
 * Excel import, browser side: the fields of each sheet, how a cell becomes a value (phones to
 * E.164, Excel dates to YYYY-MM-DD, amounts typed as "63,000" to numbers) and how rows are batched.
 * The shared schemas then decide what is valid; the API checks again.
 */
import { z } from 'zod';
import {
  buildingIdentifiersSchema,
  createBuildingSchema,
  createOwnerSchema,
  createTenantSchema,
  createUnitSchema,
  importChequeRowSchema,
  importContractRowSchema,
  importShareRowSchema,
  parseAmountInput,
  PAYMENT_METHODS,
  UNIT_TYPES,
  unitIdentifiersSchema,
  unitKey,
} from '@vamar/shared';
import { chunk } from './batch';

export const IMPORT_TARGETS = [
  'owners',
  'buildings',
  'units',
  'tenants',
  'shares',
  'contracts',
  'cheques',
  'expenses',
] as const;
export type Target = (typeof IMPORT_TARGETS)[number];

export interface FieldSpec {
  key: string;
  label: { ar: string; en: string };
  required?: boolean;
}

const building: FieldSpec = {
  key: 'building',
  label: { ar: 'المبنى (الاسم)', en: 'Building (name)' },
  required: true,
};
const unitNo: FieldSpec = {
  key: 'unitNo',
  label: { ar: 'رقم الوحدة', en: 'Unit no.' },
  required: true,
};
const identifiers = {
  titleDeedNo: { key: 'titleDeedNo', label: { ar: 'رقم الصك', en: 'Title deed no.' } },
  plotNo: { key: 'plotNo', label: { ar: 'رقم قطعة الأرض', en: 'Plot no.' } },
  makaniNo: { key: 'makaniNo', label: { ar: 'رقم مكاني', en: 'Makani no.' } },
  dewaPremiseNo: {
    key: 'dewaPremiseNo',
    label: { ar: 'رقم حساب ديوا / سيوا', en: 'DEWA / SEWA account no.' },
  },
  municipalityNo: { key: 'municipalityNo', label: { ar: 'رقم البلدية', en: 'Municipality no.' } },
  handoverDate: { key: 'handoverDate', label: { ar: 'تاريخ التسليم', en: 'Handover date' } },
  completionYear: { key: 'completionYear', label: { ar: 'سنة الإنجاز', en: 'Completion year' } },
  floorsCount: { key: 'floorsCount', label: { ar: 'عدد الطوابق', en: 'Floors' } },
} satisfies Record<string, FieldSpec>;

export const FIELDS: Record<Target, FieldSpec[]> = {
  owners: [
    { key: 'nameAr', label: { ar: 'الاسم (عربي)', en: 'Name (Arabic)' }, required: true },
    { key: 'nameEn', label: { ar: 'الاسم (إنجليزي)', en: 'Name (English)' }, required: true },
    { key: 'phoneE164', label: { ar: 'الهاتف', en: 'Phone' }, required: true },
    { key: 'email', label: { ar: 'البريد', en: 'Email' } },
    { key: 'preferredLang', label: { ar: 'اللغة (ar/en)', en: 'Language (ar/en)' } },
  ],
  buildings: [
    { key: 'nameAr', label: { ar: 'اسم المبنى (عربي)', en: 'Building (Arabic)' }, required: true },
    {
      key: 'nameEn',
      label: { ar: 'اسم المبنى (إنجليزي)', en: 'Building (English)' },
      required: true,
    },
    { key: 'area', label: { ar: 'المنطقة', en: 'Area' }, required: true },
    { key: 'address', label: { ar: 'العنوان', en: 'Address' } },
    identifiers.plotNo,
    identifiers.makaniNo,
    identifiers.titleDeedNo,
    identifiers.completionYear,
    identifiers.floorsCount,
  ],
  units: [
    building,
    unitNo,
    { key: 'type', label: { ar: 'النوع', en: 'Type' } },
    { key: 'bedrooms', label: { ar: 'غرف النوم', en: 'Bedrooms' } },
    { key: 'sizeSqft', label: { ar: 'المساحة', en: 'Size (sq ft)' } },
    identifiers.titleDeedNo,
    identifiers.plotNo,
    identifiers.makaniNo,
    identifiers.dewaPremiseNo,
    identifiers.municipalityNo,
    identifiers.handoverDate,
  ],
  tenants: [
    { key: 'name', label: { ar: 'الاسم', en: 'Name' }, required: true },
    { key: 'phone', label: { ar: 'الهاتف', en: 'Phone' } },
    { key: 'email', label: { ar: 'البريد', en: 'Email' } },
    { key: 'company', label: { ar: 'الشركة', en: 'Company' } },
  ],
  shares: [
    building,
    unitNo,
    { key: 'ownerPhone', label: { ar: 'جوال المالك', en: 'Owner phone' }, required: true },
    { key: 'sharePct', label: { ar: 'الحصة %', en: 'Share %' }, required: true },
    { key: 'fromDate', label: { ar: 'من تاريخ', en: 'From date' } },
  ],
  contracts: [
    building,
    unitNo,
    { key: 'tenantName', label: { ar: 'المستأجر', en: 'Tenant' }, required: true },
    { key: 'tenantPhone', label: { ar: 'جوال المستأجر', en: 'Tenant phone' } },
    { key: 'startDate', label: { ar: 'تاريخ البداية', en: 'Start date' }, required: true },
    { key: 'endDate', label: { ar: 'تاريخ النهاية', en: 'End date' }, required: true },
    {
      key: 'annualRentAed',
      label: { ar: 'الإيجار السنوي (درهم)', en: 'Annual rent (AED)' },
      required: true,
    },
    { key: 'chequeCount', label: { ar: 'عدد الشيكات', en: 'Cheques' }, required: true },
    { key: 'ejariNo', label: { ar: 'رقم إيجاري', en: 'Ejari no.' } },
  ],
  cheques: [
    building,
    unitNo,
    {
      key: 'contractStart',
      label: { ar: 'بداية العقد', en: 'Contract start' },
      required: true,
    },
    { key: 'seq', label: { ar: 'رقم الشيك في العقد', en: 'Cheque # in contract' }, required: true },
    { key: 'dueDate', label: { ar: 'تاريخ الاستحقاق', en: 'Due date' }, required: true },
    { key: 'amountAed', label: { ar: 'المبلغ (درهم)', en: 'Amount (AED)' }, required: true },
    { key: 'chequeNo', label: { ar: 'رقم الشيك', en: 'Cheque no.' }, required: true },
    { key: 'bankName', label: { ar: 'البنك', en: 'Bank' }, required: true },
  ],
  expenses: [
    building,
    { key: 'unitNo', label: { ar: 'رقم الوحدة (اختياري)', en: 'Unit no. (optional)' } },
    { key: 'category', label: { ar: 'التصنيف', en: 'Category' }, required: true },
    { key: 'vendor', label: { ar: 'المورد', en: 'Vendor' } },
    { key: 'reasonAr', label: { ar: 'السبب (عربي)', en: 'Reason (Arabic)' }, required: true },
    { key: 'reasonEn', label: { ar: 'السبب (إنجليزي)', en: 'Reason (English)' }, required: true },
    { key: 'invoiceNo', label: { ar: 'رقم الفاتورة', en: 'Invoice no.' } },
    { key: 'invoiceDate', label: { ar: 'تاريخ الفاتورة', en: 'Invoice date' }, required: true },
    {
      key: 'amountAed',
      label: { ar: 'المبلغ قبل الضريبة (درهم)', en: 'Amount before VAT (AED)' },
      required: true,
    },
    { key: 'vatAed', label: { ar: 'الضريبة (درهم)', en: 'VAT (AED)' } },
    { key: 'paidOn', label: { ar: 'تاريخ الدفع', en: 'Paid on' } },
    { key: 'paymentMethod', label: { ar: 'طريقة الدفع', en: 'Payment method' } },
    {
      key: 'visibleToOwner',
      label: { ar: 'ظاهر للملاك (نعم/لا)', en: 'Visible to owners (yes/no)' },
    },
  ],
};

const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Expected a calendar date YYYY-MM-DD · تاريخ بصيغة YYYY-MM-DD',
});

const unitClientSchema = createUnitSchema
  .omit({ buildingId: true })
  .extend({ building: z.string().trim().min(1), type: z.enum(UNIT_TYPES).default('apartment') })
  .extend(unitIdentifiersSchema.shape);

const buildingClientSchema = createBuildingSchema.extend(buildingIdentifiersSchema.shape);

/** The Expenses sheet as the API expects it (.local/notes/import.md): amounts in AED, names not ids. */
export const importExpenseRowSchema = z.object({
  building: z.string().trim().min(1),
  unitNo: z.coerce.string().trim().min(1).max(30).optional(),
  category: z.string().trim().min(1),
  vendor: z.string().trim().min(1).optional(),
  reasonAr: z.string().trim().min(1).max(500),
  reasonEn: z.string().trim().min(1).max(500),
  invoiceNo: z.coerce.string().trim().max(60).optional(),
  invoiceDate: dateText,
  amountAed: z.number().positive().max(100_000_000).refine(twoDecimals, {
    message: 'At most two decimals (fils) · منزلتان عشريتان كحد أقصى',
  }),
  vatAed: z
    .number()
    .min(0)
    .max(100_000_000)
    .refine(twoDecimals, {
      message: 'At most two decimals (fils) · منزلتان عشريتان كحد أقصى',
    })
    .optional(),
  paidOn: dateText.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  visibleToOwner: z.boolean().optional(),
});

export const SCHEMAS: Record<Target, z.ZodType> = {
  owners: createOwnerSchema,
  buildings: buildingClientSchema,
  units: unitClientSchema,
  tenants: createTenantSchema,
  shares: importShareRowSchema,
  contracts: importContractRowSchema,
  cheques: importChequeRowSchema,
  expenses: importExpenseRowSchema,
};

const PHONE_KEYS = new Set(['phoneE164', 'phone', 'ownerPhone', 'tenantPhone']);
const DATE_KEYS = new Set([
  'fromDate',
  'startDate',
  'endDate',
  'contractStart',
  'dueDate',
  'invoiceDate',
  'paidOn',
  'handoverDate',
]);
const AMOUNT_KEYS = new Set(['annualRentAed', 'amountAed', 'vatAed']);
const NUMBER_KEYS = new Set([
  'bedrooms',
  'sizeSqft',
  'chequeCount',
  'seq',
  'completionYear',
  'floorsCount',
]);
const TEXT_KEYS = new Set([
  'unitNo',
  'chequeNo',
  'ejariNo',
  'invoiceNo',
  'titleDeedNo',
  'plotNo',
  'makaniNo',
  'dewaPremiseNo',
  'municipalityNo',
]);
const BOOLEAN_KEYS = new Set(['visibleToOwner']);

const LANGUAGES: Record<string, 'ar' | 'en'> = {
  ar: 'ar',
  arabic: 'ar',
  عربي: 'ar',
  العربية: 'ar',
  en: 'en',
  english: 'en',
  إنجليزي: 'en',
  الإنجليزية: 'en',
};

const YES = new Set(['true', 'yes', 'y', '1', 'نعم']);
const NO = new Set(['false', 'no', 'n', '0', 'لا']);

const PAYMENT_WORDS: Record<string, (typeof PAYMENT_METHODS)[number]> = {
  cash: 'cash',
  نقدا: 'cash',
  نقداً: 'cash',
  cheque: 'cheque',
  check: 'cheque',
  شيك: 'cheque',
  transfer: 'transfer',
  تحويل: 'transfer',
  card: 'card',
  بطاقة: 'card',
};

/** Excel stores dates as days since 1899-12-30; SheetJS hands them over as numbers. */
export function excelSerialToDate(serial: number): string {
  const ms = Math.round(serial * 86_400_000) + Date.UTC(1899, 11, 30);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Normalise one cell for a field; empty cells become undefined (field left out). */
export function coerce(key: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  let v: unknown = typeof raw === 'string' ? raw.trim() : raw;
  if (v === '') return undefined;
  if (PHONE_KEYS.has(key)) {
    const digits = cellText(v).replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) v = digits;
    else if (digits.startsWith('00')) v = `+${digits.slice(2)}`;
    else if (digits.startsWith('971')) v = `+${digits}`;
    else if (digits.startsWith('0')) v = `+971${digits.slice(1)}`;
    else v = `+971${digits}`;
  }
  if (DATE_KEYS.has(key)) {
    if (typeof v === 'number') v = excelSerialToDate(v);
    else if (v instanceof Date) v = v.toISOString().slice(0, 10);
  }
  if (AMOUNT_KEYS.has(key) && typeof v === 'string') {
    const fils = parseAmountInput(v);
    v = fils === null ? v : fils / 100;
  }
  if (key === 'sharePct' && typeof v === 'string') {
    const n = Number(v.replace('%', '').replace('٪', '').trim());
    v = Number.isFinite(n) ? n : v;
  }
  if (NUMBER_KEYS.has(key)) v = Number(v);
  if (TEXT_KEYS.has(key)) v = cellText(v);
  if (key === 'type' && typeof v === 'string') v = v.toLowerCase();
  if (key === 'paymentMethod' && typeof v === 'string') v = PAYMENT_WORDS[v.toLowerCase()] ?? v;
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof v === 'boolean') return v;
    const word = cellText(v).toLowerCase();
    v = YES.has(word) ? true : NO.has(word) ? false : v;
  }
  // Only known spellings map to a language; anything else stays as typed so it is refused.
  if (key === 'preferredLang' && typeof v === 'string') v = LANGUAGES[v.toLowerCase()] ?? v;
  return v;
}

/** Text for a spreadsheet cell: SheetJS gives strings, numbers, booleans or Date objects. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return JSON.stringify(v);
}

/** Shape one sheet row with the column mapping. */
export function shapeRow(
  target: Target,
  mapping: Record<string, string>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of FIELDS[target]) {
    const col = mapping[f.key];
    if (col) {
      const v = coerce(f.key, row[col]);
      if (v !== undefined) data[f.key] = v;
    }
  }
  return data;
}

/**
 * Batches for the commit requests. The shares of one unit must arrive together (they have to add
 * up to 100 %), so a batch never splits a unit; the other sheets are cut every `size` rows.
 */
export function importBatches<T extends { data: Record<string, unknown> }>(
  target: Target,
  rows: T[],
  size: number,
): T[][] {
  if (target !== 'shares') return chunk(rows, size);
  const byUnit = new Map<string, T[]>();
  for (const r of rows) {
    const key = unitKey(cellText(r.data['building']), cellText(r.data['unitNo']));
    byUnit.set(key, [...(byUnit.get(key) ?? []), r]);
  }
  const batches: T[][] = [];
  let current: T[] = [];
  for (const group of byUnit.values()) {
    if (current.length > 0 && current.length + group.length > size) {
      batches.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length) batches.push(current);
  return batches;
}

/** First 16 hex digits of the file's SHA-256: the same file always gets the same import key. */
export async function fileFingerprint(buf: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
