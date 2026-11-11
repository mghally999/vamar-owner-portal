/**
 * Owner API, v2: the period summary behind Home, expenses with their invoices, work orders, the
 * unit history timeline and the calendar. Every query is scoped to the signed-in owner; the
 * isolation suite proves owner A gets 404 or an empty list on owner B's data.
 */
import { zValidator } from '../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  calendarRangeQuerySchema,
  ownerExpenseListQuerySchema,
  ownerSummaryQuerySchema,
  paginationQuerySchema,
  presetNeedsWeekStart,
  DEFAULT_WEEK_START,
  type WeekStart,
  timelineQuerySchema,
  uuidSchema,
  workOrderStatusSchema,
} from '@vamar/shared';
import { ownerOf, requireOwner } from '../auth/middleware.js';
import { readDb, type Dbx } from '../db.js';
import type { AppEnv } from '../env.js';
import { calendarItems, holidayDates } from '../services/calendar.js';
import { optionalPeriod, ownerExpenseDetail, ownerExpenses } from '../services/expenses.js';
import { ownerSummary } from '../services/owner-summary.js';
import { ownerUnitTimeline } from '../services/records.js';
import { getSettings } from '../services/settings.js';
import { ownerWorkOrderDetail, ownerWorkOrders } from '../services/work-orders.js';
import { today } from '../util/today.js';

const idParam = zValidator('param', z.object({ id: uuidSchema }));

/** The week start from settings, read only for the week presets: one query fewer for the rest. */
async function weekStartFor(db: Dbx, preset: string | undefined): Promise<WeekStart> {
  return presetNeedsWeekStart(preset) ? (await getSettings(db)).weekStart : DEFAULT_WEEK_START;
}

export const ownerV2Routes = new Hono<AppEnv>()
  .use(requireOwner)

  /** Everything Home shows for a period, in one request. */
  .get('/summary', zValidator('query', ownerSummaryQuerySchema), async (c) => {
    const db = readDb(c);
    const q = c.req.valid('query');
    return c.json(
      await ownerSummary(db, ownerOf(c).id, q, today(c.env), await weekStartFor(db, q.preset)),
    );
  })

  .get('/expenses', zValidator('query', ownerExpenseListQuerySchema), async (c) => {
    const db = readDb(c);
    const q = c.req.valid('query');
    const weekStart = await weekStartFor(db, q.preset);
    return c.json(
      await ownerExpenses(db, ownerOf(c).id, {
        ...q,
        period: optionalPeriod(q, today(c.env), weekStart),
      }),
    );
  })

  .get('/expenses/:id', idParam, async (c) => {
    const db = readDb(c);
    const settings = await getSettings(db);
    return c.json(
      await ownerExpenseDetail(
        db,
        ownerOf(c).id,
        c.req.valid('param').id,
        settings.ownersSeeInvoiceFiles,
      ),
    );
  })

  .get(
    '/work-orders',
    zValidator(
      'query',
      paginationQuerySchema.extend({
        unitId: uuidSchema.optional(),
        status: workOrderStatusSchema.optional(),
      }),
    ),
    async (c) => c.json(await ownerWorkOrders(readDb(c), ownerOf(c).id, c.req.valid('query'))),
  )

  .get('/work-orders/:id', idParam, async (c) =>
    c.json(await ownerWorkOrderDetail(readDb(c), ownerOf(c).id, c.req.valid('param').id)),
  )

  .get('/units/:id/timeline', idParam, zValidator('query', timelineQuerySchema), async (c) =>
    c.json(
      await ownerUnitTimeline(
        readDb(c),
        ownerOf(c).id,
        c.req.valid('param').id,
        c.req.valid('query'),
      ),
    ),
  )

  /** Cheques due, contract ends, hearings, scheduled jobs, events marked for owners, holidays. */
  .get('/calendar', zValidator('query', calendarRangeQuerySchema), async (c) => {
    const db = readDb(c);
    const q = c.req.valid('query');
    const { ownerId: _ignored, ...range } = q;
    const [items, holidays] = await Promise.all([
      calendarItems(db, range, { ownerId: ownerOf(c).id }),
      holidayDates(db, q.from, q.to),
    ]);
    return c.json({ items, holidays });
  });
