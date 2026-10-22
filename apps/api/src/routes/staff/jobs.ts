/** Staff API: manual trigger of the daily jobs (admin), for demos and tests. */
import { Hono } from 'hono';
import type { AppEnv } from '../../env.js';
import { runDailyJobs } from '../../cron.js';
import { admin } from './common.js';

export const jobsRoutes = new Hono<AppEnv>().post('/jobs/daily', admin, async (c) =>
  c.json(await runDailyJobs(c.env)),
);
