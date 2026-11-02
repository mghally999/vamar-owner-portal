/** Staff API: disputes (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createDisputeUpdateSchema,
  createDisputeWithChequesSchema,
  disputeStatusSchema,
  paginationQuerySchema,
  setDisputeChequesSchema,
  updateDisputeSchema,
  uuidSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import {
  addDisputeUpdate,
  createDispute,
  getDisputeDetail,
  listDisputes,
  setDisputeCheques,
  updateDispute,
} from '../../services/disputes.js';
import { today } from '../../util/today.js';
import { editor, idParam, viewer } from './common.js';

export const disputesRoutes = new Hono<AppEnv>()
  .get(
    '/disputes',
    viewer,
    zValidator(
      'query',
      paginationQuerySchema.extend({
        status: disputeStatusSchema.optional(),
        unitId: uuidSchema.optional(),
        buildingId: uuidSchema.optional(),
        search: z.string().trim().max(80).optional(),
      }),
    ),
    async (c) => c.json(await listDisputes(readDb(c), c.req.valid('query'))),
  )
  .post('/disputes', editor, zValidator('json', createDisputeWithChequesSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createDispute(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('json'),
          Number(today(c.env).slice(0, 4)),
        ),
      ),
      201,
    ),
  )
  .get('/disputes/:id', viewer, idParam, async (c) =>
    c.json(await getDisputeDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch('/disputes/:id', editor, idParam, zValidator('json', updateDisputeSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateDispute(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .put(
    '/disputes/:id/cheques',
    editor,
    idParam,
    zValidator('json', setDisputeChequesSchema),
    async (c) =>
      c.json({
        items: await withTx(c, (tx) =>
          setDisputeCheques(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json').chequeIds,
          ),
        ),
      }),
  )
  .post(
    '/disputes/:id/updates',
    editor,
    idParam,
    zValidator('json', createDisputeUpdateSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          addDisputeUpdate(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        ),
        201,
      ),
  );
