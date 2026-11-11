// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiCall } from '@/test/api';
import { building, page } from '@/test/fixtures';
import { v2Routes } from '@/test/fixtures-v2';
import { pickOption, renderApp } from '@/test/render';
import type { ThreadDetail, ThreadRow } from './messages-queries';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const row = (o: Partial<ThreadRow> = {}): ThreadRow => ({
  id: 'thr-1',
  subject: 'Cheque 849342',
  status: 'open',
  link: {
    type: 'cheque',
    id: 'chq-1',
    labelAr: '849342 · برج النور 801',
    labelEn: '849342 · Al Noor Tower 801',
  },
  lastMessageAt: '2026-10-06T14:20:00.000Z',
  lastSenderType: 'owner',
  preview: 'Is this cheque going to be deposited on time?',
  unread: 2,
  createdAt: '2026-10-06T14:20:00.000Z',
  owner: { id: 'own-1', nameAr: 'خالد المنصوري', nameEn: 'Khalid Al Mansoori' },
  assignedStaff: null,
  waiting: true,
  closedAt: null,
  ...o,
});

const answered = row({
  id: 'thr-2',
  subject: 'الوحدة برج النور 1205',
  link: null,
  lastSenderType: 'staff',
  preview: 'We will send a technician on Tuesday.',
  unread: 0,
  waiting: false,
  owner: { id: 'own-2', nameAr: 'فاطمة السويدي', nameEn: 'Fatima Al Suwaidi' },
  assignedStaff: { id: 'staff-me', name: 'Mariam Haddad' },
});

const detail = (o: Partial<ThreadDetail> = {}): ThreadDetail => ({
  ...row(),
  messages: [
    {
      id: 'msg-1',
      senderType: 'owner',
      senderName: null,
      body: '<b>x</b>\nsecond line',
      createdAt: '2026-10-06T14:20:00.000Z',
      files: [{ id: 'att-1', fileName: 'cheque.jpg', mime: 'image/jpeg', sizeBytes: 52_000 }],
    },
    {
      id: 'msg-2',
      senderType: 'staff',
      senderName: 'Salem Al Marri',
      body: 'وعليكم السلام، الشيك مسجّل لدينا.',
      createdAt: '2026-10-06T15:00:00.000Z',
      files: [],
    },
  ],
  ...o,
});

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/messages': { items: [row(), answered], nextCursor: null },
    'GET /api/staff/messages/counts': { unreadThreads: 1, waiting: 1 },
    'GET /api/staff/messages/assignees': {
      items: [
        { id: 'staff-me', name: 'Mariam Haddad', role: 'admin' },
        { id: 'staff-2', name: 'Noura Al Hammadi', role: 'editor' },
      ],
    },
    'GET /api/staff/messages/thr-1': detail(),
    'POST /api/staff/messages/thr-1/read': { ok: true },
    'POST /api/staff/messages/thr-1/messages': (c: ApiCall) => ({ id: 'msg-3', body: c.body }),
    'POST /api/staff/messages/thr-1/status': { id: 'thr-1', status: 'closed', changed: true },
    'POST /api/staff/messages/thr-1/assign': { id: 'thr-1', assignedStaffId: 'staff-2' },
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/owners': page([]),
    ...extra,
  });

describe('/messages inbox', () => {
  it('lists threads with unread and waiting marks, and the filters go to the API', async () => {
    const { api, user, router } = await renderApp('/messages', { routes: routes() });
    expect(await screen.findByRole('heading', { name: 'Owner messages' })).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Owner messages' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [first, second] = items as [HTMLElement, HTMLElement];
    expect(within(first).getByText('Cheque 849342')).toBeTruthy();
    expect(within(first).getByText('Khalid Al Mansoori')).toBeTruthy();
    expect(within(first).getByText('2 unread')).toBeTruthy();
    expect(within(first).getByText('Waiting for an answer')).toBeTruthy();
    expect(within(second).getByText('Vamar: We will send a technician on Tuesday.')).toBeTruthy();
    expect(within(second).getByText('Assigned to Mariam Haddad')).toBeTruthy();
    expect(within(second).queryByText(/unread/)).toBeNull();
    expect(api.last('GET', '/api/staff/messages').query).toEqual({ status: 'open', limit: '50' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'all');
    await user.click(screen.getByRole('checkbox', { name: 'Waiting for an answer only' }));
    await user.click(screen.getByRole('checkbox', { name: 'Assigned to me only' }));
    await pickOption(user, screen.getByRole('combobox', { name: 'Building' }), 'bld-1');
    await waitFor(() => {
      expect(api.last('GET', '/api/staff/messages').query).toEqual({
        status: 'all',
        waiting: '1',
        assignedTo: 'me',
        buildingId: 'bld-1',
        limit: '50',
      });
    });
    expect(router.state.location.search).toMatchObject({ status: 'all', waiting: 1, mine: 1 });

    // The filtered list is a new render: take the row again before opening it.
    const fresh = await screen.findByRole('list', { name: 'Owner messages' });
    await user.click(within(fresh).getByRole('link', { name: /Cheque 849342/ }));
    await screen.findByRole('heading', { name: 'Cheque 849342', level: 1 });
    expect(router.state.location.pathname).toBe('/messages/thr-1');
  });

  it('opens filtered from the Today tile, and says so when nothing matches', async () => {
    const { api } = await renderApp('/messages?waiting=1', {
      routes: routes({ 'GET /api/staff/messages': { items: [], nextCursor: null } }),
    });
    expect(await screen.findByText('No messages match these filters.')).toBeTruthy();
    expect(api.last('GET', '/api/staff/messages').query).toMatchObject({ waiting: '1' });
    expect(
      (screen.getByRole('checkbox', { name: 'Waiting for an answer only' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('shows the unread count on the header link, in Arabic too', async () => {
    await renderApp('/messages', { lang: 'ar', routes: routes() });
    expect(await screen.findByRole('heading', { name: 'رسائل الملاك' })).toBeTruthy();
    const links = await screen.findAllByRole('link', { name: 'رسائل الملاك، 1 غير مقروءة' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.getAttribute('href')).toBe('/messages');
    const list = await screen.findByRole('list', { name: 'رسائل الملاك' });
    expect(within(list).getByText('2 غير مقروءة')).toBeTruthy();
    expect(within(list).getByText('بانتظار الرد')).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('/messages/$threadId', () => {
  it('shows the text exactly as written, the linked item and files, and marks it read', async () => {
    const { api, container } = await renderApp('/messages/thr-1', { routes: routes() });
    const thread = await screen.findByRole('list', { name: 'Cheque 849342' });
    // Markup an owner typed is text, never HTML.
    expect(within(thread).getByText(/<b>x<\/b>/)).toBeTruthy();
    expect(container.querySelector('main b')).toBeNull();
    expect(within(thread).getByText('وعليكم السلام، الشيك مسجّل لدينا.')).toBeTruthy();
    expect(within(thread).getByText('Salem Al Marri')).toBeTruthy();
    expect(
      within(thread)
        .getByRole('link', { name: /cheque\.jpg/ })
        .getAttribute('href'),
    ).toBe('/api/staff/attachments/att-1');
    const about = screen.getByRole('link', { name: 'Cheque 849342 · Al Noor Tower 801' });
    expect(about.getAttribute('href')).toBe('/cheques/chq-1');
    expect(screen.getByRole('link', { name: 'Khalid Al Mansoori' }).getAttribute('href')).toBe(
      '/owners/own-1',
    );
    await waitFor(() => {
      expect(api.to('POST', '/api/staff/messages/thr-1/read')).toHaveLength(1);
    });
    const main = screen.getByRole('main');
    const result = await axe.run(main, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

  it('answers, closes and assigns', async () => {
    const { api, user } = await renderApp('/messages/thr-1', { routes: routes() });
    await screen.findByRole('list', { name: 'Cheque 849342' });
    const send = screen.getByRole('button', { name: 'Send' });
    await user.click(send);
    expect(await screen.findByText('Write an answer or attach a file.')).toBeTruthy();
    expect(api.to('POST', '/api/staff/messages/thr-1/messages')).toHaveLength(0);

    const box = screen.getByRole('textbox', { name: 'Your answer to the owner' });
    await user.type(box, '  Deposited today.  ');
    expect(screen.getByText('16 / 4,000')).toBeTruthy();
    await user.click(send);
    await waitFor(() => {
      expect(api.last('POST', '/api/staff/messages/thr-1/messages').body).toEqual({
        body: 'Deposited today.',
      });
    });
    expect(await screen.findByText('Answer sent.')).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe('');

    await user.click(screen.getByRole('button', { name: 'Close thread' }));
    await waitFor(() => {
      expect(api.last('POST', '/api/staff/messages/thr-1/status').body).toEqual({
        status: 'closed',
      });
    });
    await pickOption(user, screen.getByRole('combobox', { name: 'Assigned to' }), 'staff-2');
    await waitFor(() => {
      expect(api.last('POST', '/api/staff/messages/thr-1/assign').body).toEqual({
        staffId: 'staff-2',
      });
    });
  });

  it('sends a file with the answer as a form', async () => {
    const { api, user } = await renderApp('/messages/thr-1', { routes: routes() });
    await screen.findByRole('list', { name: 'Cheque 849342' });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'receipt.jpg', {
      type: 'image/jpeg',
    });
    await user.upload(screen.getByLabelText('Attach a photo or PDF', { selector: 'input' }), file);
    expect(screen.getByText('receipt.jpg')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(api.to('POST', '/api/staff/messages/thr-1/messages')).toHaveLength(1);
    });
    const body = api.last('POST', '/api/staff/messages/thr-1/messages').body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('receipt.jpg');
    expect(body.get('body')).toBe('');
  });

  it('is read-only for a viewer', async () => {
    const { api } = await renderApp('/messages/thr-1', { role: 'viewer', routes: routes() });
    await screen.findByRole('list', { name: 'Cheque 849342' });
    expect(
      screen.getByText('You can read messages; data entry and admins answer them.'),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close thread' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Assigned to' })).toBeNull();
    await waitFor(() => {
      expect(api.to('POST', '/api/staff/messages/thr-1/read')).toHaveLength(1);
    });
  });

  it('renders in Arabic, right to left', async () => {
    await renderApp('/messages/thr-1', {
      lang: 'ar',
      routes: routes({
        'GET /api/staff/messages/thr-1': detail({
          status: 'closed',
          closedAt: '2026-10-06T16:00:00.000Z',
        }),
      }),
    });
    await screen.findByRole('list', { name: 'Cheque 849342' });
    expect(screen.getByText('مغلقة')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إعادة فتح المحادثة' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'الشيك 849342 · برج النور 801' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'كل الرسائل' })).toBeTruthy();
    expect(screen.getByText(/^أُغلقت في /)).toBeTruthy();
  });

  it('says so when the thread does not exist', async () => {
    await renderApp('/messages/thr-x', {
      routes: routes({
        'GET /api/staff/messages/thr-x': {
          reply: true,
          status: 404,
          body: { error: { code: 'not_found', message: 'Thread not found' } },
        },
      }),
    });
    expect(await screen.findByText('This thread was not found.')).toBeTruthy();
  });
});
