/** Staff API: staff users and the audit log (admin only). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  inviteStaffSchema,
  paginationQuerySchema,
  plainDateSchema,
  updateStaffSchema,
  uuidSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { isDemoTrial } from '../../config.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import {
  inviteStaff,
  listStaff,
  queryAudit,
  resetStaffTotp,
  updateStaff,
} from '../../services/staff.js';
import { admin, idParam } from './common.js';

export const staffUsersRoutes = new Hono<AppEnv>()
  .get('/staff', admin, async (c) => c.json({ items: await listStaff(readDb(c)) }))
  .post('/staff', admin, zValidator('json', inviteStaffSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        inviteStaff(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .patch('/staff/:id', admin, idParam, zValidator('json', updateStaffSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateStaff(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
          { demoTrial: isDemoTrial(c.env) },
        ),
      ),
    ),
  )
  .post('/staff/:id/reset-totp', admin, idParam, async (c) => {
    await withTx(c, (tx) =>
      resetStaffTotp(tx, actorFromContext(c, staffOf(c)), c.req.valid('param').id),
    );
    return c.json({ ok: true });
  })
  .get(
    '/audit',
    admin,
    zValidator(
      'query',
      paginationQuerySchema.extend({
        actorId: uuidSchema.optional(),
        entityType: z.string().max(40).optional(),
        entityId: uuidSchema.optional(),
        action: z.string().max(60).optional(),
        from: plainDateSchema.optional(),
        to: plainDateSchema.optional(),
      }),
    ),
    async (c) => c.json(await queryAudit(readDb(c), c.req.valid('query'))),
  );
