/** Staff API: global search (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { globalSearchQuerySchema } from '@vamar/shared';
import { readDb } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { globalSearch } from '../../services/search.js';
import { viewer } from './common.js';

export const searchRoutes = new Hono<AppEnv>().get(
  '/search',
  viewer,
  zValidator('query', globalSearchQuerySchema),
  async (c) => {
    const { q, limit } = c.req.valid('query');
    return c.json({ items: await globalSearch(readDb(c), q, limit) });
  },
);
