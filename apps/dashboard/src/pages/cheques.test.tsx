// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { addMonthsClamped, todayInDubai, type PlainDate } from '@vamar/shared';
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
  it("lists this month's cheques and moves between months", async () => {
    const { api, user } = await renderApp('/cheques', { routes: routes() });
    const link = await screen.findByRole('link', { name: '5 Oct 2026' });
    const row = link.closest('tr');
    if (!row) throw new Error('no row');
    expect(within(row).getByText('Al Noor Tower · 801')).toBeTruthy();
    expect(within(row).getByText('000101')).toBeTruthy();
    expect(within(row).getByText('AED 23,750')).toBeTruthy();
    expect(within(row).getByText('Upcoming')).toBeTruthy();
    expect(api.last('GET', '/api/staff/cheques').query).toEqual({ month: thisMonth, limit: '50' });

    const monthStart = `${thisMonth}-01` as PlainDate;
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query['month']).toBe(
        addMonthsClamped(monthStart, -1).slice(0, 7),
      );
    });
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query['month']).toBe(
        addMonthsClamped(monthStart, 1).slice(0, 7),
      );
    });

    // The month label toggles between one month and every month.
    const label = screen.getByRole('button', { name: /\d{4}$/ });
    await user.click(label);
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query).toEqual({ limit: '50' });
    });
    await user.click(screen.getByRole('button', { name: 'All' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query['month']).toBe(thisMonth);
    });
    await user.click(screen.getByRole('button', { name: /\d{4}$/ }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query['month']).toBe(thisMonth);
    });
    await user.click(screen.getByRole('button', { name: /\d{4}$/ }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query['month']).toBe(thisMonth);
    });

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

  it('bulk-updates the selected cheques and lists the ones that failed', async () => {
    const { api, user } = await renderApp('/cheques', {
      routes: routes({
        'POST /api/staff/cheques/bulk-status': (c: ApiCall) => {
          const ids = (c.body as { chequeIds: string[] }).chequeIds;
          return ids.length > 1
            ? { ok: ['chq-1'], failed: [{ id: 'chq-2', reason: 'Already deposited' }] }
            : { ok: ids, failed: [] };
        },
      }),
    });
    await screen.findByText('Sara Khan');
    await user.click(screen.getByRole('checkbox', { name: 'All' }));
    await user.click(screen.getByRole('button', { name: 'Bulk update · 2 selected' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Status' }), 'bounced');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByLabelText('Bounce reason'), 'Insufficient funds');
    await user.click(confirm);

    expect(await within(dialog).findByText('Not updated')).toBeTruthy();
    expect(within(dialog).getByText('000202')).toBeTruthy();
    expect(within(dialog).getByText('Already deposited')).toBeTruthy();
    expect(api.last('POST', '/api/staff/cheques/bulk-status').body).toEqual({
      chequeIds: ['chq-1', 'chq-2'],
      to: 'bounced',
      note: 'Insufficient funds',
    });
    // The footer button, not the dialog's X.
    await user.click(at(within(dialog).getAllByRole('button', { name: 'Close' }), -1));
    expect(await screen.findByText('1 updated, 1 failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Bulk update/ })).toBeNull();
  });

  it('bulk-updates a single cheque with no failures', async () => {
    const { user } = await renderApp('/cheques', {
      routes: routes({
        'POST /api/staff/cheques/bulk-status': (c: ApiCall) => ({
          ok: (c.body as { chequeIds: string[] }).chequeIds,
          failed: [],
        }),
      }),
    });
    await screen.findByText('Sara Khan');
    const box = screen.getByRole('checkbox', { name: '000101' });
    await user.click(box);
    await user.click(screen.getByRole('checkbox', { name: '000202' }));
    await user.click(screen.getByRole('checkbox', { name: '000202' }));
    await user.click(screen.getByRole('button', { name: 'Bulk update · 1 selected' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('1 updated, 0 failed')).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: 'Change status' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/cheques').query['cursor']).toBe('more');
    });
    cleanup();

    await renderApp('/cheques', { routes: routes({ 'GET /api/staff/cheques': page([]) }) });
    expect(await screen.findByText('No cheques match these filters.')).toBeTruthy();
    cleanup();

    await renderApp('/cheques', {
      routes: routes({ 'GET /api/staff/cheques': apiError(500, 'internal') }),
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
