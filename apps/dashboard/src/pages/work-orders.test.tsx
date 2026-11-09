// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, buildingDetail, page } from '@/test/fixtures';
import {
  attachment,
  expenseRow,
  expenseTotals,
  v2Routes,
  workOrderDetail,
  workOrderRow,
} from '@/test/fixtures-v2';
import { renderApp, pickOption } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROWS = [
  workOrderRow(),
  workOrderRow({
    id: 'wo-2',
    titleEn: 'Lift 2 out of service',
    status: 'done',
    priority: 'normal',
    unitId: null,
    unitNo: null,
    expenseId: 'exp-1',
    expenseTotalFils: 1_302_000,
    expenseStatus: 'posted',
    completedAt: '2026-10-15T08:00:00.000Z',
  }),
  workOrderRow({
    id: 'wo-3',
    titleEn: 'Repaint corridor',
    status: 'open',
    priority: 'low',
    scheduledFor: null,
  }),
];

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/buildings/:id': buildingDetail(),
    'GET /api/staff/work-orders': page(ROWS),
    ...extra,
  });

describe('WorkOrdersPage', () => {
  it('lists work orders, filters, and switches to the board', async () => {
    const { api, user } = await renderApp('/work-orders', { role: 'editor', routes: routes() });
    const link = await screen.findByRole('link', { name: 'AC not cooling' });
    const row = link.closest('tr');
    if (!row) throw new Error('no row');
    expect(within(row).getByText('Urgent')).toBeTruthy();
    expect(within(row).getByText('In progress')).toBeTruthy();
    expect(within(row).getByText('Al Noor Tower · 801')).toBeTruthy();
    expect(screen.getByText('AED 13,020')).toBeTruthy();
    await pickOption(user, screen.getByRole('combobox', { name: 'Building' }), 'bld-1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'done');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'urgent');
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'lift');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/work-orders').query).toMatchObject({
        buildingId: 'bld-1',
        status: 'done',
        priority: 'urgent',
        search: 'lift',
      });
    });
    await user.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull();
    const done = screen.getByRole('region', { name: 'Done' });
    expect(within(done).getByRole('link', { name: /Lift 2 out of service/ })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Scheduled' })).getByText('—')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New work order' })).toBeTruthy();
  });

  it('pages, and shows the empty and error states', async () => {
    const { api, user } = await renderApp('/work-orders', {
      role: 'viewer',
      routes: routes({
        'GET /api/staff/work-orders': (c: ApiCall) =>
          c.query['cursor'] ? page([]) : page(ROWS, 'next'),
      }),
    });
    await screen.findByText('AC not cooling');
    expect(screen.queryByRole('button', { name: 'New work order' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/work-orders').query['cursor']).toBe('next');
    });
    cleanup();
    await renderApp('/work-orders', { routes: routes({ 'GET /api/staff/work-orders': page([]) }) });
    expect(await screen.findByText('No work orders match.')).toBeTruthy();
    cleanup();
    const failing = await renderApp('/work-orders', {
      routes: routes({ 'GET /api/staff/work-orders': apiError(500, 'internal') }),
    });
    await failing.user.click(await screen.findByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(failing.api.to('GET', '/api/staff/work-orders').length).toBeGreaterThan(1);
    });
  });

  it('opens the form for a new work order from the list', async () => {
    const { router, user } = await renderApp('/work-orders', { role: 'editor', routes: routes() });
    await user.click(await screen.findByRole('button', { name: 'New work order' }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/work-orders/new');
    });
  });
});

describe('WorkOrderDetailPage', () => {
  it('creates a work order and opens it', async () => {
    const { api, router, user } = await renderApp('/work-orders/new', {
      role: 'editor',
      routes: routes({
        'POST /api/staff/work-orders': workOrderRow({ id: 'wo-new', status: 'scheduled' }),
        'GET /api/staff/work-orders/:id': workOrderDetail({ id: 'wo-new', status: 'scheduled' }),
      }),
    });
    expect(await screen.findByRole('heading', { name: 'New work order' })).toBeTruthy();
    const building = screen.getByRole('combobox', { name: /^Building/ });
    // The buildings arrive after the form renders: pick one once it is in the list.
    await vi.waitFor(() => {
      expect(building.querySelector('option[value="bld-1"]')).not.toBeNull();
    });
    await pickOption(user, building, 'bld-1');
    await user.selectOptions(await screen.findByRole('combobox', { name: /^Unit/ }), 'unit-801');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Priority/ }), 'urgent');
    await user.type(screen.getByRole('textbox', { name: /^Title \(Arabic\)/ }), 'تسريب');
    await user.type(
      screen.getByRole('textbox', { name: /^Title \(English\)/ }),
      'Leak under the sink',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: /^Status/ }), 'scheduled');
    await user.type(screen.getByRole('textbox', { name: 'Scheduled for' }), '05/12/2026{Enter}');
    expect(screen.getByText('This date falls on a weekend.')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: /^Vendor/ }), 'ven-clean');
    await user.type(
      screen.getByRole('textbox', { name: /^Description/ }),
      'Tenant reported water on the floor.',
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/work-orders').body).toMatchObject({
        buildingId: 'bld-1',
        unitId: 'unit-801',
        titleEn: 'Leak under the sink',
        priority: 'urgent',
        status: 'scheduled',
        scheduledFor: '2026-12-05',
        vendorId: 'ven-clean',
        visibleToOwner: true,
      });
    });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/work-orders/wo-new');
    });
  });

  it('edits, marks done, uploads photos and links an invoice', async () => {
    const { api, user } = await renderApp('/work-orders/wo-1', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/work-orders/:id': workOrderDetail({
          attachments: [attachment({ id: 'ph-1', fileName: 'before.jpg' })],
        }),
        'PATCH /api/staff/work-orders/:id': (c: ApiCall) => workOrderRow({ ...(c.body as object) }),
        'POST /api/staff/attachments': attachment({ id: 'ph-2', fileName: 'after.jpg' }),
        'GET /api/staff/expenses': { ...page([expenseRow()]), totals: expenseTotals() },
      }),
    });
    expect(await screen.findByRole('heading', { name: 'AC not cooling' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'before.jpg' })).toBeTruthy();
    expect(screen.getByText('No invoice linked yet.')).toBeTruthy();
    await user.upload(
      screen.getByLabelText('Add photo'),
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'after.jpg', { type: 'image/jpeg' }),
    );
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/attachments')).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: 'Link an invoice' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Lift 2 repair/ }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/work-orders/wo-1').body).toEqual({ expenseId: 'exp-1' });
    });
    expect(await screen.findByText('Invoice linked.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mark done' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/work-orders/wo-1').body).toMatchObject({
        status: 'done',
      });
    });
    expect(screen.getByRole('button', { name: 'Record the invoice' })).toBeTruthy();
  });

  it('is read-only for viewers and for a cancelled order, and shows the error state', async () => {
    await renderApp('/work-orders/wo-1', {
      role: 'viewer',
      routes: routes({ 'GET /api/staff/work-orders/:id': workOrderDetail() }),
    });
    expect(await screen.findByRole('heading', { name: 'AC not cooling' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^Title \(English\)/ })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
    cleanup();
    await renderApp('/work-orders/wo-1', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/work-orders/:id': workOrderDetail({ status: 'cancelled' }),
      }),
    });
    expect(await screen.findByText(/A cancelled work order stays cancelled/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    cleanup();
    await renderApp('/work-orders/wo-1', {
      routes: routes({ 'GET /api/staff/work-orders/:id': apiError(500, 'internal') }),
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('saves an edit, shows why a save or a link was refused, and searches the invoices to link', async () => {
    let failSave: 'api' | 'network' | null = null;
    let failLink = false;
    const { api, user } = await renderApp('/work-orders/wo-2', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/work-orders/:id': workOrderDetail({
          id: 'wo-2',
          unitId: null,
          unitNo: null,
          vendorId: null,
          vendorName: null,
          scheduledFor: null,
          status: 'scheduled',
          expenseId: 'exp-0000000001',
          expenseStatus: null,
          expenseTotalFils: 1_302_000,
        }),
        'PATCH /api/staff/work-orders/:id': (c: ApiCall) => {
          const body = c.body as Record<string, unknown>;
          if ('expenseId' in body && failLink)
            return apiError(404, 'not_found', 'Expense not found');
          if (failSave === 'api')
            return apiError(409, 'conflict', 'A cancelled work order stays cancelled');
          if (failSave === 'network') throw new TypeError('Failed to fetch');
          return workOrderRow({ id: 'wo-2', ...body });
        },
        'GET /api/staff/expenses': (c: ApiCall) => ({
          ...page(c.query['search'] === 'nothing' ? [] : [expenseRow({ invoiceNo: null })]),
          totals: expenseTotals(),
        }),
      }),
    });
    expect(await screen.findByRole('heading', { name: 'AC not cooling' })).toBeTruthy();
    // The linked invoice shows its short id and total, without a status line.
    expect(screen.getByRole('link', { name: /exp-0000/ }).getAttribute('href')).toBe(
      '/expenses/exp-0000000001',
    );
    expect(screen.getByText('AED 13,020')).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Visible to owners' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/work-orders/wo-2').body).toMatchObject({
        unitId: null,
        vendorId: null,
        scheduledFor: null,
        visibleToOwner: false,
      });
    });
    expect(await screen.findByText('Work order saved.')).toBeTruthy();

    failSave = 'api';
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A cancelled work order stays cancelled')).toBeTruthy();
    failSave = 'network';
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();

    // Link dialog: an empty search, then a refused link.
    await user.click(screen.getByRole('button', { name: 'Link an invoice' }));
    let dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('— · 2026-10-12')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: 'Search' }), 'nothing');
    expect(await within(dialog).findByText('No expenses in this period.')).toBeTruthy();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    failLink = true;
    await user.click(screen.getByRole('button', { name: 'Link an invoice' }));
    dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Lift 2 repair/ }));
    expect(await screen.findByText('Expense not found')).toBeTruthy();
  });

  it('a done order shows when it was completed; record the invoice and cancel leave the page', async () => {
    const done = workOrderDetail({ status: 'done', completedAt: '2026-10-25T09:00:00.000Z' });
    const { router, user } = await renderApp('/work-orders/wo-1', {
      role: 'editor',
      routes: routes({ 'GET /api/staff/work-orders/:id': done }),
    });
    expect(await screen.findByText(/Completed: 25 Oct 2026/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Record the invoice' }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/expenses/new');
    });
    expect(router.state.location.search).toMatchObject({ workOrderId: 'wo-1' });

    cleanup();
    const again = await renderApp('/work-orders/wo-1', {
      role: 'editor',
      routes: routes({ 'GET /api/staff/work-orders/:id': done }),
    });
    await screen.findByRole('heading', { name: 'AC not cooling' });
    await again.user.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(again.router.state.location.pathname).toBe('/work-orders');
    });
  });

  it('retries a failed load', async () => {
    const { api, user } = await renderApp('/work-orders/wo-1', {
      routes: routes({ 'GET /api/staff/work-orders/:id': apiError(500, 'internal') }),
    });
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/work-orders/wo-1').length).toBeGreaterThan(1);
    });
  });
});
