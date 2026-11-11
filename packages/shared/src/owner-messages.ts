/**
 * Messages between owners and Vamar staff (v3). An owner starts a thread, optionally about one of
 * their units, cheques, expenses, work orders or cases; staff answer from the dashboard inbox.
 * Text is plain text end to end: it is stored as typed (after the clean-up below) and every screen
 * renders it as text, never as HTML.
 */
import type { Lang } from './dates.js';

export const MESSAGE_THREAD_STATUSES = ['open', 'closed'] as const;
export type MessageThreadStatus = (typeof MESSAGE_THREAD_STATUSES)[number];

export const MESSAGE_SENDER_TYPES = ['owner', 'staff'] as const;
export type MessageSenderType = (typeof MESSAGE_SENDER_TYPES)[number];

/** What a thread can be about; the owner must be able to see the item to link it. */
export const MESSAGE_LINK_TYPES = ['unit', 'cheque', 'expense', 'work_order', 'dispute'] as const;
export type MessageLinkType = (typeof MESSAGE_LINK_TYPES)[number];

/** Characters (code points, as Postgres counts them) in one message. */
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_THREAD_SUBJECT_LENGTH = 200;
/** The inbox and the owner's list show this much of the last message. */
export const MESSAGE_PREVIEW_LENGTH = 140;
/** Messages an owner may send in an hour, new threads and replies together. */
export const OWNER_MESSAGES_PER_HOUR = 20;

/** Control characters other than tab and line feed: invisible, and some confuse terminals or CSV. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * The text as stored: Windows and old Mac line breaks become `\n`, control characters go, and
 * leading and trailing blank space is trimmed. Nothing else changes; markup stays literal text.
 */
export function normalizeMessageText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
}

/** A subject is one line: line breaks and runs of spaces become one space. */
export function normalizeSubject(text: string): string {
  return normalizeMessageText(text).replace(/\s+/g, ' ');
}

/**
 * Code points, the unit Postgres's char_length counts, so the app, the API and the database agree
 * on the 4,000 limit (a flag emoji counts as two, as it does in the database).
 */
function codePoints(text: string): string[] {
  return Array.from(text);
}

/** Length in code points, as in the database. */
export function textLength(text: string): number {
  return codePoints(text).length;
}

/** One line of the last message for a list, cut on a code point with an ellipsis. */
export function messagePreview(body: string, max: number = MESSAGE_PREVIEW_LENGTH): string {
  const line = body.replace(/\s+/g, ' ').trim();
  const chars = codePoints(line);
  if (chars.length <= max) return line;
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

/** An open thread whose last message is the owner's waits for a staff answer (the Today line). */
export function awaitingStaffReply(thread: {
  status: MessageThreadStatus;
  lastSenderType: MessageSenderType;
}): boolean {
  return thread.status === 'open' && thread.lastSenderType === 'owner';
}

/**
 * Messages one side has not read: the other side's messages after this side last opened the
 * thread (never opened: all of them). A side's own messages are never unread to it.
 */
export function countUnread(
  messages: readonly { senderType: MessageSenderType; createdAt: Date | string }[],
  side: MessageSenderType,
  lastReadAt: Date | string | null,
): number {
  const since = lastReadAt === null ? null : new Date(lastReadAt).getTime();
  return messages.filter(
    (m) => m.senderType !== side && (since === null || new Date(m.createdAt).getTime() > since),
  ).length;
}

/** What each kind of linked item is called, for the prefilled subject and the link labels. */
export const MESSAGE_LINK_LABEL: Record<MessageLinkType, Record<Lang, string>> = {
  unit: { ar: 'الوحدة', en: 'Unit' },
  cheque: { ar: 'الشيك', en: 'Cheque' },
  expense: { ar: 'المصروف', en: 'Expense' },
  work_order: { ar: 'أعمال الصيانة', en: 'Work order' },
  dispute: { ar: 'القضية', en: 'Case' },
};

/** The subject an "Ask Vamar about this" thread starts with, e.g. "Cheque 849342". */
export function defaultThreadSubject(type: MessageLinkType, label: string, lang: Lang): string {
  const subject = normalizeSubject(`${MESSAGE_LINK_LABEL[type][lang]} ${label}`);
  const chars = codePoints(subject);
  return chars.length <= MAX_THREAD_SUBJECT_LENGTH
    ? subject
    : chars.slice(0, MAX_THREAD_SUBJECT_LENGTH).join('').trimEnd();
}
