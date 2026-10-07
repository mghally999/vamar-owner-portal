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
