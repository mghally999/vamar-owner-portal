/** Staff API: contracts (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  activateContractSchema,
  auditReasonSchema,
  contractStatusSchema,
  createContractSchema,
  paginationQuerySchema,
  updateContractSchema,
  uuidSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import {
  activateContract,
  createContract,
  getContractDetail,
  listContracts,
  renewContract,
  terminateContract,
  updateContract,
} from '../../services/contracts.js';
import { today } from '../../util/today.js';
import { editor, idParam, viewer } from './common.js';

export const contractsRoutes = new Hono<AppEnv>()
  .get(
    '/contracts',
    viewer,
    zValidator(
      'query',
      paginationQuerySchema.extend({
        status: contractStatusSchema.optional(),
        buildingId: uuidSchema.optional(),
        unitId: uuidSchema.optional(),
        endingWithinDays: z.coerce.number().int().min(1).max(365).optional(),
      }),
    ),
    async (c) => c.json(await listContracts(readDb(c), c.req.valid('query'), today(c.env))),
  )
  .post('/contracts', editor, zValidator('json', createContractSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createContract(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .get('/contracts/:id', viewer, idParam, async (c) =>
    c.json(await getContractDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch('/contracts/:id', editor, idParam, zValidator('json', updateContractSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateContract(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .post(
    '/contracts/:id/activate',
    editor,
    idParam,
    zValidator('json', activateContractSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          activateContract(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json').totalMismatchReason,
          ),
        ),
      ),
  )
  .post(
    '/contracts/:id/terminate',
    editor,
    idParam,
    zValidator('json', z.object({ reason: auditReasonSchema })),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          terminateContract(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json').reason,
          ),
        ),
      ),
  )
  .post('/contracts/:id/renew', editor, idParam, async (c) =>
    c.json(
      await withTx(c, (tx) =>
        renewContract(tx, actorFromContext(c, staffOf(c)), c.req.valid('param').id),
      ),
      201,
    ),
  );
