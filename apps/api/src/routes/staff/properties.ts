/** Staff API: buildings, units, tenants (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createBuildingSchema,
  createTenantSchema,
  createUnitSchema,
  paginationQuerySchema,
  setUnitOwnersSchema,
  updateBuildingSchema,
  updateTenantSchema,
  updateUnitSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import {
  createBuilding,
  createTenant,
  createUnit,
  getBuildingDetail,
  getUnitDetail,
  listBuildings,
  listTenants,
  setUnitOwners,
  updateBuilding,
  updateTenant,
  updateUnit,
} from '../../services/properties.js';
import { today } from '../../util/today.js';
import { editor, idParam, viewer } from './common.js';

export const propertiesRoutes = new Hono<AppEnv>()
  .get(
    '/buildings',
    viewer,
    zValidator(
      'query',
      paginationQuerySchema.extend({
        search: z.string().trim().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
    ),
    async (c) => c.json(await listBuildings(readDb(c), today(c.env), c.req.valid('query'))),
  )
  .post('/buildings', editor, zValidator('json', createBuildingSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createBuilding(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .get('/buildings/:id', viewer, idParam, async (c) =>
    c.json(await getBuildingDetail(readDb(c), c.req.valid('param').id, today(c.env))),
  )
  .patch('/buildings/:id', editor, idParam, zValidator('json', updateBuildingSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateBuilding(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .post('/units', editor, zValidator('json', createUnitSchema), async (c) =>
    c.json(
      await withTx(c, (tx) => createUnit(tx, actorFromContext(c, staffOf(c)), c.req.valid('json'))),
      201,
    ),
  )
  .get('/units/:id', viewer, idParam, async (c) =>
    c.json(await getUnitDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch('/units/:id', editor, idParam, zValidator('json', updateUnitSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateUnit(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .put('/units/:id/owners', editor, idParam, zValidator('json', setUnitOwnersSchema), async (c) =>
    c.json({
      items: await withTx(c, (tx) =>
        setUnitOwners(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    }),
  )
  .get(
    '/tenants',
    viewer,
    zValidator('query', z.object({ search: z.string().trim().max(100).optional() })),
    async (c) => c.json({ items: await listTenants(readDb(c), c.req.valid('query').search) }),
  )
  .post('/tenants', editor, zValidator('json', createTenantSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createTenant(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .patch('/tenants/:id', editor, idParam, zValidator('json', updateTenantSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateTenant(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  );
