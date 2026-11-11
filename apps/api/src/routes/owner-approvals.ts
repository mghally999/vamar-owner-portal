/**
 * Owner API: approval of large repairs. An owner sees and answers only their own requests;
 * anyone else's is a 404.
 */
import { zValidator } from '../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { answerApprovalSchema, ownerApprovalListQuerySchema, uuidSchema } from '@vamar/shared';
import { ownerOf, requireOwner } from '../auth/middleware.js';
import { readDb, withTx } from '../db.js';
import type { AppEnv } from '../env.js';
import { answerApproval, ownerApprovalDetail, ownerApprovals } from '../services/approvals.js';
import { actorFromContext } from '../services/audit.js';
import { getSettings } from '../services/settings.js';

const idParam = zValidator('param', z.object({ id: uuidSchema }));

// Scoped to these paths: a bare use() would run the check again for every /api/owner route,
// which owner.ts and owner-v2.ts already guard.
export const ownerApprovalRoutes = new Hono<AppEnv>()
  .use('/approvals', requireOwner)
  .use('/approvals/*', requireOwner)
  .get('/approvals', zValidator('query', ownerApprovalListQuerySchema), async (c) => {
    const db = readDb(c);
    const settings = await getSettings(db);
    const items = await ownerApprovals(
      db,
      ownerOf(c).id,
      c.req.valid('query'),
      settings.repairApprovalSilenceDays,
    );
    return c.json({ items });
  })
  .get('/approvals/:id', idParam, async (c) => {
    const db = readDb(c);
    const settings = await getSettings(db);
    return c.json(
      await ownerApprovalDetail(
        db,
        ownerOf(c).id,
        c.req.valid('param').id,
        settings.repairApprovalSilenceDays,
      ),
    );
  })
  .post('/approvals/:id', idParam, zValidator('json', answerApprovalSchema), async (c) => {
    const settings = await getSettings(readDb(c));
    const owner = ownerOf(c);
    return c.json(
      await withTx(c, (tx) =>
        answerApproval(
          tx,
          actorFromContext(c, owner),
          owner.id,
          c.req.valid('param').id,
          c.req.valid('json'),
          settings.repairApprovalSilenceDays,
        ),
      ),
    );
  });
