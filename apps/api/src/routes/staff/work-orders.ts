/** Staff API: work orders (mounted by ../staff.ts). Photos go through /attachments with entityType work_order. */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import {
  createWorkOrderSchema,
  updateWorkOrderSchema,
  workOrderListQuerySchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import { queueWorkOrderDoneAlert } from '../../services/notifications.js';
import {
  createWorkOrder,
  getWorkOrderDetail,
  listWorkOrders,
  updateWorkOrder,
} from '../../services/work-orders.js';
import { today } from '../../util/today.js';
import { editor, idParam, viewer } from './common.js';

export const workOrdersRoutes = new Hono<AppEnv>()
  .get('/work-orders', viewer, zValidator('query', workOrderListQuerySchema), async (c) =>
    c.json(await listWorkOrders(readDb(c), c.req.valid('query'))),
  )
  .post('/work-orders', editor, zValidator('json', createWorkOrderSchema), async (c) => {
    const row = await withTx(c, (tx) =>
      createWorkOrder(tx, actorFromContext(c, staffOf(c)), c.req.valid('json'), today(c.env)),
    );
    if (row.status === 'done') c.executionCtx.waitUntil(queueWorkOrderDoneAlert(c.env, row.id));
    return c.json(row, 201);
  })
  .get('/work-orders/:id', viewer, idParam, async (c) =>
    c.json(await getWorkOrderDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch(
    '/work-orders/:id',
    editor,
    idParam,
    zValidator('json', updateWorkOrderSchema),
    async (c) => {
      const result = await withTx(c, (tx) =>
        updateWorkOrder(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      );
      if (result.justDone) c.executionCtx.waitUntil(queueWorkOrderDoneAlert(c.env, result.row.id));
      return c.json(result.row);
    },
  );
