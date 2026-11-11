import { describe, expect, it } from 'vitest';
import {
  awaitingStaffReply,
  countUnread,
  defaultThreadSubject,
  MAX_MESSAGE_LENGTH,
  MAX_THREAD_SUBJECT_LENGTH,
  messagePreview,
  normalizeMessageText,
  normalizeSubject,
  textLength,
} from './owner-messages.js';
import {
  assignThreadSchema,
  createThreadSchema,
  messageReplySchema,
  staffThreadQuerySchema,
  threadStatusSchema,
} from './schemas/messages.js';
import { notificationCopy } from './i18n/notifications.js';
import { MESSAGE_THREAD_STATUS_LABEL, NOTIFICATION_TYPE_LABEL } from './index.js';

const UUID = '018f3f1e-7b4a-7c1d-9a2b-3c4d5e6f7a8b';

describe('message text', () => {
  it('keeps the text as typed, markup included, with line breaks made plain', () => {
    expect(normalizeMessageText('  <b>hi</b>\r\nsecond\rthird \n')).toBe(
      '<b>hi</b>\nsecond\nthird',
    );
    expect(normalizeMessageText('a\u0000b\u0007c\td\u007f')).toBe('abc\td');
    expect(normalizeMessageText('مرحبا‏')).toBe('مرحبا‏');
  });

  it('makes a subject one line', () => {
    expect(normalizeSubject(' Cheque\n 849342\t\tAl Noor ')).toBe('Cheque 849342 Al Noor');
  });

  it('counts code points, as the database does', () => {
    expect(textLength('abc')).toBe(3);
    expect(textLength('😀😀')).toBe(2);
    expect(textLength('فامار')).toBe(5);
  });

  it('previews one line and cuts on a code point', () => {
    expect(messagePreview('one\n\ntwo  three')).toBe('one two three');
    expect(messagePreview('abcdef', 4)).toBe('abc…');
    expect(messagePreview('😀😀😀😀', 3)).toBe('😀😀…');
    expect(messagePreview('ab cdef', 4)).toBe('ab…');
    expect(messagePreview('x'.repeat(140))).toHaveLength(140);
  });
});

describe('thread state', () => {
  it('waits for staff only while open and last written by the owner', () => {
    expect(awaitingStaffReply({ status: 'open', lastSenderType: 'owner' })).toBe(true);
    expect(awaitingStaffReply({ status: 'open', lastSenderType: 'staff' })).toBe(false);
    expect(awaitingStaffReply({ status: 'closed', lastSenderType: 'owner' })).toBe(false);
  });

  it('counts the other side’s messages after the last read', () => {
    const msgs = [
      { senderType: 'owner' as const, createdAt: '2026-11-01T08:00:00Z' },
      { senderType: 'staff' as const, createdAt: '2026-11-01T09:00:00Z' },
      { senderType: 'owner' as const, createdAt: new Date('2026-11-01T10:00:00Z') },
    ];
    expect(countUnread(msgs, 'staff', null)).toBe(2);
    expect(countUnread(msgs, 'staff', '2026-11-01T08:00:00Z')).toBe(1);
    expect(countUnread(msgs, 'owner', null)).toBe(1);
    expect(countUnread(msgs, 'owner', new Date('2026-11-01T09:00:00Z'))).toBe(0);
  });

  it('prefills the subject from the linked item, in both languages, within the limit', () => {
    expect(defaultThreadSubject('cheque', '849342', 'en')).toBe('Cheque 849342');
    expect(defaultThreadSubject('unit', 'برج النور 801', 'ar')).toBe('الوحدة برج النور 801');
    expect(defaultThreadSubject('work_order', 'Lift\nrepair', 'en')).toBe('Work order Lift repair');
    const long = defaultThreadSubject('expense', 'x'.repeat(400), 'en');
    expect(textLength(long)).toBe(MAX_THREAD_SUBJECT_LENGTH);
  });
});

describe('message schemas', () => {
  it('a new thread needs a subject; the link comes whole or not at all', () => {
    expect(createThreadSchema.parse({ subject: ' Hello\nthere ', body: ' hi ' })).toEqual({
      subject: 'Hello there',
      body: 'hi',
    });
    expect(createThreadSchema.parse({ subject: 'x' })).toEqual({ subject: 'x', body: '' });
    expect(createThreadSchema.safeParse({ subject: '  ', body: 'x' }).success).toBe(false);
    expect(createThreadSchema.safeParse({ subject: 'x'.repeat(201) }).success).toBe(false);
    expect(
      createThreadSchema.safeParse({ subject: 'x', linkType: 'cheque', linkId: UUID }).success,
    ).toBe(true);
    expect(createThreadSchema.safeParse({ subject: 'x', linkType: 'cheque' }).success).toBe(false);
    expect(createThreadSchema.safeParse({ subject: 'x', linkId: UUID }).success).toBe(false);
    expect(
      createThreadSchema.safeParse({ subject: 'x', linkType: 'contract', linkId: UUID }).success,
    ).toBe(false);
  });

  it('a message is at most 4,000 characters after clean-up', () => {
    expect(
      messageReplySchema.parse({ body: `  ${'a'.repeat(MAX_MESSAGE_LENGTH)}  ` }).body,
    ).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(messageReplySchema.safeParse({ body: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) }).success).toBe(
      false,
    );
    expect(messageReplySchema.parse({})).toEqual({ body: '' });
  });

  it('the inbox query has its defaults and its filters', () => {
    expect(staffThreadQuerySchema.parse({})).toEqual({ status: 'open', waiting: false, limit: 50 });
    expect(
      staffThreadQuerySchema.parse({
        status: 'all',
        waiting: '1',
        assignedTo: 'me',
        ownerId: UUID,
      }),
    ).toMatchObject({ status: 'all', waiting: true, assignedTo: 'me', ownerId: UUID });
    expect(staffThreadQuerySchema.safeParse({ assignedTo: 'someone' }).success).toBe(false);
    expect(staffThreadQuerySchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(threadStatusSchema.safeParse({ status: 'closed' }).success).toBe(true);
    expect(assignThreadSchema.parse({ staffId: null })).toEqual({ staffId: null });
  });
});

describe('message copy', () => {
  it('the reply push names the subject only, in the owner’s language', () => {
    const en = notificationCopy({ type: 'message_reply', subject: 'Cheque 849342' }, 'en');
    expect(en).toEqual({
      title: 'New reply from Vamar',
      body: 'About "Cheque 849342". Open the app to read it.',
    });
    const ar = notificationCopy({ type: 'message_reply', subject: 'الشيك 849342' }, 'ar');
    expect(ar.title).toBe('رد جديد من فامار');
    expect(ar.body).toContain('«الشيك 849342»');
    expect(NOTIFICATION_TYPE_LABEL.message_reply.en).toBe('Message reply');
    expect(MESSAGE_THREAD_STATUS_LABEL.closed).toEqual({ ar: 'مغلقة', en: 'Closed' });
  });
});
