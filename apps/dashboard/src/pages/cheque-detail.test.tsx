// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/test/api';
import { chequeDetail } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import type { ChequeDetail } from '@/lib/types';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:cheque-image');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATUS_OK = { cheque: { status: 'deposited', contractId: 'con-1' }, replacement: null };

function routesFor(c: ChequeDetail, extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/cheques/chq-1': c,
    'POST /api/staff/cheques/chq-1/status': STATUS_OK,
    ...extra,
  };
}

async function openStatusDialog(user: Awaited<ReturnType<typeof renderApp>>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Change status' }));
  return screen.findByRole('dialog');
}

describe('ChequeDetailPage', () => {
  it('shows the cheque, its timeline and its links', async () => {
    await renderApp('/cheques/chq-1', {
      routes: routesFor(
        chequeDetail({
          status: 'bounced',
          bounceReason: 'Insufficient funds',
          replacesChequeId: 'chq-0',
          replacedBy: {
            id: 'chq-9',
            chequeNo: '000909',
            dueDate: '2026-11-01',
            amountFils: 2_375_000,
            status: 'upcoming',
          },
        }),
      ),
    });
    expect(await screen.findByRole('heading', { name: 'Cheque no. 000101' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Al Noor Tower · 801' }).getAttribute('href')).toBe(
      '/contracts/con-1',
    );
    expect(screen.getByText('AED 23,750')).toBeTruthy();
    expect(screen.getByText('Insufficient funds')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Replaced by cheque 000909' }).getAttribute('href'),
    ).toBe('/cheques/chq-9');
    expect(screen.getByRole('link', { name: /Replaces cheque/ }).getAttribute('href')).toBe(
      '/cheques/chq-0',
    );
    expect(screen.getByText('Created with the contract')).toBeTruthy();
    expect(screen.getByText('No image attached.')).toBeTruthy();
  });

  it('loads the stored image on request with the access token', async () => {
    const { api, user } = await renderApp('/cheques/chq-1', {
      routes: routesFor(chequeDetail({ hasImage: true }), {
        'GET /api/staff/cheques/chq-1/image': () =>
          new Response(new Blob(['jpeg-bytes'], { type: 'image/jpeg' })),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Cheque image' }));
    const img = await screen.findByRole('img', { name: 'Cheque image' });
    expect(img.getAttribute('src')).toBe('blob:cheque-image');
    expect(api.last('GET', '/api/staff/cheques/chq-1/image').headers.get('authorization')).toBe(
      'Bearer access-1',
    );
  });

  it('uploads an image and confirms it', async () => {
    const { api, user, container } = await renderApp('/cheques/chq-1', {
      role: 'editor',
      routes: routesFor(chequeDetail(), { 'POST /api/staff/cheques/chq-1/image': { ok: true } }),
    });
    await screen.findByRole('button', { name: 'Upload image' });
    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    const file = new File(['scan'], 'cheque-000101.jpg', { type: 'image/jpeg' });
    await user.upload(input, file);
    expect((await screen.findByRole('status')).textContent).toBe('Upload image');
    const body = api.last('POST', '/api/staff/cheques/chq-1/image').body;
    expect(body).toBeInstanceOf(FormData);
    expect(((body as FormData).get('file') as File).name).toBe('cheque-000101.jpg');
  });

  it('requires a bounce reason before bouncing a deposited cheque', async () => {
    const { api, user } = await renderApp('/cheques/chq-1', {
      routes: routesFor(chequeDetail({ status: 'deposited' })),
    });
    const dialog = await openStatusDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Mark bounced' }));
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toHaveProperty('disabled', true);
    expect(
      within(dialog).getByText(
        'As stated by the bank, e.g. insufficient funds. The owner is notified immediately.',
      ),
    ).toBeTruthy();
    await user.type(within(dialog).getByLabelText(/Bounce reason/), 'Signature mismatch');
    await user.click(confirm);
    expect(await screen.findByText('Status updated.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/cheques/chq-1/status').body).toEqual({
      to: 'bounced',
      bounceReason: 'Signature mismatch',
    });
  });

  it('replaces a bounced cheque with a new one', async () => {
    const { api, user } = await renderApp('/cheques/chq-1', {
      routes: routesFor(chequeDetail({ status: 'bounced' })),
    });
    const dialog = await openStatusDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Replace with a new cheque' }));
    const fields = within(dialog).getByRole('group', { name: 'Replacement cheque' });
    expect(within(fields).getByLabelText<HTMLInputElement>(/Amount/).value).toBe('23750');
    expect(within(fields).getByLabelText<HTMLInputElement>(/Bank/).value).toBe('Emirates NBD');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toHaveProperty('disabled', true);
    await user.type(within(fields).getByLabelText(/Cheque no\./), '000888');
    await user.clear(within(fields).getByLabelText(/Bank/));
    await user.type(within(fields).getByLabelText(/Bank/), 'Mashreq');
    await user.clear(within(fields).getByLabelText(/Amount/));
    await user.type(within(fields).getByLabelText(/Amount/), '24,000');
    const due = within(fields).getByLabelText(/Due date/);
    await user.clear(due);
    await user.type(due, '2026-11-15');
    await user.click(confirm);
    await vi.waitFor(() => {
      expect(api.to('POST', '/api/staff/cheques/chq-1/status')).toHaveLength(1);
    });
    expect(api.last('POST', '/api/staff/cheques/chq-1/status').body).toEqual({
      to: 'replaced',
      replacement: {
        dueDate: '2026-11-15',
        amountFils: 2_400_000,
        chequeNo: '000888',
        bankName: 'Mashreq',
      },
    });
  });

  it('lets an admin correct a cleared cheque with a reason', async () => {
    const { api, user } = await renderApp('/cheques/chq-1', {
      routes: routesFor(chequeDetail({ status: 'cleared' })),
    });
    const dialog = await openStatusDialog(user);
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Upcoming', 'Mark deposited', 'Mark bounced', 'Cancel cheque']);
    await user.click(within(dialog).getByRole('radio', { name: 'Mark deposited' }));
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    await user.type(within(dialog).getByLabelText(/Admin correction/), 'ok');
    expect(confirm).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByLabelText(/Admin correction/), ' - bank reversed');
    await user.click(confirm);
    await vi.waitFor(() => {
      expect(api.to('POST', '/api/staff/cheques/chq-1/status')).toHaveLength(1);
    });
    expect(api.last('POST', '/api/staff/cheques/chq-1/status').body).toEqual({
      to: 'deposited',
      overrideReason: 'ok - bank reversed',
    });
  });

  it('only explains the final state to an editor', async () => {
    const { user } = await renderApp('/cheques/chq-1', {
      role: 'editor',
      routes: routesFor(chequeDetail({ status: 'cancelled' })),
    });
    const dialog = await openStatusDialog(user);
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows a generic message when the status change fails without an API error', async () => {
    const { user } = await renderApp('/cheques/chq-1', {
      routes: routesFor(chequeDetail(), {
        'POST /api/staff/cheques/chq-1/status': () => Promise.reject(new TypeError('offline')),
      }),
    });
    const dialog = await openStatusDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Mark deposited' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('hides editing from viewers and shows the error state', async () => {
    await renderApp('/cheques/chq-1', {
      role: 'viewer',
      routes: routesFor(chequeDetail()),
    });
    expect(await screen.findByRole('heading', { name: 'Cheque no. 000101' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload image' })).toBeNull();
    cleanup();
    await renderApp('/cheques/chq-1', {
      routes: { 'GET /api/staff/cheques/chq-1': apiError(500, 'internal') },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
