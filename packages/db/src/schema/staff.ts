import { boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, instant } from './_common.js';
import { staffRole } from './enums.js';

export const staffUsers = pgTable(
  'staff_users',
  {
    id: id(),
    firebaseUid: text().notNull().unique(),
    email: text().notNull().unique(),
    name: text().notNull(),
    role: staffRole().notNull().default('viewer'),
    /** TOTP secret encrypted with AES-GCM using a Worker secret; null until enrolled. */
    totpSecretEnc: text(),
    totpEnabled: boolean().notNull().default(false),
    /** 2-step login (TOTP) is mandatory for real staff; an admin can switch it off per account,
     *  which is used only for demo accounts during a client trial. */
    totpRequired: boolean().notNull().default(true),
    /** Consecutive TOTP failures; reset on success. Locked for 15 minutes after 5. */
    totpFailures: integer().notNull().default(0),
    totpLockedUntil: instant(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('staff_users_active_idx').on(t.active)],
);
