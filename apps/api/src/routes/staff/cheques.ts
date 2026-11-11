/** Staff API: cheques (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { schema } from '@vamar/db';
import {
  bankCsvMappingSchema,
  bulkChequeStatusChangeSchema,
  diffDays,
  chequeStatusChangeSchema,
  monthKeySchema,
  paginationQuerySchema,
  plainDateSchema,
  updateChequeSchema,
  uuidSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { actorFromContext } from '../../services/audit.js';
import { storeUpload, removeObject, streamObject } from '../../services/attachments.js';
import {
  bankMatchCandidates,
  bulkChangeChequeStatus,
  changeChequeStatus,
  getChequeDetail,
  listCheques,
  updateChequeRow,
} from '../../services/cheques.js';
import {
  deleteBankCsvMapping,
  getBankCsvMappings,
  saveBankCsvMapping,
} from '../../services/bank-mappings.js';
import { queueBounceAlerts } from '../../services/notifications.js';
import { ApiError, validation } from '../../errors.js';
import { today } from '../../util/today.js';
import { editor, idParam, statusList, viewer } from './common.js';

export const chequesRoutes = new Hono<AppEnv>()
  // Registered before /cheques/:id so the literal path is not read as a cheque id.
  .get(
    '/cheques/bank-candidates',
    editor,
    zValidator('query', z.object({ from: plainDateSchema, to: plainDateSchema })),
    async (c) => {
      const { from, to } = c.req.valid('query');
      if (diffDays(from, to) < 0 || diffDays(from, to) > 400)
        throw validation('Choose a window of up to 400 days');
      return c.json({ items: await bankMatchCandidates(readDb(c), from, to) });
    },
  )
  .get('/settings/bank-csv-mappings', editor, async (c) =>
    c.json({ items: await getBankCsvMappings(readDb(c)) }),
  )
  .put(
    '/settings/bank-csv-mappings',
    editor,
    zValidator('json', bankCsvMappingSchema),
    async (c) => {
      const p = staffOf(c);
      const items = await withTx(c, (tx) =>
        saveBankCsvMapping(tx, actorFromContext(c, p), c.req.valid('json')),
      );
      return c.json({ items });
    },
  )
  .delete(
    '/settings/bank-csv-mappings',
    editor,
    zValidator('query', z.object({ bank: z.string().trim().min(1).max(80) })),
    async (c) => {
      const p = staffOf(c);
      const items = await withTx(c, (tx) =>
        deleteBankCsvMapping(tx, actorFromContext(c, p), c.req.valid('query').bank),
      );
      return c.json({ items });
    },
  )
  .get(
    '/cheques',
    viewer,
    zValidator(
      'query',
      paginationQuerySchema.extend({
        month: monthKeySchema.optional(),
        from: plainDateSchema.optional(),
        to: plainDateSchema.optional(),
        buildingId: uuidSchema.optional(),
        unitId: uuidSchema.optional(),
        ownerId: uuidSchema.optional(),
        contractId: uuidSchema.optional(),
        status: statusList,
      }),
    ),
    async (c) => c.json(await listCheques(readDb(c), c.req.valid('query'))),
  )
  .get('/cheques/:id', viewer, idParam, async (c) =>
    c.json(await getChequeDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch('/cheques/:id', editor, idParam, zValidator('json', updateChequeSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateChequeRow(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .post(
    '/cheques/:id/status',
    editor,
    idParam,
    zValidator('json', chequeStatusChangeSchema),
    async (c) => {
      const p = staffOf(c);
      const id = c.req.valid('param').id;
      const result = await withTx(c, (tx) =>
        changeChequeStatus(tx, actorFromContext(c, p), p.role === 'admin', id, c.req.valid('json')),
      );
      if (result.notifyOwners) c.executionCtx.waitUntil(queueBounceAlerts(c.env, [id]));
      return c.json(result);
    },
  )
  .post(
    '/cheques/bulk-status',
    editor,
    zValidator('json', bulkChequeStatusChangeSchema),
    async (c) => {
      const p = staffOf(c);
      const body = c.req.valid('json');
      const result = await withTx(c, (tx) =>
        bulkChangeChequeStatus(tx, actorFromContext(c, p), body, today(c.env)),
      );
      // Same alert path as a single bounce, sent only after the transaction has committed.
      if (result.notifyChequeIds.length)
        c.executionCtx.waitUntil(queueBounceAlerts(c.env, result.notifyChequeIds));
      return c.json({ updated: result.updated, notified: result.notifyChequeIds.length });
    },
  )
  .post('/cheques/:id/image', editor, idParam, async (c) => {
    const p = staffOf(c);
    const id = c.req.valid('param').id;
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError(422, 'validation', 'file is required');
    const { att, previousKey } = await withTx(c, async (tx) => {
      const cheque = await getChequeDetail(tx, id);
      const att = await storeUpload(tx, c.env.FILES, actorFromContext(c, p), {
        entityType: 'cheque',
        entityId: cheque.id,
        file,
      });
      await tx.update(schema.cheques).set({ imageKey: att.r2Key }).where(eq(schema.cheques.id, id));
      return { att, previousKey: cheque.imageKey };
    });
    // The replaced image is removed only after the new one is committed.
    if (previousKey && previousKey !== att.r2Key)
      c.executionCtx.waitUntil(removeObject(c.env.FILES, previousKey));
    return c.json(att, 201);
  })
  .get('/cheques/:id/image', viewer, idParam, async (c) => {
    const cheque = await getChequeDetail(readDb(c), c.req.valid('param').id);
    if (!cheque.imageKey) throw new ApiError(404, 'not_found', 'No image');
    return streamObject(c.env.FILES, cheque.imageKey, c);
  });
