/** Staff API: building budgets (mounted by ../staff.ts). Everyone reads, admins write. */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { budgetQuerySchema, createBudgetSchema, updateBudgetSchema } from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import { budgetReport, createBudget, deleteBudget, updateBudget } from '../../services/budgets.js';
import { queueBudgetAlerts } from '../../services/budget-alerts.js';
import { today } from '../../util/today.js';
import { admin, idParam, viewer } from './common.js';

export const budgetsRoutes = new Hono<AppEnv>()
  /** Budget against actual and forecast; one building (even without a budget) or all budgeted. */
  .get('/budgets', viewer, zValidator('query', budgetQuerySchema), async (c) => {
    const q = c.req.valid('query');
    const date = today(c.env);
    return c.json(
      await budgetReport(readDb(c), {
        year: q.year ?? Number(date.slice(0, 4)),
        today: date,
        buildingIds: q.buildingId ? [q.buildingId] : undefined,
        keepEmpty: q.buildingId !== undefined,
        ownerVisibleOnly: false,
      }),
    );
  })
  // A new or lowered budget can put a line past a threshold that the spending already reached,
  // so the owners are told now rather than at the next posting.
  .post('/budgets', admin, zValidator('json', createBudgetSchema), async (c) => {
    const row = await withTx(c, (tx) =>
      createBudget(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
    );
    c.executionCtx.waitUntil(queueBudgetAlerts(c.env));
    return c.json(row, 201);
  })
  .patch('/budgets/:id', admin, idParam, zValidator('json', updateBudgetSchema), async (c) => {
    const row = await withTx(c, (tx) =>
      updateBudget(
        tx,
        actorFromContext(c, staffOf(c)),
        c.req.valid('param').id,
        c.req.valid('json').amountFils,
      ),
    );
    c.executionCtx.waitUntil(queueBudgetAlerts(c.env));
    return c.json(row);
  })
  .delete('/budgets/:id', admin, idParam, async (c) =>
    c.json(
      await withTx(c, (tx) =>
        deleteBudget(tx, actorFromContext(c, staffOf(c)), c.req.valid('param').id),
      ),
    ),
  );
