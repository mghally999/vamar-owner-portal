import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import ChequeDetailScreen from '../../../app/cheque/[id]';
import ThreadScreen from '../../../app/message/[id]';
import NewThreadScreen from '../../../app/message/new';
import MessagesScreen from '../../../app/messages';
import SettingsScreen from '../../../app/settings';
import { setAccessToken } from '@/lib/api';
import type { ThreadDetail, ThreadSummary } from '@/lib/message-queries';
import { mockApi, sent } from '@/test/api';
import { chequeDetail } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { routeState, router } from '@/test/router';

const link = {
  type: 'cheque' as const,
  id: 'chq-1',
  labelAr: '000123 · برج الواحة 1204',
  labelEn: '000123 · Oasis Tower 1204',
};

function summary(over: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 'th-1',
    subject: 'Cheque 000123',
    status: 'open',
    link,
    lastMessageAt: '2026-10-07T10:05:00Z',
    lastSenderType: 'staff',
    preview: 'It will be deposited on its due date.',
    unread: 1,
    createdAt: '2026-10-07T09:00:00Z',
    ...over,
  };
}

function detail(over: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    ...summary(),
    messages: [
      {
        id: 'msg-1',
        senderType: 'owner',
        senderName: null,
        body: 'Is this cheque <b>registered</b>?',
        createdAt: '2026-10-07T09:00:00Z',
        files: [],
      },
      {
        id: 'msg-2',
        senderType: 'staff',
        senderName: null,
        body: 'It will be deposited on its due date.',
        createdAt: '2026-10-07T10:05:00Z',
        files: [{ id: 'att-9', fileName: 'receipt.pdf', mime: 'application/pdf', sizeBytes: 9 }],
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  setAccessToken('access-1');
});

describe('Messages list', () => {
  const list = {
    items: [
      summary(),
      summary({
        id: 'th-2',
        subject: 'Leak in the kitchen',
        status: 'closed',
        link: null,
        lastSenderType: 'owner',
        preview: '',
        unread: 0,
      }),
    ],
    unreadThreads: 1,
  };

  it('shows each thread with its item, last message, time and what is unread, in English', async () => {
    mockApi({ 'GET /api/owner/messages': { body: list } });
    await renderApp(<MessagesScreen />);
    expect(await screen.findByText('Cheque 000123')).toBeTruthy();
    expect(screen.getByText('1 new')).toBeTruthy();
    expect(screen.getByText('Cheque 000123 · Oasis Tower 1204')).toBeTruthy();
    expect(screen.getByText('Vamar: It will be deposited on its due date.')).toBeTruthy();
    // Dubai time, Western digits.
    expect(screen.getAllByText('7 Oct 2026 · 14:05').length).toBeGreaterThan(0);
    expect(screen.getByText('Closed')).toBeTruthy();
    // A message that was only a file.
    expect(screen.getByText('Attachment')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('thread-th-2'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/message/[id]', params: { id: 'th-2' } });
  });

  it('reads right to left in Arabic with Western digits', async () => {
    mockApi({ 'GET /api/owner/messages': { body: list } });
    await renderApp(<MessagesScreen />, { lang: 'ar' });
    expect(await screen.findByText('1 جديدة')).toBeTruthy();
    expect(screen.getByText('الشيك 000123 · برج الواحة 1204')).toBeTruthy();
    expect(screen.getByText('مغلقة')).toBeTruthy();
    expect(screen.getByText('فامار: It will be deposited on its due date.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'رسالة جديدة' })).toBeTruthy();
  });

  it('says how to start when there is nothing yet', async () => {
    mockApi({ 'GET /api/owner/messages': { body: { items: [], unreadThreads: 0 } } });
    await renderApp(<MessagesScreen />);
    expect(await screen.findByText('No messages yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'New message' }));
    expect(router.push).toHaveBeenCalledWith('/message/new');
  });

  it('is one tap from Settings, with the unread count', async () => {
    mockApi({ 'GET /api/owner/messages': { body: list } });
    await renderApp(<SettingsScreen />);
    const row = await screen.findByRole('button', { name: 'Messages with Vamar, 1 new' });
    await fireEvent.press(row);
    expect(router.push).toHaveBeenCalledWith('/messages');
  });
});

describe('Thread', () => {
  it('shows the messages as plain text and marks the thread read, opened from a push', async () => {
    // A reply push carries the answer's id; the API answers with the thread it belongs to.
    routeState.params = { id: 'msg-2' };
    mockApi({
      'GET /api/owner/messages/msg-2': { body: detail() },
      'POST /api/owner/messages/th-1/read': { body: { ok: true } },
    });
    await renderApp(<ThreadScreen />);
    expect(await screen.findByText('Is this cheque <b>registered</b>?')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Vamar')).toBeTruthy();
    expect(screen.getByText('About: Cheque 000123 · Oasis Tower 1204')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open file · receipt.pdf' })).toBeTruthy();
    await waitFor(() => {
      expect(sent('POST /api/owner/messages/th-1/read')).toHaveLength(1);
    });
    await fireEvent.press(screen.getByRole('link'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/cheque/[id]', params: { id: 'chq-1' } });
  });

  it('sends a reply to the thread and clears the box', async () => {
    routeState.params = { id: 'th-1' };
    mockApi({
      'GET /api/owner/messages/th-1': { body: detail() },
      'POST /api/owner/messages/th-1/read': { body: { ok: true } },
      'POST /api/owner/messages/th-1/messages': { status: 201, body: { id: 'msg-3' } },
    });
    await renderApp(<ThreadScreen />);
    const box = await screen.findByLabelText('Your reply');
    await fireEvent.changeText(box, '  Thank you\r\n ');
    expect(screen.getByText('14/4000')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(sent('POST /api/owner/messages/th-1/messages')[0]?.body).toEqual({
        body: 'Thank you',
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Your reply').props.value).toBe('');
    });
  });

  it('refuses an empty message and explains the hourly limit, keeping the text', async () => {
    routeState.params = { id: 'th-1' };
    mockApi({
      'GET /api/owner/messages/th-1': { body: detail({ status: 'closed' }) },
      'POST /api/owner/messages/th-1/read': { body: { ok: true } },
      'POST /api/owner/messages/th-1/messages': {
        status: 429,
        body: { error: { code: 'rate_limited', message: 'Too many attempts' } },
      },
    });
    await renderApp(<ThreadScreen />);
    expect(
      await screen.findByText(
        'The Vamar team closed this conversation. Sending a new message opens it again.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('Write a message or attach a file.')).toBeTruthy();
    expect(sent('POST /api/owner/messages/th-1/messages')).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('Your reply'), 'One more');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText(
        "You've sent a lot of messages in the last hour. Please try again a little later.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Your reply').props.value).toBe('One more');
  });

  it('is in Arabic with the owner and Vamar named', async () => {
    routeState.params = { id: 'th-1' };
    mockApi({
      'GET /api/owner/messages/th-1': { body: detail() },
      'POST /api/owner/messages/th-1/read': { body: { ok: true } },
    });
    await renderApp(<ThreadScreen />, { lang: 'ar' });
    expect(await screen.findByText('أنت')).toBeTruthy();
    expect(screen.getByText('فامار')).toBeTruthy();
    expect(screen.getByText('بخصوص: الشيك 000123 · برج الواحة 1204')).toBeTruthy();
    expect(screen.getByLabelText('ردك')).toBeTruthy();
    expect(screen.getByText('7 أكتوبر 2026 · 13:00')).toBeTruthy();
  });
});

describe('Ask Vamar about this', () => {
  it('opens a new message about the cheque with the subject filled in, and sends it', async () => {
    routeState.params = { id: 'chq-1' };
    mockApi({ 'GET /api/owner/cheques/chq-1': { body: chequeDetail() } });
    await renderApp(<ChequeDetailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Ask Vamar about this' }));
    const href = {
      pathname: '/message/new',
      params: { linkType: 'cheque', linkId: 'chq-1', label: '000123' },
    };
    expect(router.push).toHaveBeenCalledWith(href);
    await screen.unmount();

    routeState.params = href.params;
    mockApi({ 'POST /api/owner/messages': { status: 201, body: detail({ id: 'th-9' }) } });
    await renderApp(<NewThreadScreen />);
    expect(screen.getByLabelText('Subject').props.value).toBe('Cheque 000123');
    await fireEvent.changeText(screen.getByLabelText('Your message'), 'When is it deposited?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/message/[id]',
        params: { id: 'th-9' },
      });
    });
    expect(sent('POST /api/owner/messages')[0]?.body).toEqual({
      subject: 'Cheque 000123',
      body: 'When is it deposited?',
      linkType: 'cheque',
      linkId: 'chq-1',
    });
  });

  it('prefills in Arabic, and a new message needs a subject', async () => {
    routeState.params = { linkType: 'cheque', linkId: 'chq-1', label: '000123' };
    await renderApp(<NewThreadScreen />, { lang: 'ar' });
    expect(screen.getByLabelText('الموضوع').props.value).toBe('الشيك 000123');
    await fireEvent.changeText(screen.getByLabelText('الموضوع'), '   ');
    await fireEvent.changeText(screen.getByLabelText('رسالتك'), 'سؤال');
    await fireEvent.press(screen.getByRole('button', { name: 'إرسال' }));
    expect(screen.getByText('الموضوع مطلوب.')).toBeTruthy();
    expect(sent('POST /api/owner/messages')).toHaveLength(0);
  });
});
