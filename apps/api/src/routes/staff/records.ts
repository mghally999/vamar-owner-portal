/** Staff API: property records (unit status, identifiers, history timelines) (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import {
  buildingIdentifiersSchema,
  setUnitStatusSchema,
  timelineQuerySchema,
  unitIdentifiersSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import {
  buildingTimeline,
  setBuildingIdentifiers,
  setUnitIdentifiers,
  setUnitStatus,
  unitStatusHistory,
  unitTimeline,
} from '../../services/records.js';
import { editor, idParam, viewer } from './common.js';

export const recordsRoutes = new Hono<AppEnv>()
  .post('/units/:id/status', editor, idParam, zValidator('json', setUnitStatusSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        setUnitStatus(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .get('/units/:id/status-history', viewer, idParam, async (c) =>
    c.json({ items: await unitStatusHistory(readDb(c), c.req.valid('param').id) }),
  )
  .patch(
    '/units/:id/identifiers',
    editor,
    idParam,
    zValidator('json', unitIdentifiersSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          setUnitIdentifiers(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        ),
      ),
  )
  .get(
    '/units/:id/timeline',
    viewer,
    idParam,
    zValidator('query', timelineQuerySchema),
    async (c) =>
      c.json(await unitTimeline(readDb(c), c.req.valid('param').id, c.req.valid('query'))),
  )
  .patch(
    '/buildings/:id/identifiers',
    editor,
    idParam,
    zValidator('json', buildingIdentifiersSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          setBuildingIdentifiers(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        ),
      ),
  )
  .get(
    '/buildings/:id/timeline',
    viewer,
    idParam,
    zValidator('query', timelineQuerySchema),
    async (c) =>
      c.json(await buildingTimeline(readDb(c), c.req.valid('param').id, c.req.valid('query'))),
  );
