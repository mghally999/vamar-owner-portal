import { zValidator } from '../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  activateContractSchema,
  attachmentEntityTypeSchema,
  auditReasonSchema,
  bulkChequeStatusChangeSchema,
  chequeStatusChangeSchema,
  chequeStatusSchema,
  contractStatusSchema,
  createBuildingSchema,
  createContractSchema,
  createDisputeSchema,
  createDisputeUpdateSchema,
  createOwnerSchema,
  createTenantSchema,
  createUnitSchema,
  disputeStatusSchema,
  inviteStaffSchema,
  monthKeySchema,
  ownerStatusSchema,
  paginationQuerySchema,
  plainDateSchema,
  setUnitOwnersSchema,
  updateBuildingSchema,
  updateChequeSchema,
  updateContractSchema,
  updateDisputeSchema,
  updateOwnerSchema,
  updateStaffSchema,
  updateTenantSchema,
  updateUnitSchema,
  uuidSchema,
} from '@vamar/shared';
import { requireStaff, staffOf } from '../auth/middleware.js';
import { readDb, withTx } from '../db.js';
import type { AppEnv } from '../env.js';
import { actorFromContext } from '../services/audit.js';
import {
  deleteAttachment,
  getAttachmentForStaff,
  listAttachments,
  storeUpload,
  streamObject,
} from '../services/attachments.js';
import {
  bulkChangeChequeStatus,
  changeChequeStatus,
  getChequeDetail,
  listCheques,
  updateChequeRow,
} from '../services/cheques.js';
import {
  activateContract,
  createContract,
  getContractDetail,
  listContracts,
  renewContract,
  terminateContract,
  updateContract,
} from '../services/contracts.js';
import {
  addDisputeUpdate,
  createDispute,
  getDisputeDetail,
  listDisputes,
  updateDispute,
} from '../services/disputes.js';
import { queueBounceAlert } from '../services/notifications.js';
import { overview } from '../services/overview.js';
import {
  createOwner,
  getOwnerDetail,
  listOwners,
  setOwnerStatus,
  updateOwner,
} from '../services/owners.js';
import {
  createBuilding,
  createTenant,
  createUnit,
  getBuildingDetail,
  getUnitDetail,
  listBuildings,
  listTenants,
  setUnitOwners,
  updateBuilding,
  updateTenant,
  updateUnit,
} from '../services/properties.js';
import {
  inviteStaff,
  listStaff,
  queryAudit,
  resetStaffTotp,
  updateStaff,
} from '../services/staff.js';
import { runDailyJobs } from '../cron.js';
import { commitImport, importCommitSchema } from '../services/imports.js';
import { today } from '../util/today.js';
import { ApiError } from '../errors.js';

const idParam = zValidator('param', z.object({ id: uuidSchema }));
const statusList = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
  .pipe(z.array(chequeStatusSchema).optional());

const viewer = requireStaff('viewer');
const editor = requireStaff('editor');
const admin = requireStaff('admin');

export const staffRoutes = new Hono<AppEnv>()
  // Overview ----------------------------------------------------------------------------------
  .get('/overview', viewer, async (c) => c.json(await overview(readDb(c), today(c.env))))

  // Owners ------------------------------------------------------------------------------------
  .get(
    '/owners',
    viewer,
    zValidator(
      'query',
      paginationQuerySchema.extend({
        search: z.string().trim().max(100).optional(),
        status: ownerStatusSchema.optional(),
      }),
    ),
    async (c) => c.json(await listOwners(readDb(c), c.req.valid('query'))),
  )
  .post('/owners', editor, zValidator('json', createOwnerSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createOwner(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .get('/owners/:id', viewer, idParam, async (c) =>
    c.json(await getOwnerDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch('/owners/:id', editor, idParam, zValidator('json', updateOwnerSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateOwner(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .post(
    '/owners/:id/status',
    editor,
    idParam,
    zValidator('json', z.object({ status: z.enum(['active', 'disabled']) })),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          setOwnerStatus(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json').status,
          ),
        ),
      ),
  )

  // Buildings, units, tenants -------------------------------------------------------------------
  .get('/buildings', viewer, async (c) =>
    c.json({ items: await listBuildings(readDb(c), today(c.env)) }),
  )
  .post('/buildings', editor, zValidator('json', createBuildingSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createBuilding(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .get('/buildings/:id', viewer, idParam, async (c) =>
    c.json(await getBuildingDetail(readDb(c), c.req.valid('param').id, today(c.env))),
  )
  .patch('/buildings/:id', editor, idParam, zValidator('json', updateBuildingSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateBuilding(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .post('/units', editor, zValidator('json', createUnitSchema), async (c) =>
    c.json(
      await withTx(c, (tx) => createUnit(tx, actorFromContext(c, staffOf(c)), c.req.valid('json'))),
      201,
    ),
  )
  .get('/units/:id', viewer, idParam, async (c) =>
    c.json(await getUnitDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch('/units/:id', editor, idParam, zValidator('json', updateUnitSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateUnit(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .put('/units/:id/owners', editor, idParam, zValidator('json', setUnitOwnersSchema), async (c) =>
    c.json({
      items: await withTx(c, (tx) =>
        setUnitOwners(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    }),
  )
  .get(
    '/tenants',
    viewer,
    zValidator('query', z.object({ search: z.string().trim().max(100).optional() })),
    async (c) => c.json({ items: await listTenants(readDb(c), c.req.valid('query').search) }),
  )
  .post('/tenants', editor, zValidator('json', createTenantSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createTenant(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .patch('/tenants/:id', editor, idParam, zValidator('json', updateTenantSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateTenant(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )

  // Contracts ---------------------------------------------------------------------------------
  .get(
    '/contracts',
    viewer,
    zValidator(
      'query',
      paginationQuerySchema.extend({
        status: contractStatusSchema.optional(),
        buildingId: uuidSchema.optional(),
        unitId: uuidSchema.optional(),
        endingWithinDays: z.coerce.number().int().min(1).max(365).optional(),
      }),
    ),
    async (c) => c.json(await listContracts(readDb(c), c.req.valid('query'), today(c.env))),
  )
  .post('/contracts', editor, zValidator('json', createContractSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createContract(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .get('/contracts/:id', viewer, idParam, async (c) =>
    c.json(await getContractDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch('/contracts/:id', editor, idParam, zValidator('json', updateContractSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateContract(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .post(
    '/contracts/:id/activate',
    editor,
    idParam,
    zValidator('json', activateContractSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          activateContract(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json').totalMismatchReason,
          ),
        ),
      ),
  )
  .post(
    '/contracts/:id/terminate',
    editor,
    idParam,
    zValidator('json', z.object({ reason: auditReasonSchema })),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          terminateContract(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json').reason,
          ),
        ),
      ),
  )
  .post('/contracts/:id/renew', editor, idParam, async (c) =>
    c.json(
      await withTx(c, (tx) =>
        renewContract(tx, actorFromContext(c, staffOf(c)), c.req.valid('param').id),
      ),
      201,
    ),
  )

  // Cheques -----------------------------------------------------------------------------------
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
      if (result.notifyOwners) c.executionCtx.waitUntil(queueBounceAlert(c.env, id));
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
        bulkChangeChequeStatus(tx, actorFromContext(c, p), body.chequeIds, body.to, body.note),
      );
      for (const id of result.notifyChequeIds)
        c.executionCtx.waitUntil(queueBounceAlert(c.env, id));
      return c.json(result);
    },
  )
  .post('/cheques/:id/image', editor, idParam, async (c) => {
    const p = staffOf(c);
    const id = c.req.valid('param').id;
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError(422, 'validation', 'file is required');
    const row = await withTx(c, async (tx) => {
      const cheque = await getChequeDetail(tx, id);
      const att = await storeUpload(tx, c.env.FILES, actorFromContext(c, p), {
        entityType: 'cheque',
        entityId: cheque.id,
        file,
      });
      const { schema } = await import('@vamar/db');
      const { eq } = await import('drizzle-orm');
      await tx.update(schema.cheques).set({ imageKey: att.r2Key }).where(eq(schema.cheques.id, id));
      return att;
    });
    return c.json(row, 201);
  })
  .get('/cheques/:id/image', viewer, idParam, async (c) => {
    const cheque = await getChequeDetail(readDb(c), c.req.valid('param').id);
    if (!cheque.imageKey) throw new ApiError(404, 'not_found', 'No image');
    return streamObject(c.env.FILES, cheque.imageKey, c);
  })

  // Disputes ----------------------------------------------------------------------------------
  .get(
    '/disputes',
    viewer,
    zValidator(
      'query',
      z.object({
        status: disputeStatusSchema.optional(),
        unitId: uuidSchema.optional(),
        buildingId: uuidSchema.optional(),
      }),
    ),
    async (c) => c.json({ items: await listDisputes(readDb(c), c.req.valid('query')) }),
  )
  .post('/disputes', editor, zValidator('json', createDisputeSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createDispute(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('json'),
          Number(today(c.env).slice(0, 4)),
        ),
      ),
      201,
    ),
  )
  .get('/disputes/:id', viewer, idParam, async (c) =>
    c.json(await getDisputeDetail(readDb(c), c.req.valid('param').id)),
  )
  .patch('/disputes/:id', editor, idParam, zValidator('json', updateDisputeSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateDispute(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .post(
    '/disputes/:id/updates',
    editor,
    idParam,
    zValidator('json', createDisputeUpdateSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          addDisputeUpdate(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        ),
        201,
      ),
  )

  // Attachments -------------------------------------------------------------------------------
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
    await withTx(c, (tx) =>
      deleteAttachment(tx, c.env.FILES, actorFromContext(c, staffOf(c)), c.req.valid('param').id),
    );
    return c.json({ ok: true });
  })

  // Staff users and audit (admin) ---------------------------------------------------------------
  .get('/staff', admin, async (c) => c.json({ items: await listStaff(readDb(c)) }))
  .post('/staff', admin, zValidator('json', inviteStaffSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        inviteStaff(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .patch('/staff/:id', admin, idParam, zValidator('json', updateStaffSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateStaff(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  .post('/staff/:id/reset-totp', admin, idParam, async (c) => {
    await withTx(c, (tx) =>
      resetStaffTotp(tx, actorFromContext(c, staffOf(c)), c.req.valid('param').id),
    );
    return c.json({ ok: true });
  })
  .get(
    '/audit',
    admin,
    zValidator(
      'query',
      paginationQuerySchema.extend({
        actorId: uuidSchema.optional(),
        entityType: z.string().max(40).optional(),
        entityId: uuidSchema.optional(),
        action: z.string().max(60).optional(),
        from: plainDateSchema.optional(),
        to: plainDateSchema.optional(),
      }),
    ),
    async (c) => c.json(await queryAudit(readDb(c), c.req.valid('query'))),
  )

  // Excel import: rows already parsed and mapped in the browser; validated and inserted here.
  .post('/import/commit', editor, zValidator('json', importCommitSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        commitImport(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
    ),
  )

  // Manual trigger of the daily jobs (admin), useful for demos and tests.
  .post('/jobs/daily', admin, async (c) => c.json(await runDailyJobs(c.env)));
