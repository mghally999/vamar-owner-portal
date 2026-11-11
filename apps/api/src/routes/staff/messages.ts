/**
 * Staff API: the owner messages inbox (mounted by ../staff.ts). Everyone reads; data entry and
 * admins answer, close, reopen and assign. Each answer pushes the owner once, after commit.
 */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import {
  assignThreadSchema,
  messageReplySchema,
  staffThreadQuerySchema,
  threadStatusSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import { queueMessageReplyPush } from '../../services/message-notifications.js';
import {
  assignThread,
  markThreadRead,
  messageAssignees,
  postMessage,
  setThreadStatus,
  staffInbox,
  staffMessageCounts,
  staffThreadDetail,
} from '../../services/messages.js';
import { readMessageInput } from '../../util/message-input.js';
import { editor, idParam, viewer } from './common.js';

export const messagesRoutes = new Hono<AppEnv>()
  .get('/messages', viewer, zValidator('query', staffThreadQuerySchema), async (c) =>
    c.json(await staffInbox(readDb(c), staffOf(c).id, c.req.valid('query'))),
  )
  // Before /messages/:id, which would take these names for an id.
  .get('/messages/counts', viewer, async (c) => c.json(await staffMessageCounts(readDb(c))))
  .get('/messages/assignees', viewer, async (c) =>
    c.json({ items: await messageAssignees(readDb(c)) }),
  )
  .get('/messages/:id', viewer, idParam, async (c) =>
    c.json(await staffThreadDetail(readDb(c), c.req.valid('param').id)),
  )
  .post('/messages/:id/messages', editor, idParam, async (c) => {
    const staff = staffOf(c);
    const { input, file } = await readMessageInput(c, messageReplySchema);
    const message = await withTx(c, (tx) =>
      postMessage(
        tx,
        c.env.FILES,
        actorFromContext(c, staff),
        { type: 'staff', id: staff.id },
        c.req.valid('param').id,
        input.body,
        file,
      ),
    );
    c.executionCtx.waitUntil(queueMessageReplyPush(c.env, message.id));
    return c.json(message, 201);
  })
  .post('/messages/:id/read', viewer, idParam, async (c) => {
    await withTx(c, (tx) => markThreadRead(tx, 'staff', c.req.valid('param').id));
    return c.json({ ok: true });
  })
  .post(
    '/messages/:id/status',
    editor,
    idParam,
    zValidator('json', threadStatusSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          setThreadStatus(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json').status,
          ),
        ),
      ),
  )
  .post(
    '/messages/:id/assign',
    editor,
    idParam,
    zValidator('json', assignThreadSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          assignThread(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json').staffId,
          ),
        ),
      ),
  );
