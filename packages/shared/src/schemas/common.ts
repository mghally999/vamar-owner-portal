import { z } from 'zod';
import { isPlainDate, type PlainDate } from '../dates.js';
import { MAX_CHEQUE_COUNT, MIN_CHEQUE_COUNT } from '../schedule.js';
import { TOTAL_SHARE_BP } from '../shares.js';

export const uuidSchema = z.uuid();

/** `YYYY-MM-DD`, validated as a real calendar date. */
export const plainDateSchema = z.string().refine((s): s is PlainDate => isPlainDate(s), {
  message: 'Expected a calendar date YYYY-MM-DD',
});

/** Integer fils, > 0. */
export const filsSchema = z.number().int().positive();

/** Integer fils, >= 0 (totals, claimed amounts). */
export const filsNonNegativeSchema = z.number().int().nonnegative();

/** E.164 phone number. UAE numbers are +9715XXXXXXXX; we accept any E.164 for staff flexibility. */
export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, { message: 'Phone must be in E.164 format, e.g. +971501234567' });

/** International calling codes of the countries an owner's sign-in phone may belong to. */
export const PHONE_COUNTRY_PREFIX: Readonly<Record<string, string>> = {
  AE: '+971',
  SA: '+966',
  QA: '+974',
  KW: '+965',
  BH: '+973',
  OM: '+968',
  EG: '+20',
  GB: '+44',
  US: '+1',
  IN: '+91',
  PK: '+92',
};

/** Mobile number shapes we check; a listed country without one only needs its prefix. */
const MOBILE_SHAPE: Readonly<Record<string, RegExp>> = { AE: /^\+9715\d{8}$/ };

/** `"AE, SA"` (the ALLOWED_PHONE_COUNTRIES variable) to `['AE', 'SA']`. */
export function parseCountryList(list: string): string[] {
  return list
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** Whether an E.164 phone is a mobile number of one of the countries (`*` allows any). */
export function phoneInCountries(phone: string, countries: readonly string[]): boolean {
  if (countries.includes('*')) return true;
  return countries.some((cc) => {
    const prefix = PHONE_COUNTRY_PREFIX[cc];
    if (!prefix || !phone.startsWith(prefix)) return false;
    return MOBILE_SHAPE[cc]?.test(phone) ?? true;
  });
}

export const UAE_MOBILE_MESSAGE =
  'Must be a UAE mobile number, e.g. +971501234567 · يجب أن يكون رقم جوال إماراتياً، مثل ‎+971501234567';

/**
 * An owner's phone is their sign-in identity, so it must be a mobile number of a country owners may
 * sign in from (the Worker's ALLOWED_PHONE_COUNTRIES; "AE" everywhere today). A number outside that
 * list could be saved but never used to sign in.
 */
export function ownerPhoneSchema(countries: readonly string[] = ['AE']) {
  const uaeOnly = countries.length === 1 && countries[0] === 'AE';
  return phoneE164Schema.refine((p) => phoneInCountries(p, countries), {
    message: uaeOnly
      ? UAE_MOBILE_MESSAGE
      : `Must be a mobile number from ${countries.join(', ')} · يجب أن يكون رقم جوال من ${countries.join('، ')}`,
  });
}

export const emailSchema = z.email().max(254);

export const shareBpSchema = z.number().int().min(1).max(TOTAL_SHARE_BP);

export const chequeCountSchema = z.number().int().min(MIN_CHEQUE_COUNT).max(MAX_CHEQUE_COUNT);

/** Short free text (names, labels). Trimmed, non-empty. */
export const shortText = z.string().trim().min(1).max(200);
/** Longer free text (notes). Trimmed, may be empty. */
export const longText = z.string().trim().max(5000);

/** `YYYY-MM` month key used by month switchers. */
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * Keyset pagination. The cursor is an opaque base64url string produced by the API that
 * encodes the (sortKey, id) of the last row. Lists never use OFFSET.
 */
export const paginationQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const auditReasonSchema = z.string().trim().min(3).max(500);
