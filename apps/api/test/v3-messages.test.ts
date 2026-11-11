/**
 * Owner messages: an owner starts a thread (about one of their items or not), staff answer from
 * the inbox and the owner is pushed once per answer; unread counts on both sides; close, reopen
 * and assign with roles and audit rows; owner isolation for threads and their files; the hourly
 * limit on owner messages; text kept as plain text; the Today line.
 */
import { and, eq, inArray, like } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { OWNER_MESSAGES_PER_HOUR } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queueMessageReplyPush } from '../src/services/message-notifications.js';
import type { StaffToday } from '../src/services/today.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
let editor: string;
let viewer: string;
const PHONES = {
  khalid: '+971500000001',
  fatima: '+971500000002',
  omar: '+971500000003',
  mariam: '+971500000004',
  rashid: '+971500000005',
} as const;
type OwnerKey = keyof typeof PHONES;
const tok = {} as Record<OwnerKey, string>;
const oid = {} as Record<OwnerKey, string>;

interface Link {
  type: string;
  id: string;
  labelAr: string;
  labelEn: string;
}
interface Msg {
  id: string;
  senderType: 'owner' | 'staff';
  senderName: string | null;
  body: string;
  files: { id: string; fileName: string; mime: string }[];
}
interface Thread {
  id: string;
  subject: string;
  status: 'open' | 'closed';
  link: Link | null;
  lastSenderType: string;
  preview: string;
  unread: number;
  messages: Msg[];
}
interface StaffThread extends Thread {
  owner: { id: string; nameEn: string };
  assignedStaff: { id: string; name: string } | null;
  waiting: boolean;
}

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);

const post = <T>(path: string, token: string, body: unknown) =>
  w.json<T>(path, { method: 'POST', token, body: JSON.stringify(body) });
const startThread = (who: OwnerKey, body: Record<string, unknown>) =>
  post<Thread & { error?: { code: string } }>('/api/owner/messages', tok[who], body);
const ownerList = (who: OwnerKey) =>
  w.json<{ items: Thread[]; unreadThreads: number }>('/api/owner/messages', { token: tok[who] });
const staffThread = (id: string, token = viewer) =>
  w.json<StaffThread>(`/api/staff/messages/${id}`, { token });
const inbox = (query = '', token = viewer) =>
  w.json<{ items: StaffThread[]; nextCursor: string | null }>(`/api/staff/messages${query}`, {
    token,
  });
const replyPushes = () =>
  w.db
    .select({ entityId: schema.notificationLog.entityId, key: schema.notificationLog.dedupeKey })
    .from(schema.notificationLog)
    .where(eq(schema.notificationLog.type, 'message_reply'));
const auditOf = (threadId: string) =>
  w.db
    .select({
      action: schema.auditLog.action,
      actorType: schema.auditLog.actorType,
      after: schema.auditLog.after,
    })
    .from(schema.auditLog)
    .where(
      and(eq(schema.auditLog.entityId, threadId), like(schema.auditLog.action, 'message_thread.%')),
    )
    .orderBy(schema.auditLog.at);

let khalidCheque: { id: string; chequeNo: string | null };
let mariamUnit: string;

beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
  editor = await w.staffToken('entry@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  for (const k of Object.keys(PHONES) as OwnerKey[]) {
    tok[k] = await w.ownerToken(PHONES[k]);
    oid[k] = w.ids.owners[PHONES[k]]!;
  }
  // A phone that accepts pushes for every owner, so the pushes are recorded as sent.
  for (const id of Object.values(oid))
    await w.db.insert(schema.devices).values({
      ownerId: id,
      deviceId: `m-${id.slice(0, 8)}`,
      platform: 'android',
      pushToken: 'ExponentPushToken[messages]',
    });
  const cheques = await w.json<{ items: { id: string; chequeNo: string | null }[] }>(
    '/api/owner/cheques?limit=5',
    { token: tok.khalid },
  );
  khalidCheque = cheques.body.items[0]!;
  const khalidUnits = await w.json<{ items: { id: string }[] }>('/api/owner/units', {
    token: tok.khalid,
  });
  const mariamUnits = await w.json<{ items: { id: string }[] }>('/api/owner/units', {
    token: tok.mariam,
  });
  const mine = new Set(khalidUnits.body.items.map((u) => u.id));
  mariamUnit = mariamUnits.body.items.find((u) => !mine.has(u.id))!.id;
});
afterAll(() => w.close());

describe('the seed', () => {
  it('has one answered thread and one waiting, shown to staff and to their owners', async () => {
    const all = await inbox('?status=all');
    expect(all.status).toBe(200);
    expect(all.body.items.map((t) => [t.owner.nameEn, t.waiting, t.unread])).toEqual([
      ['Fatima Al Suwaidi', true, 1],
      ['Khalid Al Mansoori', false, 0],
    ]);
    const khalid = await ownerList('khalid');
    expect(khalid.body.unreadThreads).toBe(1);
    expect(khalid.body.items[0]).toMatchObject({ lastSenderType: 'staff', unread: 1 });
    expect(khalid.body.items[0]!.link).toMatchObject({ type: 'cheque' });
    expect((await ownerList('fatima')).body.unreadThreads).toBe(0);
  });
});

describe('an owner asks, staff answer', () => {
  let threadId: string;
  let answerId: string;

  it('starts a thread about one of their cheques, with the link labelled', async () => {
    const res = await startThread('khalid', {
      subject: '  Cheque \n question ',
      body: 'Has this cheque been deposited?',
      linkType: 'cheque',
      linkId: khalidCheque.id,
    });
    expect(res.status).toBe(201);
    threadId = res.body.id;
    expect(res.body).toMatchObject({
      subject: 'Cheque question',
      status: 'open',
      lastSenderType: 'owner',
      unread: 0,
      link: { type: 'cheque', id: khalidCheque.id },
    });
    if (khalidCheque.chequeNo) expect(res.body.link!.labelEn).toContain(khalidCheque.chequeNo);
    expect(res.body.messages).toEqual([
      expect.objectContaining({
        senderType: 'owner',
        senderName: null,
        body: 'Has this cheque been deposited?',
        files: [],
      }),
    ]);
  });

  it('shows in the inbox as waiting and unread, and in the counts', async () => {
    const waiting = await inbox('?waiting=1');
    const row = waiting.body.items.find((t) => t.id === threadId)!;
    expect(row).toMatchObject({
      waiting: true,
      unread: 1,
      preview: 'Has this cheque been deposited?',
    });
    expect(row.owner.nameEn).toBe('Khalid Al Mansoori');
    const counts = await w.json<{ unreadThreads: number; waiting: number }>(
      '/api/staff/messages/counts',
      { token: viewer },
    );
    expect(counts.body).toEqual({ unreadThreads: 2, waiting: 2 });
    const today = await w.json<StaffToday>('/api/staff/today', { token: viewer });
    expect(today.body.ownerMessages.waiting).toBe(2);
  });

  it('staff read it: their unread count drops, the owner’s does not move', async () => {
    expect((await post(`/api/staff/messages/${threadId}/read`, viewer, {})).status).toBe(200);
    expect((await staffThread(threadId)).body.unread).toBe(0);
    // Reading is not answering: still waiting.
    expect((await staffThread(threadId)).body.waiting).toBe(true);
  });

  it('a viewer cannot answer; data entry can, and the owner is pushed once', async () => {
    const refused = await post(`/api/staff/messages/${threadId}/messages`, viewer, { body: 'x' });
    expect(refused.status).toBe(403);
    const before = (await replyPushes()).length;
    const res = await post<{ id: string; threadId: string; senderType: string }>(
      `/api/staff/messages/${threadId}/messages`,
      editor,
      { body: 'Yes, it was deposited this morning.' },
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ threadId, senderType: 'staff' });
    answerId = res.body.id;
    await w.flush();
    const pushes = await replyPushes();
    expect(pushes).toHaveLength(before + 1);
    expect(pushes.find((p) => p.entityId === answerId)?.key).toContain(oid.khalid);
    // Running the push again (a retried request, a duplicate trigger) sends nothing more.
    expect(await queueMessageReplyPush(w.env, answerId)).toMatchObject({ sent: 0, skipped: 1 });
    expect(await replyPushes()).toHaveLength(before + 1);
    // An owner's own message never pushes the owner.
    expect(
      await queueMessageReplyPush(w.env, (await staffThread(threadId)).body.messages[0]!.id),
    ).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it('unread on both sides follows who wrote and who read', async () => {
    const staffSide = await staffThread(threadId);
    expect(staffSide.body).toMatchObject({ unread: 0, waiting: false, lastSenderType: 'staff' });
    expect(staffSide.body.messages.map((m) => [m.senderType, m.senderName])).toEqual([
      ['owner', null],
      ['staff', 'Noura Al Hammadi'],
    ]);
    const list = await ownerList('khalid');
    expect(list.body.items[0]).toMatchObject({ id: threadId, unread: 1 });
    expect(list.body.unreadThreads).toBe(2);
    // The push carries the answer's id; the app opens the thread from it.
    const fromPush = await w.json<Thread>(`/api/owner/messages/${answerId}`, { token: tok.khalid });
    expect(fromPush.status).toBe(200);
    expect(fromPush.body.id).toBe(threadId);
    expect(fromPush.body.unread).toBe(1);
    // Owners never see staff names.
    expect(fromPush.body.messages.map((m) => m.senderName)).toEqual([null, null]);
    expect((await post(`/api/owner/messages/${threadId}/read`, tok.khalid, {})).status).toBe(200);
    const after = await ownerList('khalid');
    expect(after.body.items.find((t) => t.id === threadId)!.unread).toBe(0);
    expect(after.body.unreadThreads).toBe(1);
    // The owner writes again: staff have one unread, the owner none.
    await post(`/api/owner/messages/${threadId}/messages`, tok.khalid, { body: 'Thank you' });
    expect((await staffThread(threadId)).body).toMatchObject({ unread: 1, waiting: true });
    expect((await ownerList('khalid')).body.items[0]).toMatchObject({ id: threadId, unread: 0 });
  });

  it('close, reopen and assign: data entry and admins only, each an audit row', async () => {
    const status = (token: string, s: string) =>
      post<{ changed: boolean; status: string }>(`/api/staff/messages/${threadId}/status`, token, {
        status: s,
      });
    expect((await status(viewer, 'closed')).status).toBe(403);
    expect((await status(editor, 'closed')).body).toMatchObject({
      status: 'closed',
      changed: true,
    });
    // Closing a closed thread writes nothing.
    expect((await status(admin, 'closed')).body.changed).toBe(false);
    expect((await inbox('?status=closed')).body.items.map((t) => t.id)).toContain(threadId);
    expect((await inbox()).body.items.map((t) => t.id)).not.toContain(threadId);
    expect((await status(admin, 'open')).body).toMatchObject({ status: 'open', changed: true });
    expect((await status(editor, 'pending')).status).toBe(422);

    const assign = (token: string, staffId: string | null) =>
      post(`/api/staff/messages/${threadId}/assign`, token, { staffId });
    const entryId = w.ids.staff['entry@vamar.test']!;
    expect((await assign(viewer, entryId)).status).toBe(403);
    // A viewer cannot answer, so a thread is never given to one.
    expect((await assign(admin, w.ids.staff['viewer@vamar.test']!)).status).toBe(422);
    expect((await assign(admin, entryId)).status).toBe(200);
    expect((await assign(admin, entryId)).status).toBe(200);
    expect((await staffThread(threadId)).body.assignedStaff).toEqual({
      id: entryId,
      name: 'Noura Al Hammadi',
    });
    const mine = await inbox('?assignedTo=me', editor);
    expect(mine.body.items.map((t) => t.id)).toEqual([threadId]);
    expect((await inbox('?assignedTo=none')).body.items.map((t) => t.id)).not.toContain(threadId);
    expect((await assign(editor, null)).status).toBe(200);

    expect((await auditOf(threadId)).map((a) => a.action)).toEqual([
      'message_thread.close',
      'message_thread.reopen',
      'message_thread.assign',
      'message_thread.assign',
    ]);
    const assignees = await w.json<{ items: { name: string; role: string }[] }>(
      '/api/staff/messages/assignees',
      { token: viewer },
    );
    expect(assignees.body.items.map((a) => a.role).sort()).toEqual(['admin', 'editor']);
  });

  it('an owner writing in a closed thread opens it again, on the record', async () => {
    await post(`/api/staff/messages/${threadId}/status`, editor, { status: 'closed' });
    const res = await post(`/api/owner/messages/${threadId}/messages`, tok.khalid, {
      body: 'One more question',
    });
    expect(res.status).toBe(201);
    expect((await staffThread(threadId)).body).toMatchObject({ status: 'open', waiting: true });
    const rows = await auditOf(threadId);
    expect(rows.at(-1)).toMatchObject({ action: 'message_thread.reopen', actorType: 'owner' });
  });

  it('filters the inbox by owner and by building, and pages with a cursor', async () => {
    const byOwner = await inbox(`?status=all&ownerId=${oid.fatima}`);
    expect(byOwner.body.items.every((t) => t.owner.id === oid.fatima)).toBe(true);
    expect(byOwner.body.items).toHaveLength(1);
    const [mariamBuilding] = await w.db
      .select({ id: schema.units.buildingId })
      .from(schema.units)
      .where(eq(schema.units.id, mariamUnit));
    // Nobody holding a unit in Mariam's building has written yet.
    expect((await inbox(`?status=all&buildingId=${mariamBuilding!.id}`)).body.items).toEqual([]);
    const first = await inbox('?status=all&limit=1');
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await inbox(`?status=all&limit=1&cursor=${first.body.nextCursor!}`);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0]!.id).not.toBe(first.body.items[0]!.id);
    expect((await inbox('?assignedTo=someone')).status).toBe(422);
  });
});

describe('what an owner may write', () => {
  it('needs text or a file, a whole link, and an item they can see', async () => {
    expect((await startThread('khalid', { subject: 'Hello', body: '   ' })).status).toBe(422);
    expect((await startThread('khalid', { subject: ' ', body: 'x' })).status).toBe(422);
    expect(
      (await startThread('khalid', { subject: 'x', body: 'x', linkType: 'cheque' })).status,
    ).toBe(422);
    expect((await startThread('khalid', { subject: 'x', body: 'x'.repeat(4001) })).status).toBe(
      422,
    );
    // Someone else's unit: the same 404 as for an id that does not exist.
    const other = await startThread('khalid', {
      subject: 'x',
      body: 'x',
      linkType: 'unit',
      linkId: mariamUnit,
    });
    expect(other.status).toBe(404);
    expect(
      (
        await startThread('khalid', {
          subject: 'x',
          body: 'x',
          linkType: 'dispute',
          linkId: '018f3f1e-7b4a-7c1d-9a2b-3c4d5e6f7a8b',
        })
      ).status,
    ).toBe(404);
    expect(
      (await w.request('/api/owner/messages', { method: 'POST', token: tok.khalid, body: '{' }))
        .status,
    ).toBe(422);
  });

  it('keeps text as plain text: markup comes back literally, line breaks made plain', async () => {
    const body = '<script>alert(1)</script>\r\n<b>bold</b> & "quotes"';
    const res = await startThread('rashid', { subject: '<i>Subject</i>', body });
    expect(res.status).toBe(201);
    expect(res.body.subject).toBe('<i>Subject</i>');
    expect(res.body.messages[0]!.body).toBe('<script>alert(1)</script>\n<b>bold</b> & "quotes"');
    const raw = await w.request(`/api/owner/messages/${res.body.id}`, { token: tok.rashid });
    expect(raw.headers.get('content-type')).toContain('application/json');
  });
});

describe('isolation', () => {
  it('an owner gets 404 on another owner’s thread, its messages and its files', async () => {
    const form = new FormData();
    form.set('subject', 'Photo of the leak');
    form.set('body', '');
    form.set('file', new File([PNG], 'leak.png', { type: 'image/png' }));
    const created = await w.json<Thread>('/api/owner/messages', {
      method: 'POST',
      token: tok.khalid,
      body: form,
    });
    expect(created.status).toBe(201);
    const thread = created.body;
    const msg = thread.messages[0]!;
    expect(msg.files).toEqual([
      expect.objectContaining({ fileName: 'leak.png', mime: 'image/png' }),
    ]);
    const fileId = msg.files[0]!.id;

    expect(
      (await w.request(`/api/owner/attachments/${fileId}`, { token: tok.khalid })).status,
    ).toBe(200);
    expect((await w.request(`/api/staff/attachments/${fileId}`, { token: viewer })).status).toBe(
      200,
    );

    const as = tok.fatima;
    expect((await w.request(`/api/owner/messages/${thread.id}`, { token: as })).status).toBe(404);
    expect((await w.request(`/api/owner/messages/${msg.id}`, { token: as })).status).toBe(404);
    expect(
      (await post(`/api/owner/messages/${thread.id}/messages`, as, { body: 'hi' })).status,
    ).toBe(404);
    expect((await post(`/api/owner/messages/${thread.id}/read`, as, {})).status).toBe(404);
    expect((await w.request(`/api/owner/attachments/${fileId}`, { token: as })).status).toBe(404);
    expect((await ownerList('fatima')).body.items.map((t) => t.id)).not.toContain(thread.id);
    // Staff tokens are not owner tokens, and the other way round.
    expect([401, 403]).toContain(
      (await w.request('/api/owner/messages', { token: viewer })).status,
    );
    expect([401, 403]).toContain((await w.request('/api/staff/messages', { token: as })).status);
  });

  it('files: images and PDFs up to the usual limit, one per message, never added later', async () => {
    const send = (file: File, extra?: File) => {
      const form = new FormData();
      form.set('subject', 'File');
      form.append('file', file);
      if (extra) form.append('file', extra);
      return w.json<Thread>('/api/owner/messages', { method: 'POST', token: tok.omar, body: form });
    };
    expect((await send(new File([new TextEncoder().encode('hello')], 'a.txt'))).status).toBe(422);
    expect((await send(new File([PNG], 'a.png'), new File([PNG], 'b.png'))).status).toBe(422);
    const [anyMessage] = await w.db
      .select({ id: schema.threadMessages.id })
      .from(schema.threadMessages)
      .limit(1);
    const form = new FormData();
    form.set('entityType', 'message');
    form.set('entityId', anyMessage!.id);
    form.set('file', new File([PNG], 'later.png'));
    expect(
      (await w.request('/api/staff/attachments', { method: 'POST', token: admin, body: form }))
        .status,
    ).toBe(422);
    // A staff answer may carry a file, which the owner can open.
    const [khalidThread] = (await ownerList('khalid')).body.items;
    const reply = new FormData();
    reply.set('body', 'The receipt');
    reply.set(
      'file',
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'receipt.pdf'),
    );
    const answered = await w.json<{ id: string }>(
      `/api/staff/messages/${khalidThread!.id}/messages`,
      { method: 'POST', token: editor, body: reply },
    );
    expect(answered.status).toBe(201);
    const detail = await w.json<Thread>(`/api/owner/messages/${khalidThread!.id}`, {
      token: tok.khalid,
    });
    const file = detail.body.messages.at(-1)!.files[0]!;
    expect(file).toMatchObject({ fileName: 'receipt.pdf', mime: 'application/pdf' });
    expect(
      (await w.request(`/api/owner/attachments/${file.id}`, { token: tok.khalid })).status,
    ).toBe(200);
    expect((await w.request(`/api/owner/attachments/${file.id}`, { token: tok.omar })).status).toBe(
      404,
    );
    await w.flush();
  });
});

describe('rate limit', () => {
  it(`allows ${String(OWNER_MESSAGES_PER_HOUR)} owner messages an hour, then 429`, async () => {
    const first = await startThread('mariam', { subject: 'Many', body: 'one' });
    expect(first.status).toBe(201);
    for (let i = 2; i <= OWNER_MESSAGES_PER_HOUR; i += 1) {
      const res = await post(`/api/owner/messages/${first.body.id}/messages`, tok.mariam, {
        body: `message ${String(i)}`,
      });
      expect(res.status, `message ${String(i)}`).toBe(201);
    }
    const over = await post<{ error: { code: string } }>(
      `/api/owner/messages/${first.body.id}/messages`,
      tok.mariam,
      { body: 'one too many' },
    );
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('rate_limited');
    expect((await startThread('mariam', { subject: 'New', body: 'x' })).status).toBe(429);
    // Nothing was written by the refused calls, and other owners are not affected.
    const rows = await w.db
      .select({ id: schema.threadMessages.id })
      .from(schema.threadMessages)
      .where(eq(schema.threadMessages.senderId, oid.mariam));
    expect(rows).toHaveLength(OWNER_MESSAGES_PER_HOUR);
    expect((await startThread('fatima', { subject: 'Still fine', body: 'x' })).status).toBe(201);
    // Staff answers are not limited by it.
    expect(
      (await post(`/api/staff/messages/${first.body.id}/messages`, editor, { body: 'ok' })).status,
    ).toBe(201);
    await w.flush();
  });
});

describe('the Today line', () => {
  it('counts open threads whose last message is the owner’s', async () => {
    const today = await w.json<StaffToday>('/api/staff/today', { token: viewer });
    const threads = await w.db
      .select({
        id: schema.messageThreads.id,
        status: schema.messageThreads.status,
        last: schema.messageThreads.lastSenderType,
      })
      .from(schema.messageThreads);
    const waiting = threads.filter((t) => t.status === 'open' && t.last === 'owner');
    expect(today.body.ownerMessages.waiting).toBe(waiting.length);
    const listed = await inbox('?waiting=1&limit=100');
    expect(listed.body.items.map((t) => t.id).sort()).toEqual(waiting.map((t) => t.id).sort());
    // Answering every waiting thread clears the line.
    for (const t of waiting)
      await post(`/api/staff/messages/${t.id}/messages`, editor, { body: 'Answered' });
    await w.flush();
    const after = await w.json<StaffToday>('/api/staff/today', { token: viewer });
    expect(after.body.ownerMessages).toEqual({ waiting: 0, oldestAt: null });
    const pushed = await replyPushes();
    const answers = await w.db
      .select({ id: schema.threadMessages.id })
      .from(schema.threadMessages)
      .where(
        and(
          eq(schema.threadMessages.senderType, 'staff'),
          inArray(
            schema.threadMessages.id,
            pushed.map((p) => p.entityId),
          ),
        ),
      );
    // Every push is about a staff message, one each.
    expect(answers).toHaveLength(pushed.length);
    expect(new Set(pushed.map((p) => p.entityId)).size).toBe(pushed.length);
  });
});
