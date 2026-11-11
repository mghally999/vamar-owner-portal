/**
 * One action on many expenses at once: post drafts, discard drafts, or show / hide posted
 * expenses from their owners. All or nothing, in the caller's transaction.
 */
import { inArray } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type { BulkExpenseActionInput, ExpenseStatus } from '@vamar/shared';
import type { Dbx } from '../db.js';
import { ApiError } from '../errors.js';
import { assertApprovalsAllow } from './approvals.js';
import { audit, type AuditActor } from './audit.js';
import { deleteDraft, postExpense, setExpenseVisibility } from './expenses.js';

const { expenses } = schema;

export type ExpenseBulkRejectionCode =
  'not_found' | 'not_draft' | 'not_posted' | 'approval_required' | 'cannot_allocate' | 'refused';

export interface ExpenseBulkRejection {
  id: string;
  invoiceNo: string | null;
  reasonAr: string | null;
  reasonEn: string | null;
  status: ExpenseStatus | null;
  code: ExpenseBulkRejectionCode;
  reason: string;
}

export interface ExpenseBulkResult {
  /** Every expense the action went through for, in the order asked. */
  updated: string[];
  /** Show / hide only: expenses that already had the value, so nothing was written for them. */
  unchanged: string[];
  /** Posted at or above the alert threshold: the route sends the same push a single post does. */
  largeExpenseIds: string[];
}

function codeFor(e: ApiError, action: BulkExpenseActionInput['action']): ExpenseBulkRejectionCode {
  if (e.code === 'approval_required') return 'approval_required';
  if (e.code === 'not_found') return 'not_found';
  // The only input a draft can fail on when posting is its split between the owners.
  if (e.code === 'validation' && action === 'post') return 'cannot_allocate';
  if (e.code === 'conflict')
    return action === 'show' || action === 'hide' ? 'not_posted' : 'not_draft';
  return 'refused';
}

/**
 * Status and existence are checked first in one read. Then every remaining expense goes through
 * the very function the single action uses (post with its approvals gate, discard, visibility),
 * so allocations, audit rows and the large-expense push are the ones a single action makes. A
 * refusal there is recorded and the run carries on, so staff see every refused expense at once;
 * the 422 at the end rolls the whole transaction back. Errors other than ApiError (a database
 * failure) are not caught and also undo everything.
 */
export async function bulkExpenseAction(
  db: Dbx,
  actor: AuditActor,
  input: BulkExpenseActionInput,
  largeExpenseAlertFils: number,
): Promise<ExpenseBulkResult> {
  const ids = [...new Set(input.ids)];
  const rows = await db
    .select({
      id: expenses.id,
      status: expenses.status,
      invoiceNo: expenses.invoiceNo,
      reasonAr: expenses.reasonAr,
      reasonEn: expenses.reasonEn,
    })
    .from(expenses)
    .where(inArray(expenses.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const wanted: ExpenseStatus =
    input.action === 'post' || input.action === 'discard' ? 'draft' : 'posted';

  const rejected: ExpenseBulkRejection[] = [];
  const reject = (id: string, code: ExpenseBulkRejectionCode, reason: string) => {
    const row = byId.get(id);
    rejected.push({
      id,
      invoiceNo: row?.invoiceNo ?? null,
      reasonAr: row?.reasonAr ?? null,
      reasonEn: row?.reasonEn ?? null,
      status: row?.status ?? null,
      code,
      reason,
    });
  };

  const result: ExpenseBulkResult = { updated: [], unchanged: [], largeExpenseIds: [] };
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      reject(id, 'not_found', 'Expense not found');
      continue;
    }
    if (row.status !== wanted) {
      reject(
        id,
        wanted === 'draft' ? 'not_draft' : 'not_posted',
        `Expense is ${row.status}, not ${wanted}`,
      );
      continue;
    }
    try {
      switch (input.action) {
        case 'post': {
          await assertApprovalsAllow(db, { expenseId: id });
          const r = await postExpense(db, actor, id, largeExpenseAlertFils);
          if (r.large) result.largeExpenseIds.push(id);
          break;
        }
        case 'discard':
          await deleteDraft(db, actor, id);
          break;
        case 'show':
        case 'hide': {
          const r = await setExpenseVisibility(db, actor, id, input.action === 'show', input.note);
          if (!r.changed) result.unchanged.push(id);
          break;
        }
      }
      result.updated.push(id);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      reject(id, codeFor(e, input.action), e.message);
    }
  }

  if (rejected.length) {
    const order = new Map(ids.map((id, i) => [id, i]));
    rejected.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    throw new ApiError(
      422,
      'invalid_transition',
      `${String(rejected.length)} of ${String(ids.length)} expenses cannot be ${PAST[input.action]}; nothing was changed`,
      { rejected },
    );
  }

  // One row for the batch itself, so the note and the selection are on record; each expense
  // already has the same audit row a single action writes.
  await audit(db, actor, {
    action: 'expense.bulk',
    entityType: 'expense',
    entityId: null,
    after: {
      action: input.action,
      ids: result.updated,
      unchanged: result.unchanged,
      ...(input.note ? { note: input.note } : {}),
    },
  });
  return result;
}

const PAST: Record<BulkExpenseActionInput['action'], string> = {
  post: 'posted',
  discard: 'discarded',
  show: 'shown to owners',
  hide: 'hidden from owners',
};
