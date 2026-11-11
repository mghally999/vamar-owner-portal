/**
 * Owner API: messages with Vamar. An owner reads and writes only in their own threads; anyone
 * else's is a 404. New threads and replies share one rate limit per owner (OWNER_MESSAGES_PER_HOUR),
 * checked after the input is valid so a typing slip does not use up the hour.
 */
import { zValidator } from '../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { createThreadSchema, messageReplySchema, uuidSchema } from '@vamar/shared';
import { ownerOf, requireOwner } from '../auth/middleware.js';
import { enforceRateLimit, RATE_LIMITS } from '../auth/ratelimit.js';
import { readDb, withTx } from '../db.js';
import type { AppEnv } from '../env.js';
import { actorFromContext } from '../services/audit.js';
import {
  createOwnerThread,
  markThreadRead,
  ownerThreadDetail,
  ownerThreads,
  postMessage,
} from '../services/messages.js';
import { readMessageInput } from '../util/message-input.js';

const idParam = zValidator('param', z.object({ id: uuidSchema }));

// Scoped to these paths, as owner-approvals.ts is: owner.ts and owner-v2.ts guard their own.
export const ownerMessageRoutes = new Hono<AppEnv>()
  .use('/messages', requireOwner)
  .use('/messages/*', requireOwner)
  .get('/messages', async (c) => c.json(await ownerThreads(readDb(c), ownerOf(c).id)))
  .post('/messages', async (c) => {
    const owner = ownerOf(c);
    const { input, file } = await readMessageInput(c, createThreadSchema);
    await enforceRateLimit(readDb(c), RATE_LIMITS.ownerMessage, owner.id);
    const { id } = await withTx(c, (tx) =>
      createOwnerThread(tx, c.env.FILES, actorFromContext(c, owner), owner.id, input, file),
    );
    return c.json(await ownerThreadDetail(readDb(c), owner.id, id), 201);
  })
  /** A thread by its id, or by the id of one of its messages (the reply push). */
  .get('/messages/:id', idParam, async (c) =>
    c.json(await ownerThreadDetail(readDb(c), ownerOf(c).id, c.req.valid('param').id)),
  )
  .post('/messages/:id/messages', idParam, async (c) => {
    const owner = ownerOf(c);
    const { input, file } = await readMessageInput(c, messageReplySchema);
    await enforceRateLimit(readDb(c), RATE_LIMITS.ownerMessage, owner.id);
    const message = await withTx(c, (tx) =>
      postMessage(
        tx,
        c.env.FILES,
        actorFromContext(c, owner),
        { type: 'owner', id: owner.id },
        c.req.valid('param').id,
        input.body,
        file,
      ),
    );
    return c.json(message, 201);
  })
  .post('/messages/:id/read', idParam, async (c) => {
    await withTx(c, (tx) => markThreadRead(tx, 'owner', c.req.valid('param').id, ownerOf(c).id));
    return c.json({ ok: true });
  });
