import { zValidator } from '../util/validator.js';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { schema } from '@vamar/db';
import {
  chequeStatusSchema,
  langSchema,
  monthKeySchema,
  paginationQuerySchema,
  registerPushTokenSchema,
  uuidSchema,
} from '@vamar/shared';
import { ownerOf, requireOwner } from '../auth/middleware.js';
import { readDb, withTx } from '../db.js';
import type { AppEnv } from '../env.js';
import { notFound } from '../errors.js';
import { getAttachmentForOwner, streamObject } from '../services/attachments.js';
import {
  ownerBuildings,
  ownerChequeDetail,
  ownerCheques,
  ownerDisputeDetail,
  ownerDisputes,
  ownerHome,
  ownerProfile,
  ownerUnitDetail,
  ownerUnits,
} from '../services/owner-portal.js';
import { requestAccountDeletion } from '../services/owner-account.js';
import { today } from '../util/today.js';

const statusList = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
  .pipe(z.array(chequeStatusSchema).optional());

export const ownerRoutes = new Hono<AppEnv>()
  .use(requireOwner)

  .get('/me', async (c) => c.json(await ownerProfile(readDb(c), ownerOf(c).id)))

  .patch('/me', zValidator('json', z.object({ preferredLang: langSchema })), async (c) => {
    const p = ownerOf(c);
    const { preferredLang } = c.req.valid('json');
    const updated = await withTx(c, (tx) =>
      tx
        .update(schema.owners)
        .set({ preferredLang })
        .where(eq(schema.owners.id, p.id))
        .returning({ id: schema.owners.id }),
    );
    if (updated.length === 0) throw notFound('Owner');
    return c.json({ ok: true });
  })

  /** Home: one endpoint, one SQL round trip. */
  .get('/home', zValidator('query', z.object({ month: monthKeySchema.optional() })), async (c) => {
    const t = today(c.env);
    const month = c.req.valid('query').month ?? t.slice(0, 7);
    return c.json(await ownerHome(readDb(c), ownerOf(c).id, month, t));
  })

  .get(
    '/cheques',
    zValidator(
      'query',
      paginationQuerySchema.extend({
        month: monthKeySchema.optional(),
        buildingId: uuidSchema.optional(),
        unitId: uuidSchema.optional(),
        status: statusList,
      }),
    ),
    async (c) => c.json(await ownerCheques(readDb(c), ownerOf(c).id, c.req.valid('query'))),
  )

  .get('/cheques/:id', zValidator('param', z.object({ id: uuidSchema })), async (c) =>
    c.json(await ownerChequeDetail(readDb(c), ownerOf(c).id, c.req.valid('param').id)),
  )

  /** Cheque image, only when the cheque is in the owner's scope. */
  .get('/cheques/:id/image', zValidator('param', z.object({ id: uuidSchema })), async (c) => {
    const db = readDb(c);
    const cheque = await ownerChequeDetail(db, ownerOf(c).id, c.req.valid('param').id);
    const row = await db.query.cheques.findFirst({
      where: eq(schema.cheques.id, cheque.id),
      columns: { imageKey: true },
    });
    if (!row?.imageKey) throw notFound('Image');
    return streamObject(c.env.FILES, row.imageKey, c);
  })

  .get('/buildings', async (c) =>
    c.json({ items: await ownerBuildings(readDb(c), ownerOf(c).id, today(c.env)) }),
  )

  .get('/units', zValidator('query', z.object({ buildingId: uuidSchema.optional() })), async (c) =>
    c.json(
      await ownerUnits(readDb(c), ownerOf(c).id, today(c.env), {
        buildingId: c.req.valid('query').buildingId,
      }),
    ),
  )

  .get('/units/:id', zValidator('param', z.object({ id: uuidSchema })), async (c) =>
    c.json(await ownerUnitDetail(readDb(c), ownerOf(c).id, c.req.valid('param').id, today(c.env))),
  )

  .get('/disputes', zValidator('query', paginationQuerySchema), async (c) =>
    c.json(await ownerDisputes(readDb(c), ownerOf(c).id, c.req.valid('query'))),
  )

  .get('/disputes/:id', zValidator('param', z.object({ id: uuidSchema })), async (c) =>
    c.json(await ownerDisputeDetail(readDb(c), ownerOf(c).id, c.req.valid('param').id)),
  )

  .get(
    '/disputes/:id/attachments',
    zValidator('param', z.object({ id: uuidSchema })),
    async (c) => {
      const db = readDb(c);
      const dispute = await ownerDisputeDetail(db, ownerOf(c).id, c.req.valid('param').id);
      const rows = await db
        .select({
          id: schema.attachments.id,
          fileName: schema.attachments.fileName,
          mime: schema.attachments.mime,
          sizeBytes: schema.attachments.sizeBytes,
          createdAt: schema.attachments.createdAt,
        })
        .from(schema.attachments)
        .where(
          and(
            eq(schema.attachments.entityType, 'dispute'),
            eq(schema.attachments.entityId, dispute.id),
          ),
        );
      return c.json({ items: rows });
    },
  )

  .get('/attachments/:id', zValidator('param', z.object({ id: uuidSchema })), async (c) => {
    const att = await getAttachmentForOwner(readDb(c), ownerOf(c).id, c.req.valid('param').id);
    return streamObject(c.env.FILES, att.r2Key, c, att);
  })

  .post('/push-token', zValidator('json', registerPushTokenSchema), async (c) => {
    const p = ownerOf(c);
    const { deviceId, pushToken } = c.req.valid('json');
    const updated = await withTx(c, (tx) =>
      tx
        .update(schema.devices)
        .set({ pushToken, lastSeen: new Date() })
        .where(
          and(
            eq(schema.devices.ownerId, p.id),
            eq(schema.devices.deviceId, deviceId),
            isNull(schema.devices.revokedAt),
          ),
        )
        .returning({ id: schema.devices.id }),
    );
    if (updated.length === 0) throw notFound('Device');
    return c.json({ ok: true });
  })

  .delete(
    '/push-token',
    zValidator('json', z.object({ deviceId: z.string().min(8).max(128) })),
    async (c) => {
      const p = ownerOf(c);
      const { deviceId } = c.req.valid('json');
      const updated = await withTx(c, (tx) =>
        tx
          .update(schema.devices)
          .set({ pushToken: null })
          .where(and(eq(schema.devices.ownerId, p.id), eq(schema.devices.deviceId, deviceId)))
          .returning({ id: schema.devices.id }),
      );
      if (updated.length === 0) throw notFound('Device');
      return c.json({ ok: true });
    },
  )

  /** App Store requirement: owner can request deletion. Disables the account and revokes sessions. */
  .post(
    '/account/delete-request',
    zValidator('json', z.object({ reason: z.string().trim().max(500).default('') })),
    async (c) => {
      const p = ownerOf(c);
      await withTx(c, (tx) => requestAccountDeletion(tx, c, p.id, c.req.valid('json').reason));
      return c.json({ ok: true });
    },
  );
