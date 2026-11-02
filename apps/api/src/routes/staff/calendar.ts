/** Staff API: the calendar, manual events and holidays (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  calendarRangeQuerySchema,
  createCalendarEventSchema,
  holidaySchema,
  plainDateSchema,
  updateCalendarEventSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import {
  calendarItems,
  createEvent,
  deleteEvent,
  deleteHoliday,
  getEvent,
  listHolidays,
  updateEvent,
  upsertHoliday,
} from '../../services/calendar.js';
import { admin, editor, idParam, viewer } from './common.js';

export const calendarRoutes = new Hono<AppEnv>()
  .get('/calendar', viewer, zValidator('query', calendarRangeQuerySchema), async (c) =>
    c.json({ items: await calendarItems(readDb(c), c.req.valid('query'), { ownerId: null }) }),
  )
  .post('/calendar-events', editor, zValidator('json', createCalendarEventSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createEvent(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .get('/calendar-events/:id', viewer, idParam, async (c) =>
    c.json(await getEvent(readDb(c), c.req.valid('param').id)),
  )
  .patch(
    '/calendar-events/:id',
    editor,
    idParam,
    zValidator('json', updateCalendarEventSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          updateEvent(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        ),
      ),
  )
  .delete('/calendar-events/:id', editor, idParam, async (c) =>
    c.json(
      await withTx(c, (tx) =>
        deleteEvent(tx, actorFromContext(c, staffOf(c)), c.req.valid('param').id),
      ),
    ),
  )
  .get(
    '/holidays',
    viewer,
    zValidator('query', z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() })),
    async (c) => c.json({ items: await listHolidays(readDb(c), c.req.valid('query').year) }),
  )
  .put('/holidays', admin, zValidator('json', holidaySchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        upsertHoliday(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
    ),
  )
  .delete(
    '/holidays/:date',
    admin,
    zValidator('param', z.object({ date: plainDateSchema })),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          deleteHoliday(tx, actorFromContext(c, staffOf(c)), c.req.valid('param').date),
        ),
      ),
  );
