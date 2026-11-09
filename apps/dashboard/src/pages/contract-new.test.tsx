// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, buildingDetail, contractDetail, page, tenant, unit } from '@/test/fixtures';
import { renderApp, pickOption } from '@/test/render';
import type { Tenant } from '@/lib/types';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routes(extra: Record<string, unknown> = {}) {
  const tenants: Tenant[] = [
    tenant(),
    tenant({ id: 'ten-2', name: 'Bright Trading', company: 'Bright LLC' }),
  ];
  return {
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/buildings/bld-1': buildingDetail({
      units: [
        unit(),
        unit({ id: 'unit-802', unitNo: '802', occupied: false, contract: null }),
        unit({ id: 'unit-803', unitNo: '803', occupied: false, active: false, contract: null }),
      ],
    }),
    'GET /api/staff/tenants': () => ({ items: tenants }),
    'POST /api/staff/tenants': (c: ApiCall) => {
      const created = tenant({ id: 'ten-3', name: (c.body as { name: string }).name });
      tenants.push(created);
      return created;
    },
    'GET /api/staff/contracts': page([]),
    'GET /api/staff/contracts/:id': contractDetail({ id: 'con-new', status: 'draft' }),
    ...extra,
  };
}

async function typeDate(
  user: Awaited<ReturnType<typeof renderApp>>['user'],
  name: string,
  value: string,
) {
  const input = screen.getByRole('textbox', { name });
  await user.clear(input);
  await user.type(input, `${value}{Enter}`);
}

async function fillContract(user: Awaited<ReturnType<typeof renderApp>>['user']) {
  await pickOption(user, await screen.findByLabelText(/^Building/), 'bld-1');
  const unitSelect = screen.getByLabelText(/^Unit/);
  await within(unitSelect).findByRole('option', { name: /802/ });
  // Occupied and inactive units stay hidden until "show all" is ticked.
  expect(within(unitSelect).queryByRole('option', { name: /801/ })).toBeNull();
  expect(within(unitSelect).queryByRole('option', { name: /803/ })).toBeNull();
  await user.click(screen.getByRole('checkbox', { name: 'Show all units' }));
  expect(within(unitSelect).getByRole('option', { name: '801 · Rented' })).toBeTruthy();
  await user.selectOptions(unitSelect, 'unit-802');
  await user.selectOptions(screen.getByLabelText(/^Tenant/), 'ten-1');
  await typeDate(user, 'Start date', '01/01/2026');
  await typeDate(user, 'End date', '31/12/2026');
  await user.type(screen.getByLabelText(/^Annual rent/), '95,000');
}

describe('ContractNewPage', () => {
  it('builds the cheque schedule and posts the contract, then opens it', async () => {
    const { api, router, user } = await renderApp('/contracts/new', {
      role: 'editor',
      routes: routes({ 'POST /api/staff/contracts': contractDetail({ id: 'con-new' }) }),
    });
    const save = await screen.findByRole('button', { name: 'Save as draft' });
    expect(save).toHaveProperty('disabled', true);
    await fillContract(user);
    await user.type(screen.getByLabelText(/^Ejari no\./), ' 0099 ');
    await user.type(screen.getByLabelText(/^Notes/), 'Two parking bays');

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Due date 1' }).value).toBe(
      '01/01/2026',
    );
    expect(screen.getAllByLabelText(/^Due date \d/)).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Fill equal amounts' }));
    expect(screen.getByText('matches the annual rent')).toBeTruthy();
    await user.type(screen.getByLabelText('Cheque no. 1'), '000777');
    await user.type(screen.getByLabelText('Bank 1'), 'ADCB');

    expect(save).toHaveProperty('disabled', false);
    await user.click(save);
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/contracts/con-new');
    });
    const body = api.last('POST', '/api/staff/contracts').body as {
      cheques: { seq: number; amountFils: number | null; chequeNo: string | null }[];
    };
    expect(body).toMatchObject({
      unitId: 'unit-802',
      tenantId: 'ten-1',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      annualRentFils: 9_500_000,
      chequeCount: 4,
      ejariNo: '0099',
      notes: 'Two parking bays',
    });
    expect(body.cheques.map((c) => c.amountFils)).toEqual([
      2_375_000, 2_375_000, 2_375_000, 2_375_000,
    ]);
    expect(body.cheques[0]).toMatchObject({ seq: 1, chequeNo: '000777', bankName: 'ADCB' });
    expect(body.cheques[1]).toMatchObject({ chequeNo: null, bankName: null });
  });

  it('keeps typed amounts when the cheque count changes and flags bad dates', async () => {
    const { user } = await renderApp('/contracts/new', { routes: routes() });
    await fillContract(user);
    await user.type(screen.getByLabelText('Amount 1'), '50000');
    await user.selectOptions(screen.getByLabelText(/^Number of cheques/), '2');
    expect(screen.getAllByLabelText(/^Due date \d/)).toHaveLength(2);
    expect(screen.getByLabelText<HTMLInputElement>('Amount 1').value).toBe('50000');
    expect(screen.getByText('45,000 short of the annual rent')).toBeTruthy();

    await typeDate(user, 'End date', '01/12/2025');
    expect(screen.getByLabelText(/^End date/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('button', { name: 'Save as draft' })).toHaveProperty('disabled', true);
  });

  it('shows the API message when the contract is refused', async () => {
    const { user } = await renderApp('/contracts/new', {
      routes: routes({
        'POST /api/staff/contracts': apiError(
          409,
          'unit_occupied',
          'The unit already has an active contract.',
        ),
      }),
    });
    await fillContract(user);
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The unit already has an active contract.',
    );
  });

  it('creates a tenant on the spot and selects it', async () => {
    const { api, user } = await renderApp('/contracts/new', { routes: routes() });
    const tenantSelect = await screen.findByLabelText(/^Tenant/);
    expect(
      await within(tenantSelect).findByRole('option', { name: 'Bright Trading · Bright LLC' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'New tenant' }));
    const dialog = await screen.findByRole('dialog');
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByLabelText(/Tenant name/), 'Noura Faisal');
    await user.type(within(dialog).getByLabelText(/^Phone/), '+971554443333');
    await user.type(within(dialog).getByLabelText(/^Company/), ' ');
    await user.click(create);
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.last('POST', '/api/staff/tenants').body).toEqual({
      name: 'Noura Faisal',
      phone: '+971554443333',
      company: null,
    });
    await vi.waitFor(() => {
      expect(tenantSelect).toHaveProperty('value', 'ten-3');
    });
  });

  it('goes back to the list on cancel', async () => {
    const { router, user } = await renderApp('/contracts/new', { routes: routes() });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/contracts');
    });
  });
});
