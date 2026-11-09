// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { contractDetail } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import type { ContractDetail } from '@/lib/types';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function draft(): ContractDetail {
  const base = contractDetail({ status: 'draft', notes: '', ejariNo: null });
  return {
    ...base,
    cheques: base.cheques.map((c) => ({ ...c, status: 'upcoming' as const })),
  };
}

describe('ContractDetailPage', () => {
  it('shows an active contract with its cheques', async () => {
    await renderApp('/contracts/con-1', {
      routes: {
        'GET /api/staff/contracts/con-1': contractDetail({ previousContractId: 'con-0' }),
      },
    });
    expect(await screen.findByRole('heading', { name: 'Al Noor Tower · 801' })).toBeTruthy();
    expect(screen.getByText('Ejari 0123456789')).toBeTruthy();
    expect(screen.getByText('Parking bay 14 included.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Renews contract' }).getAttribute('href')).toBe(
      '/contracts/con-0',
    );
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Cleared')).toHaveLength(2);
    expect(within(table).getByText('000104')).toBeTruthy();
    expect(within(table).getAllByRole('link')[3]?.getAttribute('href')).toBe('/cheques/chq-4');
    // Active contracts can be renewed or terminated, not activated.
    expect(screen.queryByRole('button', { name: 'Activate contract' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Terminate' })).toBeTruthy();
  });

  it('renews and opens the renewal draft', async () => {
    const { api, router, user } = await renderApp('/contracts/con-1', {
      role: 'editor',
      routes: {
        'GET /api/staff/contracts/:id': (c: ApiCall) =>
          c.path.endsWith('con-2') ? draft() : contractDetail(),
        'POST /api/staff/contracts/con-1/renew': contractDetail({ id: 'con-2', status: 'draft' }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Renew' }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/contracts/con-2');
    });
    expect(api.to('POST', '/api/staff/contracts/con-1/renew')).toHaveLength(1);
  });

  it('terminates with a reason', async () => {
    const { api, user } = await renderApp('/contracts/con-1', {
      routes: {
        'GET /api/staff/contracts/con-1': contractDetail(),
        'POST /api/staff/contracts/con-1/terminate': { ok: true },
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Terminate' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByLabelText(/Reason/), ' Tenant left early ');
    await user.click(confirm);
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.last('POST', '/api/staff/contracts/con-1/terminate').body).toEqual({
      reason: 'Tenant left early',
    });
  });

  it('edits the draft grid and saves it', async () => {
    const { api, user } = await renderApp('/contracts/con-1', {
      routes: {
        'GET /api/staff/contracts/con-1': draft(),
        'PATCH /api/staff/contracts/con-1': { ok: true },
      },
    });
    const amount = await screen.findByLabelText<HTMLInputElement>('Amount 1');
    expect(amount.value).toBe('23750');
    const save = screen.getByRole('button', { name: 'Save as draft' });
    expect(save).toHaveProperty('disabled', true);
    await user.clear(amount);
    await user.type(amount, '20000');
    expect(screen.getByText('3,750 short of the annual rent')).toBeTruthy();
    await user.click(save);
    expect(await screen.findByText('Contract saved as draft.')).toBeTruthy();
    const body = api.last('PATCH', '/api/staff/contracts/con-1').body as {
      cheques: { seq: number; amountFils: number | null }[];
    };
    expect(body.cheques.map((c) => c.amountFils)).toEqual([
      2_000_000, 2_375_000, 2_375_000, 2_375_000,
    ]);
  });

  it('asks for a reason when the total differs from the rent, then activates', async () => {
    const { api, user } = await renderApp('/contracts/con-1', {
      routes: {
        'GET /api/staff/contracts/con-1': draft(),
        'PATCH /api/staff/contracts/con-1': { ok: true },
        'POST /api/staff/contracts/con-1/activate': (c: ApiCall) =>
          (c.body as { totalMismatchReason?: string }).totalMismatchReason
            ? { ok: true }
            : apiError(422, 'total_mismatch_needs_reason', 'Needs a reason', {
                totalFils: 9_000_000,
              }),
      },
    });
    const amount = await screen.findByLabelText('Amount 4');
    await user.clear(amount);
    await user.type(amount, '18750');
    await user.click(screen.getByRole('button', { name: 'Activate contract' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'The cheque total is 90,000 AED but the annual rent is 95,000 AED. Type a reason to continue; it is recorded in the audit log.',
      ),
    ).toBeTruthy();
    // The edited grid was saved before the first activation attempt.
    expect(api.to('PATCH', '/api/staff/contracts/con-1')).toHaveLength(1);

    await user.type(within(dialog).getByLabelText(/Reason/), 'Discount agreed');
    await user.click(within(dialog).getByRole('button', { name: 'Activate contract' }));
    expect(await screen.findByText('Contract is now active.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/contracts/con-1/activate').body).toEqual({
      totalMismatchReason: 'Discount agreed',
    });
  });

  it('shows the API message when activation fails', async () => {
    const { api, user } = await renderApp('/contracts/con-1', {
      routes: {
        'GET /api/staff/contracts/con-1': draft(),
        'POST /api/staff/contracts/con-1/activate': apiError(
          409,
          'unit_occupied',
          'The unit already has an active contract.',
        ),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Activate contract' }));
    expect(await screen.findByText('The unit already has an active contract.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/contracts/con-1/activate').body).toEqual({});
  });

  it('shows a draft read-only to a viewer', async () => {
    await renderApp('/contracts/con-1', {
      role: 'viewer',
      routes: { 'GET /api/staff/contracts/con-1': draft() },
    });
    const amount = await screen.findByLabelText<HTMLInputElement>('Amount 1');
    expect(amount.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save as draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fill equal amounts' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate contract' })).toBeNull();
  });

  it('shows the error state and retries', async () => {
    const { api, user } = await renderApp('/contracts/nope', {
      routes: { 'GET /api/staff/contracts/nope': apiError(404, 'not_found') },
    });
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/contracts/nope').length).toBeGreaterThan(1);
    });
  });

  it('a draft with empty cheque rows keeps blanks, shows why a save failed, and closes the reason dialog', async () => {
    const base = draft();
    const blank: ContractDetail = {
      ...base,
      unit: null,
      building: null,
      cheques: base.cheques.map((c, i) =>
        i === 3 ? { ...c, amountFils: null, chequeNo: null, bankName: null } : c,
      ),
    };
    let saveFails: 'api' | 'network' = 'api';
    const { api, user } = await renderApp('/contracts/con-1', {
      routes: {
        'GET /api/staff/contracts/con-1': blank,
        'PATCH /api/staff/contracts/con-1': () => {
          if (saveFails === 'network') throw new TypeError('Failed to fetch');
          return apiError(422, 'validation', 'Cheque numbers must be unique');
        },
        'POST /api/staff/contracts/con-1/activate': apiError(
          422,
          'total_mismatch_needs_reason',
          'Needs a reason',
          { totalFils: 7_125_000 },
        ),
      },
    });
    const empty = await screen.findByLabelText<HTMLInputElement>('Amount 4');
    expect(empty.value).toBe('');
    const first = screen.getByLabelText('Amount 1');
    await user.clear(first);
    await user.type(first, '20000');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText('Cheque numbers must be unique')).toBeTruthy();
    // The empty row is sent as an empty amount, never as zero.
    const body = api.last('PATCH', '/api/staff/contracts/con-1').body as {
      cheques: { amountFils: number | null }[];
    };
    expect(body.cheques.at(3)?.amountFils).toBeNull();
    saveFails = 'network';
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();

    // An unsaved grid is saved before activating; here that save fails without an answer.
    await user.click(screen.getByRole('button', { name: 'Activate contract' }));
    await vi.waitFor(() => {
      expect(api.to('PATCH', '/api/staff/contracts/con-1')).toHaveLength(3);
    });
  });

  it('cancels the reason dialog, closes it with Escape, and cancels the termination', async () => {
    const { user } = await renderApp('/contracts/con-1', {
      routes: {
        'GET /api/staff/contracts/con-1': draft(),
        'POST /api/staff/contracts/con-1/activate': apiError(
          422,
          'total_mismatch_needs_reason',
          'Needs a reason',
          { totalFils: 9_000_000 },
        ),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Activate contract' }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await user.click(screen.getByRole('button', { name: 'Activate contract' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    cleanup();
    const active = await renderApp('/contracts/con-1', {
      routes: { 'GET /api/staff/contracts/con-1': contractDetail() },
    });
    await active.user.click(await screen.findByRole('button', { name: 'Terminate' }));
    dialog = await screen.findByRole('dialog');
    await active.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
