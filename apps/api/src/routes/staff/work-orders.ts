/** Staff API: work orders (mounted by ../staff.ts). Photos go through /attachments with entityType work_order. */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import {
  createWorkOrderSchema,
  overrideApprovalsSchema,
  updateWorkOrderSchema,
  workOrderListQuerySchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { queueApprovalRequests } from '../../services/approval-notifications.js';
import { overrideApprovals, staffApprovals } from '../../services/approvals.js';
import { actorFromContext } from '../../services/audit.js';
import { queueWorkOrderDoneAlert } from '../../services/notifications.js';
import { getSettings } from '../../services/settings.js';
import {
  createWorkOrder,
  getWorkOrderDetail,
  listWorkOrders,
  updateWorkOrder,
} from '../../services/work-orders.js';
import { today } from '../../util/today.js';
import { admin, editor, idParam, viewer } from './common.js';

export const workOrdersRoutes = new Hono<AppEnv>()
  .get('/work-orders', viewer, zValidator('query', workOrderListQuerySchema), async (c) => {
    const { overdue, ...q } = c.req.valid('query');
    return c.json(
      await listWorkOrders(readDb(c), {
        ...q,
        overdueBefore: overdue ? today(c.env) : undefined,
      }),
    );
  })
  .post('/work-orders', editor, zValidator('json', createWorkOrderSchema), async (c) => {
    const settings = await getSettings(readDb(c));
    const { row, asked } = await withTx(c, (tx) =>
      createWorkOrder(tx, actorFromContext(c, staffOf(c)), c.req.valid('json'), {
        thresholdFils: settings.repairApprovalThresholdFils,
        today: today(c.env),
      }),
    );
    if (row.status === 'done') c.executionCtx.waitUntil(queueWorkOrderDoneAlert(c.env, row.id));
    if (asked.length) c.executionCtx.waitUntil(queueApprovalRequests(c.env, asked));
    return c.json(row, 201);
  })
  /** The job with each owner's answer when its estimate needed their approval. */
  .get('/work-orders/:id', viewer, idParam, async (c) => {
    const db = readDb(c);
    const id = c.req.valid('param').id;
    const [detail, settings] = await Promise.all([getWorkOrderDetail(db, id), getSettings(db)]);
    const approvals = await staffApprovals(
      db,
      { workOrderId: id },
      settings.repairApprovalSilenceDays,
    );
    return c.json({ ...detail, approvals });
  })
  .patch(
    '/work-orders/:id',
    editor,
    idParam,
    zValidator('json', updateWorkOrderSchema),
    async (c) => {
      const settings = await getSettings(readDb(c));
      const result = await withTx(c, (tx) =>
        updateWorkOrder(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
          { thresholdFils: settings.repairApprovalThresholdFils, today: today(c.env) },
        ),
      );
      if (result.justDone) c.executionCtx.waitUntil(queueWorkOrderDoneAlert(c.env, result.row.id));
      if (result.asked.length) c.executionCtx.waitUntil(queueApprovalRequests(c.env, result.asked));
      return c.json(result.row);
    },
  )
  /** Admin: start the job over pending or rejected owner answers, with a reason for the audit log. */
  .post(
    '/work-orders/:id/approvals/override',
    admin,
    idParam,
    zValidator('json', overrideApprovalsSchema),
    async (c) => {
      const id = c.req.valid('param').id;
      const items = await withTx(c, (tx) =>
        overrideApprovals(
          tx,
          actorFromContext(c, staffOf(c)),
          { workOrderId: id },
          c.req.valid('json').reason,
        ),
      );
      return c.json({ items });
    },
  );
