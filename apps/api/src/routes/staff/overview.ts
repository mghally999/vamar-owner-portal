/** Staff API: overview and the Today panel (mounted by ../staff.ts). */
import { Hono } from 'hono';
import { readDb } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { overview } from '../../services/overview.js';
import { staffToday } from '../../services/today.js';
import { today } from '../../util/today.js';
import { viewer } from './common.js';

export const overviewRoutes = new Hono<AppEnv>()
  .get('/overview', viewer, async (c) => c.json(await overview(readDb(c), today(c.env))))
  .get('/today', viewer, async (c) => c.json(await staffToday(readDb(c), today(c.env))));
