/** Staff API: Excel import commit. Rows arrive parsed and mapped by the browser and are validated here. */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { staffOf } from '../../auth/middleware.js';
import { withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import { commitImport, importCommitSchema } from '../../services/imports.js';
import { editor } from './common.js';

export const importRoutes = new Hono<AppEnv>().post(
  '/import/commit',
  editor,
  zValidator('json', importCommitSchema),
  async (c) =>
    c.json(
      await withTx(c, (tx) =>
        commitImport(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
    ),
);
