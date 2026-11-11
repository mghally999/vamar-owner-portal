/**
 * Messages between owners and Vamar staff (v3). An owner sees and writes only in their own
 * threads (anyone else's is a 404, as is a link to an item outside their scope); staff see every
 * thread in the inbox. Messages are append-only and plain text; files go through the attachments
 * pipeline (entity type `message`, same types and size limit as invoices and job photos).
 *
 * Read receipts are one time per side on the thread: a side's unread count is the other side's
 * messages after that time. Writing a message counts as having read the thread.
 */
import { and, desc, eq, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  countUnread,
  messagePreview,
  type CreateThreadInput,
  type MessageLinkType,
  type MessageSenderType,
  type MessageThreadStatus,
  type StaffThreadQuery,
} from '@vamar/shared';
import { orSql, type Dbx } from '../db.js';
import { ApiError, notFound, validation } from '../errors.js';
import { decodeCursor, page } from '../util/pagination.js';
import { storeUpload } from './attachments.js';
import { audit, type AuditActor } from './audit.js';
import { expenseAttachmentInOwnerScope } from './expenses.js';
import { chequeInOwnerScope, disputeInOwnerScope, unitInOwnerScope } from './owner-scope.js';
import { workOrderAttachmentInOwnerScope } from './work-orders.js';

const {
  attachments,
  buildings,
  cheques,
  contracts,
  disputes,
  expenses,
  messageThreads: threads,
  owners,
  staffUsers,
  threadMessages: messages,
  unitOwnerships,
  units,
  workOrders,
} = schema;

/** Owners keep a short list; the newest threads are the ones that matter on a phone. */
export const OWNER_THREAD_LIMIT = 100;

export interface MessageLink {
  type: MessageLinkType;
  id: string;
  /** What the item is called (unit, cheque number, reason, title, case number); '' if gone. */
  labelAr: string;
  labelEn: string;
}

export interface MessageFile {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

export interface ThreadMessage {
  id: string;
  senderType: MessageSenderType;
  /** Staff screens only: who wrote it. Owners see "Vamar" for every staff message. */
  senderName: string | null;
  body: string;
  createdAt: Date;
  files: MessageFile[];
}

export interface ThreadSummary {
  id: string;
  subject: string;
  status: MessageThreadStatus;
  link: MessageLink | null;
  lastMessageAt: Date;
  lastSenderType: MessageSenderType;
  /** One line of the last message; '' when it was a file alone. */
  preview: string;
  /** The other side's messages this side has not read. */
  unread: number;
  createdAt: Date;
}

export interface StaffThreadSummary extends ThreadSummary {
  owner: { id: string; nameAr: string; nameEn: string };
  assignedStaff: { id: string; name: string } | null;
  /** Open and last written by the owner: waits for a staff answer. */
  waiting: boolean;
  closedAt: Date | null;
}

// Scope and labels --------------------------------------------------------------------------------

/** Whether the owner can see the item a thread is about (the same rules as their screens). */
export async function linkInOwnerScope(
  db: Dbx,
  ownerId: string,
  type: MessageLinkType,
  id: string,
): Promise<boolean> {
  switch (type) {
    case 'unit': {
      const rows = await db
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.id, id), unitInOwnerScope(db, ownerId)))
        .limit(1);
      return rows.length > 0;
    }
    case 'cheque': {
      const rows = await db
        .select({ id: cheques.id })
        .from(cheques)
        .innerJoin(contracts, eq(contracts.id, cheques.contractId))
        .where(
          and(eq(cheques.id, id), chequeInOwnerScope(db, ownerId), ne(contracts.status, 'draft')),
        )
        .limit(1);
      return rows.length > 0;
    }
    case 'expense':
      return expenseAttachmentInOwnerScope(db, ownerId, id);
    case 'work_order':
      return workOrderAttachmentInOwnerScope(db, ownerId, id);
    case 'dispute': {
      const rows = await db
        .select({ id: disputes.id })
        .from(disputes)
        .where(and(eq(disputes.id, id), disputeInOwnerScope(db, ownerId)))
        .limit(1);
      return rows.length > 0;
    }
  }
}

type Labels = Map<string, { labelAr: string; labelEn: string }>;
const linkKey = (type: string, id: string) => `${type}:${id}`;

/** Labels for the linked items of a page of threads: one query per kind of item present. */
async function linkLabels(
  db: Dbx,
  links: { type: MessageLinkType; id: string }[],
): Promise<Labels> {
  const out: Labels = new Map();
  const idsOf = (type: MessageLinkType) => [
    ...new Set(links.filter((l) => l.type === type).map((l) => l.id)),
  ];
  const unitIds = idsOf('unit');
  if (unitIds.length > 0) {
    const rows = await db
      .select({ id: units.id, unitNo: units.unitNo, ar: buildings.nameAr, en: buildings.nameEn })
      .from(units)
      .innerJoin(buildings, eq(buildings.id, units.buildingId))
      .where(inArray(units.id, unitIds));
    for (const r of rows)
      out.set(linkKey('unit', r.id), {
        labelAr: `${r.ar} ${r.unitNo}`,
        labelEn: `${r.en} ${r.unitNo}`,
      });
  }
  const chequeIds = idsOf('cheque');
  if (chequeIds.length > 0) {
    const rows = await db
      .select({
        id: cheques.id,
        chequeNo: cheques.chequeNo,
        unitNo: units.unitNo,
        ar: buildings.nameAr,
        en: buildings.nameEn,
      })
      .from(cheques)
      .innerJoin(contracts, eq(contracts.id, cheques.contractId))
      .innerJoin(units, eq(units.id, contracts.unitId))
      .innerJoin(buildings, eq(buildings.id, units.buildingId))
      .where(inArray(cheques.id, chequeIds));
    for (const r of rows) {
      const no = r.chequeNo ? `${r.chequeNo} · ` : '';
      out.set(linkKey('cheque', r.id), {
        labelAr: `${no}${r.ar} ${r.unitNo}`,
        labelEn: `${no}${r.en} ${r.unitNo}`,
      });
    }
  }
  const expenseIds = idsOf('expense');
  if (expenseIds.length > 0) {
    const rows = await db
      .select({ id: expenses.id, ar: expenses.reasonAr, en: expenses.reasonEn })
      .from(expenses)
      .where(inArray(expenses.id, expenseIds));
    for (const r of rows) out.set(linkKey('expense', r.id), { labelAr: r.ar, labelEn: r.en });
  }
  const workOrderIds = idsOf('work_order');
  if (workOrderIds.length > 0) {
    const rows = await db
      .select({ id: workOrders.id, ar: workOrders.titleAr, en: workOrders.titleEn })
      .from(workOrders)
      .where(inArray(workOrders.id, workOrderIds));
    for (const r of rows) out.set(linkKey('work_order', r.id), { labelAr: r.ar, labelEn: r.en });
  }
  const disputeIds = idsOf('dispute');
  if (disputeIds.length > 0) {
    const rows = await db
      .select({ id: disputes.id, caseNo: disputes.caseNo })
      .from(disputes)
      .where(inArray(disputes.id, disputeIds));
    for (const r of rows)
      out.set(linkKey('dispute', r.id), { labelAr: r.caseNo, labelEn: r.caseNo });
  }
  return out;
}

function linkOf(
  row: { linkType: MessageLinkType | null; linkId: string | null },
  labels: Labels,
): MessageLink | null {
  if (!row.linkType || !row.linkId) return null;
  const l = labels.get(linkKey(row.linkType, row.linkId));
  return {
    type: row.linkType,
    id: row.linkId,
    labelAr: l?.labelAr ?? '',
    labelEn: l?.labelEn ?? '',
  };
}

// Reading -----------------------------------------------------------------------------------------

/** The body of the thread's latest message. */
// Outer columns are named in full: drizzle leaves them unqualified in a query on one table, and
// inside these subqueries a bare "id" would be the message's own id.
const lastBody = sql<string>`(select m.body from ${messages} m
  where m.thread_id = "message_threads"."id" order by m.created_at desc, m.id desc limit 1)`;

/** The other side's messages after this side's last read. */
function unreadSql(side: MessageSenderType): SQL<number> {
  const other = side === 'owner' ? 'staff' : 'owner';
  const readAt = sql.raw(
    side === 'owner'
      ? '"message_threads"."owner_last_read_at"'
      : '"message_threads"."staff_last_read_at"',
  );
  return sql<number>`(select count(*)::int from ${messages} m
    where m.thread_id = "message_threads"."id" and m.sender_type = ${other}
      and m.created_at > coalesce(${readAt}, '-infinity'::timestamptz))`;
}

const summaryColumns = {
  id: threads.id,
  subject: threads.subject,
  status: threads.status,
  linkType: threads.linkType,
  linkId: threads.linkId,
  lastMessageAt: threads.lastMessageAt,
  lastSenderType: threads.lastSenderType,
  createdAt: threads.createdAt,
  lastBody,
};

interface SummaryRow {
  id: string;
  subject: string;
  status: MessageThreadStatus;
  linkType: MessageLinkType | null;
  linkId: string | null;
  lastMessageAt: Date;
  lastSenderType: MessageSenderType;
  createdAt: Date;
  lastBody: string | null;
  unread: number;
}

function summaryOf(r: SummaryRow, labels: Labels): ThreadSummary {
  return {
    id: r.id,
    subject: r.subject,
    status: r.status,
    link: linkOf(r, labels),
    lastMessageAt: r.lastMessageAt,
    lastSenderType: r.lastSenderType,
    preview: messagePreview(r.lastBody ?? ''),
    unread: r.unread,
    createdAt: r.createdAt,
  };
}

/** The owner's threads, latest activity first, and how many have an answer they have not read. */
export async function ownerThreads(db: Dbx, ownerId: string) {
  const rows = await db
    .select({ ...summaryColumns, unread: unreadSql('owner') })
    .from(threads)
    .where(eq(threads.ownerId, ownerId))
    .orderBy(desc(threads.lastMessageAt), desc(threads.id))
    .limit(OWNER_THREAD_LIMIT);
  const labels = await linkLabels(db, linksOf(rows));
  const items = rows.map((r) => summaryOf(r, labels));
  return { items, unreadThreads: items.filter((i) => i.unread > 0).length };
}

function linksOf(rows: { linkType: MessageLinkType | null; linkId: string | null }[]) {
  return rows.flatMap((r) => (r.linkType && r.linkId ? [{ type: r.linkType, id: r.linkId }] : []));
}

/** The messages of a thread, oldest first, with their files. */
async function threadMessagesOf(
  db: Dbx,
  threadId: string,
  withNames: boolean,
): Promise<ThreadMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      senderType: messages.senderType,
      body: messages.body,
      createdAt: messages.createdAt,
      staffName: staffUsers.name,
    })
    .from(messages)
    .leftJoin(
      staffUsers,
      and(eq(messages.senderType, 'staff'), eq(staffUsers.id, messages.senderId)),
    )
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt, messages.id);
  const files =
    rows.length === 0
      ? []
      : await db
          .select({
            id: attachments.id,
            entityId: attachments.entityId,
            fileName: attachments.fileName,
            mime: attachments.mime,
            sizeBytes: attachments.sizeBytes,
          })
          .from(attachments)
          .where(
            and(
              eq(attachments.entityType, 'message'),
              inArray(
                attachments.entityId,
                rows.map((r) => r.id),
              ),
            ),
          )
          .orderBy(attachments.createdAt);
  return rows.map((r) => ({
    id: r.id,
    senderType: r.senderType,
    senderName: withNames ? r.staffName : null,
    body: r.body,
    createdAt: r.createdAt,
    files: files.filter((f) => f.entityId === r.id).map(({ entityId: _e, ...f }) => f),
  }));
}

/**
 * One of the owner's threads with its messages. `id` is the thread's id, or the id of one of its
 * messages: the reply push carries the message (its dedupe key is per message), and the app opens
 * the thread from it.
 */
export async function ownerThreadDetail(db: Dbx, ownerId: string, id: string) {
  const [row] = await db
    .select({ ...summaryColumns, ownerLastReadAt: threads.ownerLastReadAt })
    .from(threads)
    .where(
      and(
        eq(threads.ownerId, ownerId),
        or(
          eq(threads.id, id),
          inArray(
            threads.id,
            db.select({ id: messages.threadId }).from(messages).where(eq(messages.id, id)),
          ),
        ),
      ),
    )
    .limit(1);
  if (!row) throw notFound('Thread');
  const list = await threadMessagesOf(db, row.id, false);
  const labels = await linkLabels(db, linksOf([row]));
  return {
    ...summaryOf({ ...row, unread: countUnread(list, 'owner', row.ownerLastReadAt) }, labels),
    messages: list,
  };
}

const ownerName = { id: owners.id, nameAr: owners.nameAr, nameEn: owners.nameEn };

/** The staff inbox: latest activity first, keyset on (last_message_at, id). */
export async function staffInbox(db: Dbx, staffId: string, q: StaffThreadQuery) {
  const cursor = decodeCursor(q.cursor);
  const conditions: SQL[] = [];
  if (q.status !== 'all') conditions.push(eq(threads.status, q.status));
  if (q.ownerId) conditions.push(eq(threads.ownerId, q.ownerId));
  // A building's threads: those of the owners holding a unit in it today.
  if (q.buildingId)
    conditions.push(sql`exists (select 1 from ${unitOwnerships} uo
      join ${units} u on u.id = uo.unit_id
      where uo.owner_id = ${threads.ownerId} and uo.to_date is null
        and u.building_id = ${q.buildingId})`);
  if (q.waiting)
    conditions.push(sql`${threads.status} = 'open' and ${threads.lastSenderType} = 'owner'`);
  if (q.assignedTo === 'none') conditions.push(isNull(threads.assignedStaffId));
  else if (q.assignedTo)
    conditions.push(eq(threads.assignedStaffId, q.assignedTo === 'me' ? staffId : q.assignedTo));
  if (cursor) {
    const key = new Date(cursor.key);
    conditions.push(
      orSql(
        lt(threads.lastMessageAt, key),
        and(eq(threads.lastMessageAt, key), lt(threads.id, cursor.id)),
      ),
    );
  }
  const rows = await db
    .select({
      ...summaryColumns,
      unread: unreadSql('staff'),
      closedAt: threads.closedAt,
      owner: ownerName,
      assignedId: staffUsers.id,
      assignedName: staffUsers.name,
    })
    .from(threads)
    .innerJoin(owners, eq(owners.id, threads.ownerId))
    .leftJoin(staffUsers, eq(staffUsers.id, threads.assignedStaffId))
    .where(and(...conditions))
    .orderBy(desc(threads.lastMessageAt), desc(threads.id))
    .limit(q.limit + 1);
  const labels = await linkLabels(db, linksOf(rows));
  const items: StaffThreadSummary[] = rows.map((r) => staffSummaryOf(r, labels));
  return page(items, q.limit, (r) => ({ key: r.lastMessageAt.toISOString(), id: r.id }));
}

function staffSummaryOf(
  r: SummaryRow & {
    closedAt: Date | null;
    owner: StaffThreadSummary['owner'];
    assignedId: string | null;
    assignedName: string | null;
  },
  labels: Labels,
): StaffThreadSummary {
  return {
    ...summaryOf(r, labels),
    owner: r.owner,
    assignedStaff: r.assignedId ? { id: r.assignedId, name: r.assignedName ?? '' } : null,
    waiting: r.status === 'open' && r.lastSenderType === 'owner',
    closedAt: r.closedAt,
  };
}

/** For the dashboard header: open threads with an owner message staff have not read, and waiting. */
export async function staffMessageCounts(db: Dbx) {
  const [row] = await db
    .select({
      unreadThreads: sql<number>`count(*) filter (where ${unreadSql('staff')} > 0)::int`,
      waiting: sql<number>`count(*) filter (where ${threads.lastSenderType} = 'owner')::int`,
    })
    .from(threads)
    .where(eq(threads.status, 'open'));
  return { unreadThreads: row?.unreadThreads ?? 0, waiting: row?.waiting ?? 0 };
}

export async function staffThreadDetail(db: Dbx, id: string) {
  const [row] = await db
    .select({
      ...summaryColumns,
      unread: unreadSql('staff'),
      closedAt: threads.closedAt,
      owner: ownerName,
      assignedId: staffUsers.id,
      assignedName: staffUsers.name,
    })
    .from(threads)
    .innerJoin(owners, eq(owners.id, threads.ownerId))
    .leftJoin(staffUsers, eq(staffUsers.id, threads.assignedStaffId))
    .where(eq(threads.id, id))
    .limit(1);
  if (!row) throw notFound('Thread');
  const labels = await linkLabels(db, linksOf([row]));
  return { ...staffSummaryOf(row, labels), messages: await threadMessagesOf(db, id, true) };
}

/** Staff who can answer and be given a thread (viewers only read). */
export async function messageAssignees(db: Dbx) {
  return db
    .select({ id: staffUsers.id, name: staffUsers.name, role: staffUsers.role })
    .from(staffUsers)
    .where(and(eq(staffUsers.active, true), inArray(staffUsers.role, ['admin', 'editor'])))
    .orderBy(staffUsers.name);
}

// Writing -----------------------------------------------------------------------------------------

export interface Sender {
  type: MessageSenderType;
  id: string;
}

function assertSomething(body: string, file: File | null): void {
  if (body === '' && !file)
    throw new ApiError(422, 'validation', 'Write a message or attach a file', [
      { path: 'body', message: 'Write a message or attach a file · اكتب رسالة أو أرفق ملفاً' },
    ]);
}

async function insertMessage(
  db: Dbx,
  bucket: R2Bucket,
  actor: AuditActor,
  sender: Sender,
  threadId: string,
  body: string,
  file: File | null,
  at: Date,
) {
  const [message] = await db
    .insert(messages)
    .values({ threadId, senderType: sender.type, senderId: sender.id, body, createdAt: at })
    .returning();
  if (!message) throw new Error('insert failed');
  // The row is written in this transaction and the object after it; a failed store rolls back.
  if (file)
    await storeUpload(db, bucket, actor, { entityType: 'message', entityId: message.id, file });
  return message;
}

/** An owner's new thread with its first message (and file). */
export async function createOwnerThread(
  db: Dbx,
  bucket: R2Bucket,
  actor: AuditActor,
  ownerId: string,
  input: CreateThreadInput,
  file: File | null,
): Promise<{ id: string; messageId: string }> {
  assertSomething(input.body, file);
  if (input.linkType && input.linkId) {
    if (!(await linkInOwnerScope(db, ownerId, input.linkType, input.linkId)))
      throw notFound('Linked item');
  }
  const now = new Date();
  const [thread] = await db
    .insert(threads)
    .values({
      ownerId,
      linkType: input.linkType ?? null,
      linkId: input.linkId ?? null,
      subject: input.subject,
      lastMessageAt: now,
      lastSenderType: 'owner',
      ownerLastReadAt: now,
      createdAt: now,
    })
    .returning({ id: threads.id });
  if (!thread) throw new Error('insert failed');
  const message = await insertMessage(
    db,
    bucket,
    actor,
    { type: 'owner', id: ownerId },
    thread.id,
    input.body,
    file,
    now,
  );
  return { id: thread.id, messageId: message.id };
}

/**
 * A message in an existing thread. Owners write only in their own (anyone else's is a 404); an
 * owner writing in a closed thread opens it again, since the question is not settled for them.
 */
export async function postMessage(
  db: Dbx,
  bucket: R2Bucket,
  actor: AuditActor,
  sender: Sender,
  threadId: string,
  body: string,
  file: File | null,
) {
  const [thread] = await db
    .select({ id: threads.id, ownerId: threads.ownerId, status: threads.status })
    .from(threads)
    .where(
      sender.type === 'owner'
        ? and(eq(threads.id, threadId), eq(threads.ownerId, sender.id))
        : eq(threads.id, threadId),
    )
    .for('update');
  if (!thread) throw notFound('Thread');
  assertSomething(body, file);
  const now = new Date();
  const message = await insertMessage(db, bucket, actor, sender, threadId, body, file, now);
  const reopen = sender.type === 'owner' && thread.status === 'closed';
  await db
    .update(threads)
    .set({
      lastMessageAt: now,
      lastSenderType: sender.type,
      ...(sender.type === 'owner' ? { ownerLastReadAt: now } : { staffLastReadAt: now }),
      ...(reopen ? { status: 'open' as const, closedAt: null } : {}),
    })
    .where(eq(threads.id, threadId));
  if (reopen)
    await audit(db, actor, {
      action: 'message_thread.reopen',
      entityType: 'message_thread',
      entityId: threadId,
      before: { status: 'closed' },
      after: { status: 'open', byOwnerMessage: message.id },
    });
  return { id: message.id, threadId, senderType: message.senderType, createdAt: message.createdAt };
}

/** This side has read the thread up to now. */
export async function markThreadRead(
  db: Dbx,
  side: MessageSenderType,
  threadId: string,
  ownerId?: string,
): Promise<void> {
  const now = new Date();
  const rows = await db
    .update(threads)
    .set(side === 'owner' ? { ownerLastReadAt: now } : { staffLastReadAt: now })
    .where(
      ownerId === undefined
        ? eq(threads.id, threadId)
        : and(eq(threads.id, threadId), eq(threads.ownerId, ownerId)),
    )
    .returning({ id: threads.id });
  if (rows.length === 0) throw notFound('Thread');
}

/** Close or reopen a thread (staff). Setting the status it already has writes nothing. */
export async function setThreadStatus(
  db: Dbx,
  actor: AuditActor,
  threadId: string,
  status: MessageThreadStatus,
) {
  const [thread] = await db
    .select({ status: threads.status })
    .from(threads)
    .where(eq(threads.id, threadId))
    .for('update');
  if (!thread) throw notFound('Thread');
  if (thread.status === status) return { id: threadId, status, changed: false };
  await db
    .update(threads)
    .set({ status, closedAt: status === 'closed' ? new Date() : null })
    .where(eq(threads.id, threadId));
  await audit(db, actor, {
    action: status === 'closed' ? 'message_thread.close' : 'message_thread.reopen',
    entityType: 'message_thread',
    entityId: threadId,
    before: { status: thread.status },
    after: { status },
  });
  return { id: threadId, status, changed: true };
}

/** Give a thread to a staff member who can answer, or to nobody. */
export async function assignThread(
  db: Dbx,
  actor: AuditActor,
  threadId: string,
  staffId: string | null,
) {
  const [thread] = await db
    .select({ assignedStaffId: threads.assignedStaffId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .for('update');
  if (!thread) throw notFound('Thread');
  if (staffId !== null) {
    const [member] = await db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(
        and(
          eq(staffUsers.id, staffId),
          eq(staffUsers.active, true),
          inArray(staffUsers.role, ['admin', 'editor']),
        ),
      );
    if (!member) throw validation('Assign the thread to an active admin or data entry user');
  }
  if (thread.assignedStaffId === staffId) return { id: threadId, assignedStaffId: staffId };
  await db.update(threads).set({ assignedStaffId: staffId }).where(eq(threads.id, threadId));
  await audit(db, actor, {
    action: 'message_thread.assign',
    entityType: 'message_thread',
    entityId: threadId,
    before: { assignedStaffId: thread.assignedStaffId },
    after: { assignedStaffId: staffId },
  });
  return { id: threadId, assignedStaffId: staffId };
}

/** Whether a message's files may go to this owner: the message is in one of their threads. */
export async function messageAttachmentInOwnerScope(
  db: Dbx,
  ownerId: string,
  messageId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(and(eq(messages.id, messageId), eq(threads.ownerId, ownerId)))
    .limit(1);
  return rows.length > 0;
}
