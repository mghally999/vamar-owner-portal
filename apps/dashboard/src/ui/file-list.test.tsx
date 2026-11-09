// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '@/lib/i18n';
import { apiError, mockApi } from '@/test/api';
import { attachment } from '@/test/fixtures-v2';
import { testQueryClient } from '@/test/render';
import { FileList } from './file-list';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function renderList(props: Partial<Parameters<typeof FileList>[0]> = {}) {
  localStorage.setItem('vamar.lang', 'en');
  render(
    <LangProvider>
      <QueryClientProvider client={testQueryClient()}>
        <FileList
          entityType="work_order"
          entityId="wo-1"
          files={[]}
          canEdit
          uploadLabel="Upload photo"
          emptyLabel="No photos yet."
          {...props}
        />
      </QueryClientProvider>
    </LangProvider>,
  );
  return userEvent.setup();
}

const pdf = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'before.pdf', { type: 'application/pdf' });

describe('FileList', () => {
  it('shows the empty line, uploads through the button and lists images and PDFs with their size', async () => {
    const api = mockApi({ 'POST /api/staff/attachments': attachment({ id: 'att-9' }) });
    const user = renderList();
    expect(screen.getByText('No photos yet.')).toBeTruthy();
    const input = screen.getByLabelText<HTMLInputElement>('Upload photo');
    const click = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: 'Upload photo' }));
    expect(click).toHaveBeenCalled();
    await user.upload(input, pdf());
    await vi.waitFor(() => {
      expect(api.to('POST', '/api/staff/attachments')).toHaveLength(1);
    });
    const form = api.last('POST', '/api/staff/attachments').body as FormData;
    expect(form.get('entityType')).toBe('work_order');
    expect(form.get('entityId')).toBe('wo-1');
    // The input is cleared so the same file can be chosen again.
    expect(input.value).toBe('');

    cleanup();
    renderList({
      canEdit: false,
      files: [
        attachment({ id: 'att-1', fileName: 'after.jpg', mime: 'image/jpeg', sizeBytes: 200 }),
        attachment({ id: 'att-2', fileName: '', mime: 'application/pdf', sizeBytes: 50_000 }),
      ],
    });
    expect(screen.getByRole('link', { name: 'after.jpg' }).getAttribute('href')).toBe(
      '/api/staff/attachments/att-1',
    );
    // A file without a name shows its id; sizes round to whole KB, never below 1.
    expect(screen.getByRole('link', { name: 'att-2' })).toBeTruthy();
    expect(screen.getByText(/^1 KB/)).toBeTruthy();
    expect(screen.getByText(/^49 KB/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Delete file/ })).toBeNull();
    expect(screen.queryByLabelText('Upload photo')).toBeNull();
  });

  it('deletes a file and shows why an upload was refused', async () => {
    const api = mockApi({
      'DELETE /api/staff/attachments/:id': { ok: true },
      'POST /api/staff/attachments': apiError(422, 'validation', 'Only images and PDF files'),
    });
    const user = renderList({ files: [attachment({ id: 'att-1', fileName: 'after.jpg' })] });
    await user.click(screen.getByRole('button', { name: 'Delete file after.jpg' }));
    await vi.waitFor(() => {
      expect(api.to('DELETE', '/api/staff/attachments/att-1')).toHaveLength(1);
    });
    await user.upload(screen.getByLabelText('Upload photo'), pdf());
    expect(await screen.findByText('Only images and PDF files')).toBeTruthy();
  });

  it('shows the generic message when the upload fails without an answer, and ignores a failed delete', async () => {
    const api = mockApi({
      'POST /api/staff/attachments': () => {
        throw new TypeError('Failed to fetch');
      },
      'DELETE /api/staff/attachments/:id': apiError(500, 'internal'),
    });
    const user = renderList({ files: [attachment({ id: 'att-1', fileName: 'after.jpg' })] });
    await user.upload(screen.getByLabelText('Upload photo'), pdf());
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete file after.jpg' }));
    await vi.waitFor(() => {
      expect(api.to('DELETE', '/api/staff/attachments/att-1')).toHaveLength(1);
    });
    // The list stays as it was; nothing crashes.
    expect(screen.getByRole('link', { name: 'after.jpg' })).toBeTruthy();
  });
});
