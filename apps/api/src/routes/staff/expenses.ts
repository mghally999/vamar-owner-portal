/** Staff API: expense categories, vendors, expenses and recurring rules (mounted by ../staff.ts). */
import { zValidator } from '../../util/validator.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  allocationPreviewSchema,
  auditReasonSchema,
  createExpenseCategorySchema,
  createExpenseSchema,
  createRecurringRuleSchema,
  createVendorSchema,
  expenseListQuerySchema,
  filsSchema,
  overrideApprovalsSchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
  updateRecurringRuleSchema,
  updateVendorSchema,
  uuidSchema,
} from '@vamar/shared';
import { staffOf } from '../../auth/middleware.js';
import { readDb, withTx } from '../../db.js';
import type { AppEnv } from '../../env.js';
import { queueApprovalRequests } from '../../services/approval-notifications.js';
import {
  assertApprovalsAllow,
  overrideApprovals,
  requestApprovals,
  staffApprovals,
} from '../../services/approvals.js';
import { actorFromContext } from '../../services/audit.js';
import {
  createCategory,
  createExpense,
  createRule,
  createVendor,
  deleteDraft,
  expenseWarnings,
  getExpenseDetail,
  listCategories,
  listExpenses,
  listRules,
  listVendors,
  optionalPeriod,
  postExpense,
  previewAllocation,
  updateCategory,
  updateExpense,
  updateRule,
  updateVendor,
  voidExpense,
} from '../../services/expenses.js';
import { queueLargeExpenseAlert } from '../../services/notifications.js';
import { getSettings } from '../../services/settings.js';
import { today } from '../../util/today.js';
import { admin, editor, idParam, viewer } from './common.js';

const flag = z
  .enum(['1', '0', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

export const expensesRoutes = new Hono<AppEnv>()
  // Categories (admin-managed) ----------------------------------------------------------------
  .get(
    '/expense-categories',
    viewer,
    zValidator('query', z.object({ includeInactive: flag })),
    async (c) =>
      c.json({ items: await listCategories(readDb(c), c.req.valid('query').includeInactive) }),
  )
  .post('/expense-categories', admin, zValidator('json', createExpenseCategorySchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createCategory(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .patch(
    '/expense-categories/:id',
    admin,
    idParam,
    zValidator('json', updateExpenseCategorySchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          updateCategory(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        ),
      ),
  )
  // Vendors -----------------------------------------------------------------------------------
  .get(
    '/vendors',
    viewer,
    zValidator(
      'query',
      z.object({ search: z.string().trim().max(80).optional(), includeInactive: flag }),
    ),
    async (c) => c.json({ items: await listVendors(readDb(c), c.req.valid('query')) }),
  )
  .post('/vendors', editor, zValidator('json', createVendorSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        createVendor(tx, actorFromContext(c, staffOf(c)), c.req.valid('json')),
      ),
      201,
    ),
  )
  .patch('/vendors/:id', editor, idParam, zValidator('json', updateVendorSchema), async (c) =>
    c.json(
      await withTx(c, (tx) =>
        updateVendor(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      ),
    ),
  )
  // Expenses ----------------------------------------------------------------------------------
  .get('/expenses', viewer, zValidator('query', expenseListQuerySchema), async (c) => {
    const db = readDb(c);
    const q = c.req.valid('query');
    const settings = await getSettings(db);
    return c.json(
      await listExpenses(db, { ...q, period: optionalPeriod(q, today(c.env), settings.weekStart) }),
    );
  })
  .post(
    '/expenses/preview-allocation',
    editor,
    zValidator('json', allocationPreviewSchema),
    async (c) => c.json(await previewAllocation(readDb(c), c.req.valid('json'))),
  )
  .post(
    '/expenses/warnings',
    editor,
    zValidator(
      'json',
      z.object({
        vendorId: uuidSchema.nullable().default(null),
        invoiceNo: z.string().trim().max(60).nullable().default(null),
        categoryId: uuidSchema,
        totalFils: filsSchema,
        excludeId: uuidSchema.optional(),
      }),
    ),
    async (c) =>
      c.json(await expenseWarnings(readDb(c), { ...c.req.valid('json'), today: today(c.env) })),
  )
  .post('/expenses', editor, zValidator('json', createExpenseSchema), async (c) => {
    const input = c.req.valid('json');
    const settings = await getSettings(readDb(c));
    // A variable draft at or above the approval threshold asks its owners in the same transaction.
    const { row, asked } = await withTx(c, async (tx) => {
      const actor = actorFromContext(c, staffOf(c));
      const created = await createExpense(tx, actor, input);
      const ids = await requestApprovals(
        tx,
        actor,
        { expenseId: created.id },
        settings.repairApprovalThresholdFils,
        today(c.env),
      );
      return { row: created, asked: ids };
    });
    if (asked.length) c.executionCtx.waitUntil(queueApprovalRequests(c.env, asked));
    const warnings = await expenseWarnings(readDb(c), {
      vendorId: row.vendorId,
      invoiceNo: row.invoiceNo,
      categoryId: row.categoryId,
      totalFils: row.totalFils,
      today: today(c.env),
      excludeId: row.id,
    });
    return c.json({ ...row, warnings }, 201);
  })
  /** The expense with each owner's answer when it (or the job it pays for) needed approval. */
  .get('/expenses/:id', viewer, idParam, async (c) => {
    const db = readDb(c);
    const id = c.req.valid('param').id;
    const [detail, settings] = await Promise.all([getExpenseDetail(db, id), getSettings(db)]);
    const approvals = await staffApprovals(
      db,
      { expenseId: id },
      settings.repairApprovalSilenceDays,
    );
    return c.json({ ...detail, approvals });
  })
  .patch('/expenses/:id', editor, idParam, zValidator('json', updateExpenseSchema), async (c) => {
    const settings = await getSettings(readDb(c));
    const id = c.req.valid('param').id;
    // A draft raised to (or above what the owners approved) asks them again.
    const { after, asked } = await withTx(c, async (tx) => {
      const actor = actorFromContext(c, staffOf(c));
      const updated = await updateExpense(tx, actor, id, c.req.valid('json'));
      const ids = await requestApprovals(
        tx,
        actor,
        { expenseId: id },
        settings.repairApprovalThresholdFils,
        today(c.env),
      );
      return { after: updated, asked: ids };
    });
    if (asked.length) c.executionCtx.waitUntil(queueApprovalRequests(c.env, asked));
    return c.json(after);
  })
  .delete('/expenses/:id', editor, idParam, async (c) =>
    c.json(
      await withTx(c, (tx) =>
        deleteDraft(tx, actorFromContext(c, staffOf(c)), c.req.valid('param').id),
      ),
    ),
  )
  .post('/expenses/:id/post', editor, idParam, async (c) => {
    const settings = await getSettings(readDb(c));
    const id = c.req.valid('param').id;
    const result = await withTx(c, async (tx) => {
      // Not while an owner's answer is pending or rejected (409 approval_required).
      await assertApprovalsAllow(tx, { expenseId: id });
      return postExpense(tx, actorFromContext(c, staffOf(c)), id, settings.largeExpenseAlertFils);
    });
    if (result.large) c.executionCtx.waitUntil(queueLargeExpenseAlert(c.env, result.expense.id));
    return c.json(result);
  })
  /** Admin: post over pending or rejected owner answers, with a reason for the audit log. */
  .post(
    '/expenses/:id/approvals/override',
    admin,
    idParam,
    zValidator('json', overrideApprovalsSchema),
    async (c) => {
      const id = c.req.valid('param').id;
      const items = await withTx(c, (tx) =>
        overrideApprovals(
          tx,
          actorFromContext(c, staffOf(c)),
          { expenseId: id },
          c.req.valid('json').reason,
        ),
      );
      return c.json({ items });
    },
  )
  .post(
    '/expenses/:id/void',
    admin,
    idParam,
    zValidator(
      'json',
      z.object({ reason: auditReasonSchema, correction: createExpenseSchema.optional() }),
    ),
    async (c) => {
      const settings = await getSettings(readDb(c));
      const body = c.req.valid('json');
      const result = await withTx(c, (tx) =>
        voidExpense(
          tx,
          actorFromContext(c, staffOf(c)),
          c.req.valid('param').id,
          body.reason,
          body.correction,
          settings.largeExpenseAlertFils,
        ),
      );
      if (result.correction?.large)
        c.executionCtx.waitUntil(queueLargeExpenseAlert(c.env, result.correction.expense.id));
      return c.json(result);
    },
  )
  // Recurring rules ---------------------------------------------------------------------------
  .get(
    '/recurring-rules',
    viewer,
    zValidator('query', z.object({ buildingId: uuidSchema.optional(), includeInactive: flag })),
    async (c) => c.json({ items: await listRules(readDb(c), c.req.valid('query')) }),
  )
  .post('/recurring-rules', editor, zValidator('json', createRecurringRuleSchema), async (c) =>
    c.json(
      await withTx(c, (tx) => createRule(tx, actorFromContext(c, staffOf(c)), c.req.valid('json'))),
      201,
    ),
  )
  .patch(
    '/recurring-rules/:id',
    editor,
    idParam,
    zValidator('json', updateRecurringRuleSchema),
    async (c) =>
      c.json(
        await withTx(c, (tx) =>
          updateRule(
            tx,
            actorFromContext(c, staffOf(c)),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        ),
      ),
  );
