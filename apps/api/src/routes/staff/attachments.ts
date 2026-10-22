/** Staff API: attachments (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { attachmentEntityTypeSchema, uuidSchema } from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import {
  deleteAttachment,
  getAttachmentForStaff,
  listAttachments,
  storeUpload,
  removeObject,
  streamObject,
} from '../../services/attachments.js';
import { ApiError } from '../../errors.js';
import { editor, idParam, viewer } from './common.js';

export const attachmentsRoutes = new Hono<AppEnv>()
  .get(
    '/attachments',
    viewer,
    zValidator('query', z.object({ entityType: attachmentEntityTypeSchema, entityId: uuidSchema })),
    async (c) => {
      const q = c.req.valid('query');
      return c.json({ items: await listAttachments(readDb(c), q.entityType, q.entityId) });
    },
  )
  .post('/attachments', editor, async (c) => {
    const form = await c.req.formData();
    const parsed = z
      .object({ entityType: attachmentEntityTypeSchema, entityId: uuidSchema })
      .safeParse({ entityType: form.get('entityType'), entityId: form.get('entityId') });
    if (!parsed.success)
      throw new ApiError(
        422,
        'validation',
        'entityType and entityId are required',
        parsed.error.issues,
      );
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError(422, 'validation', 'file is required');
    const row = await withTx(c, (tx) =>
      storeUpload(tx, c.env.FILES, actorFromContext(c, staffOf(c)), { ...parsed.data, file }),
    );
    return c.json(row, 201);
  })
  .get('/attachments/:id', viewer, idParam, async (c) => {
    const att = await getAttachmentForStaff(readDb(c), c.req.valid('param').id);
    return streamObject(c.env.FILES, att.r2Key, c, att);
  })
  .delete('/attachments/:id', editor, idParam, async (c) => {
    const { r2Key } = await withTx(c, (tx) =>
      deleteAttachment(tx, actorFromContext(c, staffOf(c)), c.req.valid('param').id),
    );
    c.executionCtx.waitUntil(removeObject(c.env.FILES, r2Key));
    return c.json({ ok: true });
  });
