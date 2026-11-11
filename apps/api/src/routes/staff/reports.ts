/** Staff API: the report summary behind every dashboard report (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import {
  DEFAULT_WEEK_START,
  presetNeedsWeekStart,
  reportQuerySchema,
  resolvePeriodQuery,
} from '@vamar/shared';
import { readDb } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { reportSummary } from '../../services/reports.js';
import { getSettings } from '../../services/settings.js';
import { today } from '../../util/today.js';
import { viewer } from './common.js';

export const reportsRoutes = new Hono<AppEnv>().get(
  '/reports/summary',
  viewer,
  zValidator('query', reportQuerySchema),
  async (c) => {
    const db = readDb(c);
    const q = c.req.valid('query');
    const t = today(c.env);
    // Settings only matter for the week presets; the other reports stay a single statement.
    const weekStart = presetNeedsWeekStart(q.preset)
      ? (await getSettings(db)).weekStart
      : DEFAULT_WEEK_START;
    const { preset, period } = resolvePeriodQuery(q, t, { weekStart });
    const summary = await reportSummary(db, period, q, q.compare, t);
    return c.json({ preset, ...summary });
  },
);
