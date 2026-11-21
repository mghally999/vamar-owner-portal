import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { setAccessToken } from '@/lib/api';
import {
  AttachmentOpenError,
  attachmentUrl,
  isImage,
  localFileName,
  openAttachment,
} from '@/lib/attachments';
import * as web from '@/lib/attachments.web';
import { setItem } from '@/lib/storage';
import { AttachmentButton } from '@/ui/attachment';
import { fetchMock, mockApi } from '@/test/api';
import { fileSystem, sharing } from '@/test/native';
import { renderApp } from '@/test/render';

const pdf = { id: 'att-1', fileName: 'quote 2026/11.pdf', mime: 'application/pdf' };
const refreshed = {
  'POST /api/auth/owner/refresh': {
    body: { accessToken: 'access-2', refreshToken: 'refresh-2', refreshExpiresAt: '' },
  },
};

describe('opening a stored file on the phone', () => {
  beforeEach(() => {
    setAccessToken('access-1');
  });

  it('downloads it with the session and hands it to the share sheet as a PDF', async () => {
    await openAttachment(pdf);
    expect(fileSystem.downloadAsync).toHaveBeenCalledWith(
      attachmentUrl('att-1'),
      'file:///cache/att-1-quote-2026-11.pdf',
      { headers: { authorization: 'Bearer access-1' } },
    );
    expect(sharing.shareAsync).toHaveBeenCalledWith('file:///cache/att-1-quote-2026-11.pdf', {
      mimeType: 'application/pdf',
      dialogTitle: 'quote 2026/11.pdf',
      UTI: 'com.adobe.pdf',
    });
  });

  it('refreshes an expired token once and tries again', async () => {
    await setItem('refreshToken', 'refresh-1');
    mockApi(refreshed);
    fileSystem.downloadAsync.mockImplementationOnce((_u, uri) =>
      Promise.resolve({ uri, status: 401, headers: {}, mimeType: null }),
    );
    await openAttachment(pdf);
    expect(fileSystem.downloadAsync).toHaveBeenCalledTimes(2);
    expect(fileSystem.downloadAsync.mock.calls[1]?.[2]).toEqual({
      headers: { authorization: 'Bearer access-2' },
    });
    expect(sharing.shareAsync).toHaveBeenCalledTimes(1);
  });

  it('refuses a file the API will not give, and deletes the error body it wrote', async () => {
    fileSystem.downloadAsync.mockImplementation((_u, uri) =>
      Promise.resolve({ uri, status: 404, headers: {}, mimeType: null }),
    );
    await expect(openAttachment(pdf)).rejects.toEqual(new AttachmentOpenError(404));
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/att-1-quote-2026-11.pdf', {
      idempotent: true,
    });
    expect(sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('says so when the phone cannot share', async () => {
    sharing.isAvailableAsync.mockResolvedValue(false);
    await expect(openAttachment(pdf)).rejects.toBeInstanceOf(AttachmentOpenError);
  });

  it('names files safely, with the extension a viewer needs', () => {
    expect(localFileName({ id: 'a', fileName: '', mime: 'application/pdf' })).toBe('a-file.pdf');
    expect(localFileName({ id: 'a', fileName: 'x.PDF', mime: 'application/pdf' })).toBe('a-x.PDF');
    expect(localFileName({ id: 'a', fileName: 'فاتورة 1.png', mime: 'image/png' })).toBe(
      'a-فاتورة-1.png',
    );
    expect(isImage({ mime: 'image/heic' })).toBe(true);
    expect(isImage({ mime: 'application/pdf' })).toBe(false);
  });

  it('shows a message on the button when opening fails, and can be tried again', async () => {
    fileSystem.downloadAsync.mockImplementationOnce((_u, uri) =>
      Promise.resolve({ uri, status: 500, headers: {}, mimeType: null }),
    );
    await renderApp(<AttachmentButton file={pdf} title="Open file" />, { signedIn: false });
    await fireEvent.press(await screen.findByRole('button', { name: 'Open file' }));
    expect(await screen.findByText('The file could not be opened. Try again.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open file' }));
    await waitFor(() => {
      expect(screen.queryByText('The file could not be opened. Try again.')).toBeNull();
    });
    expect(sharing.shareAsync).toHaveBeenCalledTimes(1);
  });
});

describe('opening a stored file in the web app', () => {
  const tab = { location: { href: '' }, close: jest.fn() };
  const anchor = { href: '', download: '', click: jest.fn() };
  const g = globalThis as Record<string, unknown>;

  beforeEach(() => {
    // The blob address is revoked a minute later; no real timer outlives the test.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    setAccessToken('access-1');
    tab.location.href = '';
    g.window = { open: jest.fn(() => tab) };
    g.document = { createElement: jest.fn(() => anchor) };
    jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file-1');
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization');
      if (url.endsWith('/refresh'))
        return {
          status: 200,
          ok: true,
          json: () => Promise.resolve(refreshed['POST /api/auth/owner/refresh'].body),
        } as never;
      return {
        status: auth === 'Bearer access-1' || auth === 'Bearer access-2' ? 200 : 401,
        ok: auth === 'Bearer access-1' || auth === 'Bearer access-2',
        blob: () => Promise.resolve({ size: 3 }),
      } as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete g.window;
    delete g.document;
  });

  it('opens the tab during the tap and fills it with the file fetched with the session', async () => {
    await web.openAttachment(pdf);
    expect((g.window as { open: jest.Mock }).open).toHaveBeenCalledWith('', '_blank');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer access-1',
    );
    expect(tab.location.href).toBe('blob:file-1');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file-1');
  });

  it('downloads the file when the browser blocks the tab', async () => {
    (g.window as { open: jest.Mock }).open.mockReturnValue(null);
    await web.openAttachment(pdf);
    expect(anchor.download).toBe('quote 2026/11.pdf');
    expect(anchor.click).toHaveBeenCalled();
  });

  it('closes the empty tab when the file cannot be fetched', async () => {
    setAccessToken(null);
    await expect(web.openAttachment(pdf)).rejects.toBeInstanceOf(web.AttachmentOpenError);
    expect(tab.close).toHaveBeenCalled();
    expect(web.isImage({ mime: 'image/png' })).toBe(true);
    expect(web.attachmentUrl('x')).toContain('/api/owner/attachments/x');
  });
});
