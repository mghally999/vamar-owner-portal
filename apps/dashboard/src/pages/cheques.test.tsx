// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { MAX_BULK_CHEQUES, monthPeriod, previousPeriod, todayInDubai } from '@vamar/shared';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, chequeRow, owner, page } from '@/test/fixtures';
import { at, renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

beforeEach(() => {
  // The table is virtualised; give its scroll box a height so rows are rendered in jsdom.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const thisMonth = todayInDubai().slice(0, 7);
const ROWS = [
  chequeRow(),
  chequeRow({
    id: 'chq-2',
    dueDate: '2026-10-20',
    chequeNo: '000202',
    tenantName: 'Liam Carter',
    unitNo: '1204',
    status: 'deposited',
    amountFils: 1_500_000,
  }),
];

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/buildings': {
      items: [building(), building({ id: 'bld-2', nameEn: 'Marina Heights' })],
    },
    'GET /api/staff/owners': (c: ApiCall) =>
      c.query['search'] === 'fat'
        ? page([owner({ id: 'own-2', nameEn: 'Fatima Al Zarooni', phoneE164: '+971502223333' })])
        : page([owner()]),
    'GET /api/staff/cheques': page(ROWS),
    'GET /api/staff/cheques/:id': chequeRow(),
    ...extra,
  };
}

describe('ChequesPage', () => {
  it("lists this month's cheques and moves between periods", async () => {
    const { api, router, user } = await renderApp('/cheques', { routes: routes() });
    const link = await screen.findByRole('link', { name: '5 Oct 2026' });
    const row = link.closest('tr');
    if (!row) throw new Error('no row');
    expect(within(row).getByText('Al Noor Tower · 801')).toBeTruthy();
    expect(within(row).getByText('000101')).toBeTruthy();
    expect(within(row).getByText('AED 23,750')).toBeTruthy();
    expect(within(row).getByText('Upcoming')).toBeTruthy();
    const month = monthPeriod(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)));
    expect(api.last('GET', '/api/staff/cheques').query).toEqual({
      from: month.from,
      to: month.to,
      limit: '50',
    });

    // The period bar: a preset chip, then a typed custom range, both kept in the URL.
    await user.click(screen.getByRole('radio', { name: 'Last month' }));
    const last = previousPeriod(month);
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query).toMatchObject({
        from: last.from,
        to: last.to,
      });
    });
    expect(router.state.location.search).toMatchObject({ preset: 'last_month' });
    await user.click(screen.getByRole('button', { name: 'Custom range' }));
    await user.type(screen.getByRole('textbox', { name: 'From' }), '01/01/2026');
    await user.type(screen.getByRole('textbox', { name: 'To' }), '31/03/2026{Enter}');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query).toMatchObject({
        from: '2026-01-01',
        to: '2026-03-31',
      });
    });
    expect(router.state.location.search).toMatchObject({ from: '2026-01-01', to: '2026-03-31' });

    await user.hover(screen.getByText('Liam Carter'));
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/cheques/chq-2')).toHaveLength(1);
    });
  });

  it('filters by status, building and owner', async () => {
    const { api, user } = await renderApp('/cheques?status=bounced', { routes: routes() });
    await screen.findByText('Liam Carter');
    expect(api.last('GET', '/api/staff/cheques').query['status']).toBe('bounced');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'cleared');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Building' }),
      screen.getByRole('option', { name: 'Marina Heights' }),
    );
    const picker = screen.getByRole('combobox', { name: 'Owner' });
    await user.click(picker);
    expect(await screen.findByRole('option', { name: /Ahmed Al Mansouri/ })).toBeTruthy();
    await user.type(picker, 'fat');
    const fatima = await screen.findByRole('option', { name: /Fatima Al Zarooni/ });
    expect(fatima).toBeTruthy();
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    expect(picker).toHaveProperty('value', 'Fatima Al Zarooni');
    expect(screen.queryByRole('listbox')).toBeNull();
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query).toMatchObject({
        status: 'cleared',
        buildingId: 'bld-2',
        ownerId: 'own-2',
      });
    });

    // Clearing the box clears the owner filter.
    await user.clear(picker);
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query['ownerId']).toBeUndefined();
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    // A click on an option also chooses it, and a click elsewhere closes the list.
    await user.type(picker, 'a');
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Ahmed Al Mansouri/ }));
    expect(picker).toHaveProperty('value', 'Ahmed Al Mansouri');
    await user.keyboard('{Backspace}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('flips the status at once and keeps it when the API agrees', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const { api, user } = await renderApp('/cheques', {
      role: 'editor',
      routes: routes({
        'POST /api/staff/cheques/:id/status': () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }),
    });
    const row = (await screen.findByText('Sara Khan')).closest('tr');
    if (!row) throw new Error('no row');
    await user.click(within(row).getByRole('button', { name: 'Change status' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Mark deposited', 'Cancel cheque']);
    await user.click(within(dialog).getByRole('radio', { name: 'Mark deposited' }));
    await user.type(within(dialog).getByLabelText(/Note/), 'Deposited at ENBD Marina');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await vi.waitFor(() => {
      expect(within(row).getByText('Deposited')).toBeTruthy();
    });
    finish({ cheque: { status: 'deposited', contractId: 'con-1' }, replacement: null });
    expect(await screen.findByText('Status updated.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/cheques/chq-1/status').body).toEqual({
      to: 'deposited',
      note: 'Deposited at ENBD Marina',
    });
  });

  it('rolls the status back and shows the reason when the API refuses', async () => {
    const { user } = await renderApp('/cheques', {
      routes: routes({
        'POST /api/staff/cheques/:id/status': apiError(
          409,
          'invalid_transition',
          'This cheque was already cancelled.',
        ),
      }),
    });
    const row = (await screen.findByText('Sara Khan')).closest('tr');
    if (!row) throw new Error('no row');
    await user.click(within(row).getByRole('button', { name: 'Change status' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Cancel cheque' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText('This cheque was already cancelled.')).toBeTruthy();
    expect(within(row).getByText('Upcoming')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('the bulk bar counts the selection and deposits every selected cheque on one date', async () => {
    const { api, user } = await renderApp('/cheques', {
      routes: routes({
        'POST /api/staff/cheques/bulk-status': (c: ApiCall) => ({
          updated: (c.body as { ids: string[] }).ids,
          notified: 0,
        }),
      }),
    });
    await screen.findByText('Sara Khan');
    expect(screen.getByRole('link', { name: 'Bank statement' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Selected cheques' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'All' }));
    const bar = screen.getByRole('region', { name: 'Selected cheques' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: 'Mark deposited' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark deposited: 2 cheques' });
    expect(within(dialog).getByLabelText('Deposit date')).toHaveProperty(
      'value',
      todayInDubai().split('-').reverse().join('/'),
    );
    await user.type(within(dialog).getByLabelText(/Note/), 'ENBD Marina');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('2 cheques updated.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/cheques/bulk-status').body).toEqual({
      ids: ['chq-1', 'chq-2'],
      status: 'deposited',
      date: todayInDubai(),
      note: 'ENBD Marina',
    });
    expect(screen.queryByRole('region', { name: 'Selected cheques' })).toBeNull();
  });

  it('a bounce needs a reason; when the server refuses, each cheque is listed and nothing changes', async () => {
    const { api, user } = await renderApp('/cheques', {
      routes: routes({
        'POST /api/staff/cheques/bulk-status': apiError(
          422,
          'invalid_transition',
          '1 of 2 cheques cannot be marked bounced; nothing was changed',
          {
            rejected: [
              {
                id: 'chq-1',
                chequeNo: '000101',
                from: 'upcoming',
                code: 'invalid_transition',
                reason: 'Cannot move a cheque from upcoming to bounced',
              },
            ],
          },
        ),
      }),
    });
    await screen.findByText('Sara Khan');
    await user.click(screen.getByRole('checkbox', { name: 'All' }));
    await user.click(screen.getByRole('button', { name: 'Mark bounced' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toHaveProperty('disabled', true);
    await user.click(within(dialog).getByRole('button', { name: 'Insufficient funds' }));
    expect(within(dialog).getByLabelText(/Bounce reason/)).toHaveProperty(
      'value',
      'Insufficient funds',
    );
    await user.click(confirm);

    expect(
      await within(dialog).findByText('Nothing was changed. These cheques cannot be updated:'),
    ).toBeTruthy();
    expect(within(dialog).getByText('000101')).toBeTruthy();
    expect(within(dialog).getByText('Is Upcoming; cannot move to Bounced')).toBeTruthy();
    expect(api.last('POST', '/api/staff/cheques/bulk-status').body).toEqual({
      ids: ['chq-1', 'chq-2'],
      status: 'bounced',
      date: todayInDubai(),
      reason: 'Insufficient funds',
    });
    // Nothing changed on screen either.
    expect(screen.getAllByText('Upcoming').length).toBeGreaterThan(0);
    await user.click(within(dialog).getByRole('button', { name: 'Deselect these and go back' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(
      within(screen.getByRole('region', { name: 'Selected cheques' })).getByText('1 selected'),
    ).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '000101' })).toHaveProperty('checked', false);
  });

  it('shows the mixed state, clears the selection, refuses future dates and labels unknown cheques by id', async () => {
    const { user } = await renderApp('/cheques?status=upcoming,deposited', {
      routes: routes({
        'GET /api/staff/cheques': page([
          chequeRow({ id: 'chq-9', chequeNo: null, bankName: null, tenantName: 'No Number' }),
          ...ROWS,
        ]),
        'POST /api/staff/cheques/bulk-status': apiError(422, 'invalid_transition', 'refused', {
          rejected: [
            { id: 'chq-gone', chequeNo: null, from: null, code: 'not_found', reason: 'Not found' },
          ],
        }),
      }),
    });
    await screen.findByText('No Number');
    // A status list from a link (overview cards) stays selectable as it came.
    expect(screen.getByRole('option', { name: 'upcoming,deposited' })).toBeTruthy();
    // A cheque without a number is labelled by its id and shows dashes.
    const all = screen.getByRole('checkbox', { name: 'All' });
    await user.click(screen.getByRole('checkbox', { name: 'chq-9' }));
    expect(all).toHaveProperty('indeterminate', true);
    await user.click(all);
    expect(all).toHaveProperty('indeterminate', false);
    expect(screen.getByText('3 selected')).toBeTruthy();
    await user.click(all);
    expect(screen.queryByRole('region', { name: 'Selected cheques' })).toBeNull();
    await user.click(all);
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Selected cheques' })).toBeNull();

    await user.click(all);
    await user.click(screen.getByRole('button', { name: 'Mark cleared' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: 'Mark cleared' }));
    const dialog = await screen.findByRole('dialog');
    const date = within(dialog).getByLabelText('Cleared date');
    await user.clear(date);
    await user.type(date, '01/01/2099{Enter}');
    expect(await within(dialog).findByText('The date cannot be in the future.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toHaveProperty(
      'disabled',
      true,
    );
    await user.clear(date);
    await user.type(date, '01/10/2026{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText('chq-gone')).toBeTruthy();
    expect(within(dialog).getByText('No longer exists')).toBeTruthy();
    await user.click(at(within(dialog).getAllByRole('button', { name: 'Close' }), -1));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('cancels selected cheques without a date or reason, and lists the ones that cannot be cancelled', async () => {
    let refuse = false;
    const { api, user } = await renderApp('/cheques', {
      routes: routes({
        'POST /api/staff/cheques/bulk-status': (c: ApiCall) =>
          refuse
            ? apiError(422, 'invalid_transition', 'refused', {
                rejected: [
                  {
                    id: 'chq-2',
                    chequeNo: '000202',
                    from: 'deposited',
                    code: 'invalid_transition',
                    reason: 'Cannot move a cheque from deposited to cancelled',
                  },
                ],
              })
            : { updated: (c.body as { ids: string[] }).ids, notified: 0 },
      }),
    });
    await screen.findByText('Sara Khan');
    await user.click(screen.getByRole('checkbox', { name: '000101' }));
    await user.click(screen.getByRole('button', { name: 'Cancel cheque' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel cheque: 1 cheques' });
    // A cancel has no bank date and no reason, as with a single cancel.
    expect(within(dialog).queryByLabelText(/date/i)).toBeNull();
    expect(within(dialog).queryByLabelText(/Bounce reason/)).toBeNull();
    await user.type(within(dialog).getByLabelText(/Note/), 'Contract ended early');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('1 cheques updated.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/cheques/bulk-status').body).toEqual({
      ids: ['chq-1'],
      status: 'cancelled',
      note: 'Contract ended early',
    });

    refuse = true;
    await user.click(screen.getByRole('checkbox', { name: 'All' }));
    await user.click(screen.getByRole('button', { name: 'Cancel cheque' }));
    const again = await screen.findByRole('dialog');
    await user.click(within(again).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(again).findByText('Nothing was changed. These cheques cannot be updated:'),
    ).toBeTruthy();
    expect(within(again).getByText('000202')).toBeTruthy();
    expect(within(again).getByText('Is Deposited; cannot move to Cancelled')).toBeTruthy();
    expect(api.last('POST', '/api/staff/cheques/bulk-status').body).toEqual({
      ids: ['chq-1', 'chq-2'],
      status: 'cancelled',
    });
  });

  it(`blocks a bulk change of more than ${String(MAX_BULK_CHEQUES)} cheques`, async () => {
    const many = Array.from({ length: MAX_BULK_CHEQUES + 1 }, (_, i) =>
      chequeRow({ id: `m-${String(i)}`, chequeNo: String(500_000 + i) }),
    );
    const { user } = await renderApp('/cheques', {
      routes: routes({ 'GET /api/staff/cheques': page(many) }),
    });
    await screen.findAllByText('Sara Khan');
    await user.click(screen.getByRole('checkbox', { name: 'All' }));
    const bar = screen.getByRole('region', { name: 'Selected cheques' });
    expect(
      within(bar).getByText(`Select at most ${String(MAX_BULK_CHEQUES)} cheques at a time.`),
    ).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Mark deposited' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('the bulk bar and dialog have no axe violations', async () => {
    const { user, container } = await renderApp('/cheques', { routes: routes() });
    await screen.findByText('Sara Khan');
    await user.click(screen.getByRole('checkbox', { name: 'All' }));
    const bar = screen.getByRole('region', { name: 'Selected cheques' });
    expect((await axe.run(bar)).violations).toEqual([]);
    await user.click(within(bar).getByRole('button', { name: 'Mark bounced' }));
    const dialog = await screen.findByRole('dialog');
    expect((await axe.run(dialog)).violations).toEqual([]);
    expect(container).toBeTruthy();
  });

  it('pages, shows an empty month and the error state, and hides editing from viewers', async () => {
    const { api, user } = await renderApp('/cheques', {
      role: 'viewer',
      routes: routes({
        'GET /api/staff/cheques': (c: ApiCall) =>
          c.query['cursor'] ? page([]) : page([ROWS[0]], 'more'),
      }),
    });
    await screen.findByText('Sara Khan');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Bank statement' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change status' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query['cursor']).toBe('more');
    });
    cleanup();

    await renderApp('/cheques', { routes: routes({ 'GET /api/staff/cheques': page([]) }) });
    expect(await screen.findByText('No cheques match these filters.')).toBeTruthy();
    cleanup();

    const failing = await renderApp('/cheques', {
      routes: routes({ 'GET /api/staff/cheques': apiError(500, 'internal') }),
    });
    await failing.user.click(await screen.findByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(failing.api.to('GET', '/api/staff/cheques').length).toBeGreaterThan(1);
    });
  });
});
