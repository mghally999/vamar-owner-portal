/**
 * Owner API: the budgets of the buildings the owner holds a unit in today, with the building's
 * figures (not the owner's share) counting only expenses visible to owners. Any other building
 * is simply not in the list.
 */
import { zValidator } from '../util/validator.js';
import { Hono } from 'hono';
import { ownerBudgetQuerySchema } from '@vamar/shared';
import { ownerOf, requireOwner } from '../auth/middleware.js';
import { readDb } from '../db.js';
import type { AppEnv } from '../env.js';
import { budgetReport, ownerBuildingIds } from '../services/budgets.js';
import { today } from '../util/today.js';

// Scoped to this path, as owner-approvals.ts is: owner.ts and owner-v2.ts guard their own.
export const ownerBudgetRoutes = new Hono<AppEnv>()
  .use('/budgets', requireOwner)
  .get('/budgets', zValidator('query', ownerBudgetQuerySchema), async (c) => {
    const db = readDb(c);
    const date = today(c.env);
    return c.json(
      await budgetReport(db, {
        year: c.req.valid('query').year ?? Number(date.slice(0, 4)),
        today: date,
        buildingIds: await ownerBuildingIds(db, ownerOf(c).id),
        ownerVisibleOnly: true,
      }),
    );
  });
