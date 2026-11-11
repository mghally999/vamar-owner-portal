/**
 * The staff "Today" panel: what needs someone's action today, as counts with the date window
 * behind each one so the dashboard can link to the same rows in the list pages. One statement
 * returns the whole panel as one JSON document (the pattern of owner-summary.ts): one round trip.
 */
import { sql } from 'drizzle-orm';
import { addDays, type PlainDate } from '@vamar/shared';
import { statusIn, type Dbx } from '../db.js';
import { jsonColumn } from './owner-summary.js';

/** Cheques due after today and up to this many days ahead. */
export const TODAY_DUE_SOON_DAYS = 3;
/** Court hearings from today up to this many days ahead. */
export const TODAY_HEARING_DAYS = 7;
/** Active contracts ending within this many days that nobody has started a renewal for. */
export const TODAY_CONTRACT_ENDING_DAYS = 30;

/** Cheques that are still expected money: the same set as the overview's "due soon". */
const PENDING = ['upcoming', 'deposited'] as const;
/** Work orders that someone still has to finish. */
const OPEN_WORK = ['open', 'scheduled', 'in_progress'] as const;

export interface StaffToday {
  today: PlainDate;
  dueToday: { count: number; amountFils: number };
  dueSoon: { count: number; amountFils: number; from: PlainDate; to: PlainDate };
  /** The due dates span the cheque list's date filter for the link. */
  bouncedNoCase: {
    count: number;
    amountFils: number;
    oldestDueDate: PlainDate | null;
    newestDueDate: PlainDate | null;
  };
  hearings: { count: number; from: PlainDate; to: PlainDate; next: PlainDate | null };
  overdueWorkOrders: { count: number; oldestScheduledFor: PlainDate | null };
  expenseDrafts: {
    count: number;
    totalFils: number;
    oldestInvoiceDate: PlainDate | null;
    newestInvoiceDate: PlainDate | null;
  };
  contractsEnding: { count: number; from: PlainDate; to: PlainDate };
  /**
   * Owner approval of large repairs: jobs and expense drafts not started and held back by a
   * pending or rejected answer (the lists' `approval=awaiting`), how many of those an owner
   * rejected, and answers the daily job counted as approved by silence in the last 7 days.
   */
  ownerApprovals: {
    workOrders: number;
    expenses: number;
    rejected: number;
    silentLast7Days: number;
  };
}

type Figures = Omit<StaffToday, 'today' | 'dueSoon' | 'hearings' | 'contractsEnding'> & {
  dueSoon: { count: number; amountFils: number };
  hearings: { count: number; next: PlainDate | null };
  contractsEnding: { count: number };
};

export async function staffToday(db: Dbx, todayDate: PlainDate): Promise<StaffToday> {
  const soonFrom = addDays(todayDate, 1);
  const soonTo = addDays(todayDate, TODAY_DUE_SOON_DAYS);
  const hearingTo = addDays(todayDate, TODAY_HEARING_DAYS);
  const endingTo = addDays(todayDate, TODAY_CONTRACT_ENDING_DAYS);

  const result = await db.execute(sql`
    with pending as (
      select q.due_date, q.amount_fils from cheques q
      join contracts c on c.id = q.contract_id and c.status <> 'draft'
      where ${statusIn(sql`q.status`, PENDING)} and q.due_date between ${todayDate} and ${soonTo}
    ),
    -- A bounced cheque needs a case (or a replacement) until one exists; a closed case still
    -- counts as handled, so only cheques that were never put in a case are listed.
    bounced as (
      select q.due_date, q.amount_fils from cheques q
      where q.status = 'bounced'
        and not exists (select 1 from dispute_cheques dc where dc.cheque_id = q.id)
    ),
    -- Owner answers still holding a job back, on jobs not started and drafts not posted.
    blocking as (
      select a.work_order_id, a.expense_id, a.status from repair_approvals a
      left join work_orders w on w.id = a.work_order_id
      left join expenses x on x.id = a.expense_id
      where a.status in ('pending', 'rejected') and a.overridden_at is null
        and (w.status in ('open', 'scheduled') or x.status = 'draft')
    )
    select json_build_object(
      'dueToday', (select json_build_object('count', count(*)::int,
          'amountFils', coalesce(sum(amount_fils), 0)::bigint)
        from pending where due_date = ${todayDate}),
      'dueSoon', (select json_build_object('count', count(*)::int,
          'amountFils', coalesce(sum(amount_fils), 0)::bigint)
        from pending where due_date >= ${soonFrom}),
      'bouncedNoCase', (select json_build_object('count', count(*)::int,
          'amountFils', coalesce(sum(amount_fils), 0)::bigint,
          'oldestDueDate', min(due_date), 'newestDueDate', max(due_date))
        from bounced),
      'hearings', (select json_build_object('count', count(*)::int, 'next', min(d.next_hearing_date))
        from disputes d
        where d.status <> 'closed' and d.next_hearing_date between ${todayDate} and ${hearingTo}),
      'overdueWorkOrders', (select json_build_object('count', count(*)::int,
          'oldestScheduledFor', min(w.scheduled_for))
        from work_orders w
        where ${statusIn(sql`w.status`, OPEN_WORK)} and w.scheduled_for < ${todayDate}),
      'expenseDrafts', (select json_build_object('count', count(*)::int,
          'totalFils', coalesce(sum(x.total_fils), 0)::bigint,
          'oldestInvoiceDate', min(x.invoice_date), 'newestInvoiceDate', max(x.invoice_date))
        from expenses x where x.status = 'draft'),
      -- Any later contract pointing back at this one is its renewal, draft or already active:
      -- the same rule as the overview's "renewal drafted" mark.
      'contractsEnding', (select json_build_object('count', count(*)::int)
        from contracts c
        where c.status = 'active' and c.end_date between ${todayDate} and ${endingTo}
          and not exists (select 1 from contracts r where r.previous_contract_id = c.id)),
      'ownerApprovals', (select json_build_object(
          'workOrders', count(distinct b.work_order_id)::int,
          'expenses', count(distinct b.expense_id)::int,
          'rejected', (select count(distinct coalesce(r.work_order_id, r.expense_id))::int
            from blocking r where r.status = 'rejected'),
          'silentLast7Days', (select count(*)::int from repair_approvals s
            where s.status = 'approved_by_silence' and s.answered_at >= now() - interval '7 days'))
        from blocking b)
    ) as today`);

  const f = jsonColumn(result, 'today') as Figures;
  return {
    today: todayDate,
    dueToday: f.dueToday,
    dueSoon: { ...f.dueSoon, from: soonFrom, to: soonTo },
    bouncedNoCase: f.bouncedNoCase,
    hearings: { ...f.hearings, from: todayDate, to: hearingTo },
    overdueWorkOrders: f.overdueWorkOrders,
    expenseDrafts: f.expenseDrafts,
    contractsEnding: { ...f.contractsEnding, from: todayDate, to: endingTo },
    ownerApprovals: f.ownerApprovals,
  };
}
