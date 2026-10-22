/** Shared by every staff route file: role middlewares and the common param/query validators. */
import { zValidator } from '../../util/validator.js';
import { z } from 'zod';
import { chequeStatusSchema, uuidSchema } from '@vamar/shared';
import { requireStaff } from '../../auth/middleware.js';

export const idParam = zValidator('param', z.object({ id: uuidSchema }));
export const statusList = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
  .pipe(z.array(chequeStatusSchema).optional());

export const viewer = requireStaff('viewer');
export const editor = requireStaff('editor');
export const admin = requireStaff('admin');
