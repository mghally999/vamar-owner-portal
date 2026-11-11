// @vitest-environment jsdom
/**
 * The admin pages beyond the happy path: failed loads and their retries, empty lists, the
 * "show inactive" switches, editing an existing row, a refused save, and closing each dialog.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { categories, holidays, settings, vendors } from './test-fixtures';
import { renderV2 } from './test-render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function dialogClosed() {
  await vi.waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

describe('SettingsPage, more', () => {
  it('retries a failed load, then saves the owner switches and refuses a bad threshold', async () => {
    let fail = true;
    const { api, user } = await renderV2('/settings', {
      routes: {
        'GET /api/staff/settings': () => (fail ? apiError(500, 'internal') : settings()),
        'PATCH /api/staff/settings': (c: ApiCall) => settings(c.body as object),
      },
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    await user.click(retry);
    const threshold = await screen.findByRole('textbox', { name: /Large expense alert/ });
    const save = screen.getByRole('button', { name: 'Save' });

    await user.clear(threshold);
    await user.type(threshold, '1.2.3');
    expect(save).toHaveProperty('disabled', true);
    expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.clear(threshold);
    await user.type(threshold, '5000');

    await user.click(screen.getByRole('checkbox', { name: /before Vamar/ }));
    await user.click(screen.getByRole('checkbox', { name: /invoice images/ }));
    expect(save).toHaveProperty('disabled', false);
    await user.click(save);
    expect(await screen.findByText('Settings saved.')).toBeTruthy();
    expect(api.last('PATCH', '/api/staff/settings').body).toEqual({
      weekStart: 'monday',
      hijriDisplay: false,
      showBeforeFeeLabel: false,
      ownersSeeInvoiceFiles: false,
      largeExpenseAlertFils: 500_000,
      repairApprovalThresholdFils: 500_000,
      repairApprovalSilenceDays: 3,
    });
  });

  it('says so when the save is refused', async () => {
    const { user } = await renderV2('/settings', {
      routes: {
        'GET /api/staff/settings': settings(),
        'PATCH /api/staff/settings': apiError(500, 'internal'),
      },
    });
    await user.click(await screen.findByRole('checkbox', { name: /Hijri/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByText('Settings saved.')).toBeNull();
  });
});

describe('HolidaysPage, more', () => {
  it('retries a failed year and edits a holiday without changing its date', async () => {
    let fail = true;
    const { api, user } = await renderV2('/holidays', {
      routes: {
        'GET /api/staff/holidays': () => (fail ? apiError(500, 'internal') : { items: holidays }),
        'PUT /api/staff/holidays': (c: ApiCall) => c.body,
      },
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    await user.click(retry);
    const eid = (await screen.findByText('Eid Al Fitr')).closest('tr');
    if (!eid) throw new Error('no row');
    const national = screen.getByText('National Day').closest('tr');
    if (!national) throw new Error('no row');
    expect(within(national).getByText('Confirmed')).toBeTruthy();

    await user.click(within(eid).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Edit' })).toBeTruthy();
    // The date is the key of a holiday: it cannot be changed, only the names and the flag.
    expect(within(dialog).getByLabelText(/^Date/)).toHaveProperty('disabled', true);
    const nameEn = within(dialog).getByLabelText(/Name \(English\)/);
    await user.clear(nameEn);
    await user.type(nameEn, 'Eid Al Fitr (1st day)');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Tentative' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(api.last('PUT', '/api/staff/holidays').body).toEqual({
      date: '2026-03-20',
      nameAr: 'عيد الفطر',
      nameEn: 'Eid Al Fitr (1st day)',
      tentative: false,
    });
  });

  it('adds a holiday on a typed date, reports a refused save and closes on cancel and Escape', async () => {
    const { api, user } = await renderV2('/holidays', {
      routes: {
        'GET /api/staff/holidays': { items: holidays },
        'PUT /api/staff/holidays': apiError(500, 'internal'),
      },
    });
    await screen.findByText('National Day');
    await user.click(screen.getByRole('button', { name: 'Add holiday' }));
    const dialog = await screen.findByRole('dialog');
    const date = within(dialog).getByLabelText(/^Date/);
    await user.clear(date);
    await user.type(date, '01/12/2026{Enter}');
    await user.type(within(dialog).getByLabelText(/Name \(Arabic\)/), 'يوم الشهيد');
    await user.type(within(dialog).getByLabelText(/Name \(English\)/), 'Commemoration Day');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(api.last('PUT', '/api/staff/holidays').body).toMatchObject({ date: '2026-12-01' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await dialogClosed();

    await user.click(screen.getByRole('button', { name: 'Add holiday' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await dialogClosed();
  });

  it('keeps a holiday when the removal is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { api, user } = await renderV2('/holidays', {
      routes: { 'GET /api/staff/holidays': { items: holidays } },
    });
    await user.click(await screen.findByRole('button', { name: 'Delete National Day' }));
    expect(window.confirm).toHaveBeenCalledWith('Remove this holiday?');
    expect(api.to('DELETE', '/api/staff/holidays/2026-12-02')).toHaveLength(0);
  });
});

describe('CategoriesPage, more', () => {
  it('retries a failed load and renames and reorders a category', async () => {
    let fail = true;
    const { api, user } = await renderV2('/expense-categories', {
      routes: {
        'GET /api/staff/expense-categories': () =>
          fail ? apiError(500, 'internal') : { items: categories.filter((c) => c.active) },
        'PATCH /api/staff/expense-categories/:id': (c: ApiCall) => c.body,
      },
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    await user.click(retry);
    const plumbing = (await screen.findByText('Plumbing')).closest('tr');
    if (!plumbing) throw new Error('no row');

    await user.click(within(plumbing).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Edit' })).toBeTruthy();
    const order = within(dialog).getByLabelText(/Order/);
    expect(order).toHaveProperty('value', '20');
    await user.clear(order);
    await user.type(order, '2a');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    await user.clear(order);
    await user.type(order, '5');
    const nameEn = within(dialog).getByLabelText(/Name \(English\)/);
    await user.clear(nameEn);
    await user.type(nameEn, '  Plumbing and drainage ');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(api.last('PATCH', '/api/staff/expense-categories/cat-plumb').body).toEqual({
      nameAr: 'سباكة',
      nameEn: 'Plumbing and drainage',
      kind: 'variable',
      sort: 5,
    });
    await dialogClosed();

    await user.click(within(plumbing).getByRole('button', { name: 'Deactivate' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/expense-categories/cat-plumb').body).toEqual({
        active: false,
      });
    });
  });

  it('reports a refused save and closes on cancel and Escape', async () => {
    const { user } = await renderV2('/expense-categories', {
      routes: {
        'GET /api/staff/expense-categories': { items: categories },
        'POST /api/staff/expense-categories': apiError(500, 'internal'),
      },
    });
    await screen.findByText('Plumbing');
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name \(Arabic\)/), 'مصاعد');
    await user.type(within(dialog).getByLabelText(/Name \(English\)/), 'Lifts');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await dialogClosed();

    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await dialogClosed();
  });
});

describe('VendorsPage, more', () => {
  it('retries a failed load, shows inactive vendors on demand and says when there are none', async () => {
    let fail = true;
    const { api, user } = await renderV2('/vendors', {
      routes: {
        'GET /api/staff/vendors': (c: ApiCall) => {
          if (fail) return apiError(500, 'internal');
          if (c.query['search']) return { items: [] };
          return {
            items:
              c.query['includeInactive'] === '1'
                ? [...vendors, { ...vendors[1], id: 'ven-3', name: 'Old Lifts Co', active: false }]
                : vendors,
          };
        },
      },
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    await user.click(retry);
    const shine = (await screen.findByText('Clean & Shine Services')).closest('tr');
    if (!shine) throw new Error('no row');
    // No phone, email or TRN on file: dashes.
    expect(within(shine).getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('Old Lifts Co')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Show inactive' }));
    const old = (await screen.findByText('Old Lifts Co')).closest('tr');
    if (!old) throw new Error('no row');
    expect(within(old).getByText('Inactive')).toBeTruthy();
    expect(api.last('GET', '/api/staff/vendors').query).toMatchObject({ includeInactive: '1' });

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Nobody');
    expect(await screen.findByText('No vendors yet.')).toBeTruthy();
  });

  it('saves email and notes, reports a refused save and closes on cancel and Escape', async () => {
    let refuse = false;
    const { api, user } = await renderV2('/vendors', {
      role: 'editor',
      routes: {
        'GET /api/staff/vendors': { items: vendors },
        'PATCH /api/staff/vendors/:id': (c: ApiCall) =>
          refuse ? apiError(500, 'internal') : c.body,
      },
    });
    const shine = (await screen.findByText('Clean & Shine Services')).closest('tr');
    if (!shine) throw new Error('no row');
    await user.click(within(shine).getByRole('button', { name: 'Edit' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Email/), ' ops@cleanshine.ae ');
    const notes = within(dialog).getByLabelText(/Notes/);
    await user.clear(notes);
    await user.type(notes, 'Pest control and deep cleaning');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(api.last('PATCH', '/api/staff/vendors/ven-2').body).toEqual({
      name: 'Clean & Shine Services',
      phone: null,
      email: 'ops@cleanshine.ae',
      trn: null,
      notes: 'Pest control and deep cleaning',
      active: true,
    });
    await dialogClosed();

    refuse = true;
    await user.click(within(shine).getByRole('button', { name: 'Edit' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await dialogClosed();

    await user.click(screen.getByRole('button', { name: 'Add vendor' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await dialogClosed();
  });
});
