// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/test/api';
import { disputeDetail } from '@/test/fixtures';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:claim');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/disputes/dsp-1': disputeDetail(),
    'PATCH /api/staff/disputes/dsp-1': { ok: true },
    'POST /api/staff/disputes/dsp-1/updates': { ok: true },
    'POST /api/staff/attachments': { id: 'att-2' },
    'DELETE /api/staff/attachments/:id': { ok: true },
    'GET /api/staff/attachments/att-1': () =>
      new Response(new Blob(['%PDF'], { type: 'application/pdf' })),
    ...extra,
  };
}

describe('DisputeDetailPage', () => {
  it('shows the case, its updates and attachments', async () => {
    await renderApp('/disputes/dsp-1', { routes: routes() });
    expect(await screen.findByRole('heading', { name: 'Case RDC-2026-0412' })).toBeTruthy();
    expect(screen.getByText('Rent arrears')).toBeTruthy();
    expect(screen.getByText('Al Noor Tower · 801')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contract' }).getAttribute('href')).toBe(
      '/contracts/con-1',
    );
    expect(screen.getByText('AED 47,500')).toBeTruthy();
    expect(screen.getByText('Case filed at the Rental Dispute Centre.')).toBeTruthy();
    expect(screen.getByText('Owner sees this')).toBeTruthy();
    expect(screen.getByText('Internal')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'claim.pdf' })).toBeTruthy();
    expect(screen.getByText('200 KB')).toBeTruthy();
  });

  it('changes the hearing date and the status', async () => {
    const { api, user } = await renderApp('/disputes/dsp-1', { role: 'editor', routes: routes() });
    const hearing = await screen.findByDisplayValue('2026-11-12');
    fireEvent.change(hearing, { target: { value: '2026-12-01' } });
    fireEvent.blur(hearing);
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/disputes/dsp-1').body).toEqual({
        nextHearingDate: '2026-12-01',
      });
    });
    fireEvent.change(hearing, { target: { value: '' } });
    fireEvent.blur(hearing);
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/disputes/dsp-1').body).toEqual({
        nextHearingDate: null,
      });
    });

    await user.selectOptions(screen.getByDisplayValue('Open'), 'closed');
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/disputes/dsp-1').body).toEqual({ status: 'closed' });
    });
  });

  it('adds an internal update', async () => {
    const { api, user } = await renderApp('/disputes/dsp-1', { routes: routes() });
    const note = await screen.findByRole('textbox', { name: 'Add update' });
    const add = screen.getByRole('button', { name: 'Add update' });
    expect(add).toHaveProperty('disabled', true);
    await user.type(note, 'Hearing moved by the court. ');
    await user.click(screen.getByRole('checkbox', { name: 'Visible to the owner in the app' }));
    await user.click(add);
    expect(await screen.findByText('Update added.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/disputes/dsp-1/updates').body).toEqual({
      note: 'Hearing moved by the court.',
      visibleToOwner: false,
    });
    expect(note).toHaveProperty('value', '');
  });

  it('opens, uploads and removes attachments', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { api, user, container } = await renderApp('/disputes/dsp-1', { routes: routes() });
    await user.click(await screen.findByRole('button', { name: 'claim.pdf' }));
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledWith('blob:claim', '_blank', 'noopener');
    });
    expect(api.last('GET', '/api/staff/attachments/att-1').headers.get('authorization')).toBe(
      'Bearer access-1',
    );

    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    await user.upload(input, new File(['%PDF'], 'judgment.pdf', { type: 'application/pdf' }));
    await vi.waitFor(() => {
      expect(api.to('POST', '/api/staff/attachments')).toHaveLength(1);
    });
    const form = api.last('POST', '/api/staff/attachments').body as FormData;
    expect(form.get('entityType')).toBe('dispute');
    expect(form.get('entityId')).toBe('dsp-1');
    expect((form.get('file') as File).name).toBe('judgment.pdf');

    // The remove button sits next to the file name.
    const row = screen.getByRole('button', { name: 'claim.pdf' }).parentElement;
    if (!row) throw new Error('no attachment row');
    await user.click(within(row).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(api.to('DELETE', '/api/staff/attachments/att-1')).toHaveLength(1);
    });
  });

  it('saves edited internal notes', async () => {
    const { api, user } = await renderApp('/disputes/dsp-1', { routes: routes() });
    const notes = await screen.findByDisplayValue('Tenant asked for a payment plan.');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    await user.type(notes, ' Declined.');
    await user.click(save);
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/disputes/dsp-1').body).toEqual({
        notes: 'Tenant asked for a payment plan. Declined.',
      });
    });
  });

  it('is read-only for a viewer', async () => {
    await renderApp('/disputes/dsp-1', {
      role: 'viewer',
      routes: routes({
        'GET /api/staff/disputes/dsp-1': disputeDetail({
          notes: '',
          updates: [],
          attachments: [],
          tenant: null,
          contractId: null,
        }),
      }),
    });
    expect(await screen.findByText('12 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Open', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect(screen.getByText('No files attached.')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Contract' })).toBeNull();
  });

  it('shows the error state', async () => {
    await renderApp('/disputes/dsp-1', {
      routes: { 'GET /api/staff/disputes/dsp-1': apiError(500, 'internal') },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
