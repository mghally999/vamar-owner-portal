/** Shared by every staff route file: role middlewares and the common param/query validators. */
import { zValidator } from '../../util/validator.js';
import { z } from 'zod';
import { chequeStatusSchema, uuidSchema } from '@vamar/shared';
import type { Context } from 'hono';
import { requireStaff } from '../../auth/middleware.js';
import type { AppEnv } from '../../env.js';
import { sortFrom, type SortChoice, type SortSpec } from '../../util/pagination.js';

export const idParam = zValidator('param', z.object({ id: uuidSchema }));
export const statusList = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
  .pipe(z.array(chequeStatusSchema).optional());

export const viewer = requireStaff('viewer');
export const editor = requireStaff('editor');
export const admin = requireStaff('admin');

/** `?sort=&dir=` of a sortable list, checked against the list's allow-list (422 otherwise). */
export function sortOf<K extends string>(c: Context<AppEnv>, spec: SortSpec<K>): SortChoice<K> {
  return sortFrom(spec, { sort: c.req.query('sort'), dir: c.req.query('dir') });
}
