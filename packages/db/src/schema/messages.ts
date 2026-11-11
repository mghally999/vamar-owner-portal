import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { MAX_MESSAGE_LENGTH, MAX_THREAD_SUBJECT_LENGTH } from '@vamar/shared';
import { createdAt, id, instant } from './_common.js';
import { messageLinkType, messageThreadStatus, subjectType } from './enums.js';
import { owners } from './owners.js';
import { staffUsers } from './staff.js';

/**
 * A conversation between one owner and Vamar staff, optionally about one item the owner can see
 * (a unit, cheque, expense, work order or case; the id is checked against the owner's scope when
 * the thread starts, so it has no foreign key). Read receipts are one time per side: staff share
 * theirs, since any of them may answer.
 */
export const messageThreads = pgTable(
  'message_threads',
  {
    id: id(),
    ownerId: uuid()
      .notNull()
      .references(() => owners.id),
    linkType: messageLinkType(),
    linkId: uuid(),
    subject: text().notNull(),
    status: messageThreadStatus().notNull().default('open'),
    assignedStaffId: uuid().references(() => staffUsers.id),
    /** Kept with the last message so the inbox sorts and filters without reading the messages. */
    lastMessageAt: instant().notNull().defaultNow(),
    lastSenderType: subjectType().notNull(),
    ownerLastReadAt: instant(),
    staffLastReadAt: instant(),
    closedAt: instant(),
    createdAt: createdAt(),
  },
  (t) => [
    /** The staff inbox: open or closed, latest activity first. */
    index('message_threads_inbox_idx').on(t.status, t.lastMessageAt.desc(), t.id.desc()),
    /** The owner's own list, and the inbox filtered by owner. */
    index('message_threads_owner_idx').on(t.ownerId, t.lastMessageAt.desc(), t.id.desc()),
    /** Threads waiting for a staff answer: the Today line and the inbox's "waiting" filter. */
    index('message_threads_waiting_idx')
      .on(t.lastMessageAt)
      .where(sql`${t.status} = 'open' AND ${t.lastSenderType} = 'owner'`),
    check('message_threads_link_whole', sql`(${t.linkType} IS NULL) = (${t.linkId} IS NULL)`),
    check(
      'message_threads_subject_length',
      sql`char_length(${t.subject}) BETWEEN 1 AND ${sql.raw(String(MAX_THREAD_SUBJECT_LENGTH))}`,
    ),
  ],
);

/**
 * The messages of a thread, append-only: nothing is edited or deleted, so what an owner was told
 * stays on record. `senderId` is the owner's or the staff member's id, as `senderType` says.
 * Photos and PDFs are attachments rows with entity type `message`.
 */
export const threadMessages = pgTable(
  'thread_messages',
  {
    id: id(),
    threadId: uuid()
      .notNull()
      .references(() => messageThreads.id),
    senderType: subjectType().notNull(),
    senderId: uuid().notNull(),
    body: text().notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    index('thread_messages_thread_idx').on(t.threadId, t.createdAt, t.id),
    check(
      'thread_messages_body_length',
      sql`char_length(${t.body}) <= ${sql.raw(String(MAX_MESSAGE_LENGTH))}`,
    ),
  ],
);
