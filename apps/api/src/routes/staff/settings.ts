/** Staff API: application settings (mounted by ../staff.ts). Everyone reads, admins write. */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { updateSettingsSchema } from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import { getSettings, updateSettings } from '../../services/settings.js';
import { admin, viewer } from './common.js';

export const settingsRoutes = new Hono<AppEnv>()
  .get('/settings', viewer, async (c) => c.json(await getSettings(readDb(c))))
  .patch('/settings', admin, zValidator('json', updateSettingsSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateSettings(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
    ),
  );
