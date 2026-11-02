// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, buildingDetail, disputeDetail, disputeRow } from '@/test/fixtures';
import { at, renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROWS = [
  disputeRow(),
  disputeRow({
    id: 'dsp-2',
    caseNo: 'RDC-2026-0533',
    type: 'eviction',
    status: 'hearing_scheduled',
    tenantName: null,
    amountClaimedFils: null,
    nextHearingDate: null,
  }),
];

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/disputes': (c: ApiCall) =>
      c.query['status'] === 'closed' ? { items: [] } : { items: ROWS },
    'GET /api/staff/disputes/:id': disputeDetail(),
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/buildings/bld-1': buildingDetail(),
    ...extra,
  };
}

describe('DisputesPage', () => {
  it('lists cases from the API and filters by status', async () => {
    const { api, user } = await renderApp('/disputes', { routes: routes() });
    const link = await screen.findByRole('link', { name: 'RDC-2026-0412' });
    expect(link.getAttribute('href')).toBe('/disputes/dsp-1');
    const row = link.closest('tr');
    if (!row) throw new Error('no row');
    expect(within(row).getByText('Rent arrears')).toBeTruthy();
    expect(within(row).getByText('AED 47,500')).toBeTruthy();
    expect(within(row).getByText('12 Nov 2026')).toBeTruthy();
    expect(within(row).getByText('Open')).toBeTruthy();
    const second = screen.getByRole('link', { name: 'RDC-2026-0533' }).closest('tr');
    if (!second) throw new Error('no row');
    expect(within(second).getByText('Eviction')).toBeTruthy();
    expect(within(second).getByText('Hearing scheduled')).toBeTruthy();
    expect(within(second).getAllByText('—')).toHaveLength(3);

    await user.hover(link);
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/disputes/dsp-1')).toHaveLength(1);
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'closed');
    expect(
      await screen.findByText(
        'No disputes. When a case is opened, record it here so the owner can follow it in the app.',
      ),
    ).toBeTruthy();
    expect(api.last('GET', '/api/staff/disputes').query).toEqual({ status: 'closed' });
  });

  it('opens a case for a unit with its current contract', async () => {
    const { api, user } = await renderApp('/disputes', {
      role: 'editor',
      routes: routes({ 'POST /api/staff/disputes': disputeDetail({ id: 'dsp-9' }) }),
    });
    await user.click(await screen.findByRole('button', { name: 'New dispute' }));
    const dialog = await screen.findByRole('dialog');
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toHaveProperty('disabled', true);

    await user.selectOptions(within(dialog).getByLabelText(/^Building/), 'bld-1');
    const unitSelect = within(dialog).getByLabelText(/^Unit/);
    await within(unitSelect).findByRole('option', { name: '801 · Sara Khan' });
    await user.selectOptions(unitSelect, 'unit-801');
    await user.selectOptions(within(dialog).getByLabelText(/^Type/), 'bounced_cheque');
    await user.type(within(dialog).getByLabelText(/Amount claimed/), '47,500');
    await user.type(within(dialog).getByLabelText(/Next hearing/), '2026-12-03');
    await user.type(within(dialog).getByLabelText(/Internal notes/), ' Cheque 000101 bounced ');
    await user.click(create);

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.last('POST', '/api/staff/disputes').body).toEqual({
      unitId: 'unit-801',
      contractId: 'con-1',
      tenantId: null,
      type: 'bounced_cheque',
      amountClaimedFils: 4_750_000,
      nextHearingDate: '2026-12-03',
      notes: 'Cheque 000101 bounced',
    });
  });

  it('sends nulls for a vacant unit without an amount or hearing', async () => {
    const { api, user } = await renderApp('/disputes', {
      routes: routes({
        'GET /api/staff/disputes': { items: [] },
        'POST /api/staff/disputes': disputeDetail({ id: 'dsp-9' }),
      }),
    });
    await screen.findByText(/^No disputes\./);
    const buttons = screen.getAllByRole('button', { name: 'New dispute' });
    await user.click(at(buttons, 1));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Building/), 'bld-1');
    const unitSelect = within(dialog).getByLabelText(/^Unit/);
    await within(unitSelect).findByRole('option', { name: '802' });
    await user.selectOptions(unitSelect, 'unit-802');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await vi.waitFor(() => {
      expect(api.to('POST', '/api/staff/disputes')).toHaveLength(1);
    });
    expect(api.last('POST', '/api/staff/disputes').body).toMatchObject({
      unitId: 'unit-802',
      contractId: null,
      amountClaimedFils: null,
      nextHearingDate: null,
      notes: '',
    });
  });

  it('shows Arabic labels, hides creation from viewers and shows the error state', async () => {
    await renderApp('/disputes', { lang: 'ar', role: 'viewer', routes: routes() });
    expect(await screen.findByText('متأخرات إيجار')).toBeTruthy();
    expect(screen.getByText('مفتوحة', { selector: 'span' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'قضية جديدة' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /dispute/i })).toHaveLength(0);
    cleanup();
    await renderApp('/disputes', {
      routes: routes({ 'GET /api/staff/disputes': apiError(500, 'internal') }),
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
