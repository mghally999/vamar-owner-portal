/** Staff API: owners (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  changeOwnerPhoneSchema,
  createOwnerSchema,
  ownerStatusSchema,
  paginationQuerySchema,
  updateOwnerSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import {
  createOwner,
  getOwnerDetail,
  listOwners,
  setOwnerStatus,
  updateOwner,
  changeOwnerPhone,
} from '../../services/owners.js';
import { admin, editor, idParam, viewer } from './common.js';

export const ownersRoutes = new Hono<AppEnv>()
  .get(
    '/owners',
    viewer,
    zValidator(
      'query',
      paginationQuerySchema.extend({
        search: z.string().trim().max(100).optional(),
        status: ownerStatusSchema.optional(),
      }),
    ),
    async (c) => c.json(await listOwners(readDb(c), c.req.valid('query'))),
  )
  .post('/owners', editor, zValidator('json', createOwnerSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createOwner(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .get('/owners/:id', viewer, idParam, async (c) =>
    c.json(await getOwnerDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch('/owners/:id', editor, idParam, zValidator('json', updateOwnerSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateOwner(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .post(
    '/owners/:id/phone',
    admin,
    idParam,
    zValidator('json', changeOwnerPhoneSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          changeOwnerPhone(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        ),
      ),
  )
  .post(
    '/owners/:id/status',
    editor,
    idParam,
    zValidator('json', z.object({ status: z.enum(['active', 'disabled']) })),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          setOwnerStatus(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json').status,
          ),
        ),
      ),
  );
