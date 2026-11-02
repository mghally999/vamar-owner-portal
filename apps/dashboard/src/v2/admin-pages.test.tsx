// @vitest-environment jsdom
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

describe('SettingsPage', () => {
  it('shows the settings and saves the changed ones as an admin', async () => {
    const { api, user } = await renderV2('/settings', {
      routes: {
        'GET /api/staff/settings': settings(),
        'PATCH /api/staff/settings': (c: ApiCall) => settings(c.body as object),
      },
    });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    const week = await screen.findByRole('combobox', { name: /Week starts on/ });
    expect(week).toHaveProperty('value', 'monday');
    const threshold = screen.getByRole('textbox', { name: /Large expense alert/ });
    expect(threshold).toHaveProperty('value', '5000');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    await user.selectOptions(week, 'sunday');
    await user.click(screen.getByRole('checkbox', { name: /Hijri/ }));
    await user.clear(threshold);
    await user.type(threshold, '7500');
    await user.click(save);
    expect(await screen.findByText('Settings saved.')).toBeTruthy();
    expect(api.last('PATCH', '/api/staff/settings').body).toEqual({
      weekStart: 'sunday',
      hijriDisplay: true,
      showBeforeFeeLabel: true,
      ownersSeeInvoiceFiles: true,
      largeExpenseAlertFils: 750_000,
    });
  });

  it('is read-only for editors, in Arabic too', async () => {
    await renderV2('/settings', {
      role: 'editor',
      lang: 'ar',
      routes: { 'GET /api/staff/settings': settings() },
    });
    expect(await screen.findByRole('heading', { name: 'الإعدادات' })).toBeTruthy();
    expect(screen.getByText('المدير وحده يستطيع تغيير هذا.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /يبدأ الأسبوع/ })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'حفظ' })).toBeNull();
  });

  it('shows the error state when the settings cannot load', async () => {
    await renderV2('/settings', {
      routes: { 'GET /api/staff/settings': apiError(500, 'internal') },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('HolidaysPage', () => {
  function routes(extra: Record<string, unknown> = {}) {
    return {
      'GET /api/staff/holidays': (c: ApiCall) =>
        c.query['year'] === '2027' ? { items: [] } : { items: holidays },
      'PUT /api/staff/holidays': (c: ApiCall) => c.body,
      'DELETE /api/staff/holidays/:date': { ok: true },
      ...extra,
    };
  }

  it('lists the year, marks tentative ones, adds and removes as an admin', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api, user } = await renderV2('/holidays', { routes: routes() });
    expect(await screen.findByText("New Year's Day")).toBeTruthy();
    const eid = screen.getByText('Eid Al Fitr').closest('tr');
    if (!eid) throw new Error('no row');
    expect(within(eid).getByText('Tentative')).toBeTruthy();
    expect(within(eid).getByText('20 Mar 2026')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Add holiday' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByLabelText(/Name \(Arabic\)/), 'يوم الشهداء');
    await user.type(within(dialog).getByLabelText(/Name \(English\)/), 'Commemoration Day');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Tentative' }));
    await user.click(save);
    await vi.waitFor(() => {
      expect(api.to('PUT', '/api/staff/holidays')).toHaveLength(1);
    });
    expect(api.last('PUT', '/api/staff/holidays').body).toEqual({
      date: '2026-01-01',
      nameAr: 'يوم الشهداء',
      nameEn: 'Commemoration Day',
      tentative: true,
    });
    expect(await screen.findByText('Saved.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Delete National Day' }));
    await vi.waitFor(() => {
      expect(api.to('DELETE', '/api/staff/holidays/2026-12-02')).toHaveLength(1);
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '2027');
    expect(await screen.findByText('No holidays for this year.')).toBeTruthy();
  });

  it('hides the editing from editors', async () => {
    await renderV2('/holidays', { role: 'editor', routes: routes() });
    expect(await screen.findByText('National Day')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add holiday' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });
});

describe('CategoriesPage', () => {
  function routes(extra: Record<string, unknown> = {}) {
    return {
      'GET /api/staff/expense-categories': (c: ApiCall) => ({
        items: c.query['includeInactive'] === '1' ? categories : categories.filter((x) => x.active),
      }),
      'POST /api/staff/expense-categories': (c: ApiCall) => ({
        id: 'cat-new',
        ...(c.body as object),
      }),
      'PATCH /api/staff/expense-categories/:id': (c: ApiCall) => c.body,
      ...extra,
    };
  }

  it('groups fixed and variable categories, shows inactive on demand, adds and deactivates', async () => {
    const { api, user } = await renderV2('/expense-categories', { routes: routes() });
    expect(await screen.findByText('Building staff salaries')).toBeTruthy();
    expect(screen.getByText('Plumbing')).toBeTruthy();
    expect(screen.queryByText('Building insurance')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Show inactive' }));
    expect(await screen.findByText('Building insurance')).toBeTruthy();
    const insurance = screen.getByText('Building insurance').closest('tr');
    if (!insurance) throw new Error('no row');
    expect(within(insurance).getByText('Inactive')).toBeTruthy();
    await user.click(within(insurance).getByRole('button', { name: 'Activate' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/expense-categories/cat-ins').body).toEqual({
        active: true,
      });
    });

    await user.click(screen.getByRole('button', { name: 'Add category' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name \(Arabic\)/), 'حدائق');
    await user.type(within(dialog).getByLabelText(/Name \(English\)/), 'Landscaping');
    await user.selectOptions(within(dialog).getByLabelText(/Kind/), 'variable');
    await user.clear(within(dialog).getByLabelText(/Order/));
    await user.type(within(dialog).getByLabelText(/Order/), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/expense-categories').body).toEqual({
        nameAr: 'حدائق',
        nameEn: 'Landscaping',
        kind: 'variable',
        sort: 30,
      });
    });
  });

  it('is read-only for editors in Arabic', async () => {
    await renderV2('/expense-categories', { role: 'editor', lang: 'ar', routes: routes() });
    expect(await screen.findByText('رواتب')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ثابتة' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'إضافة فئة' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'تعديل' })).toBeNull();
  });
});

describe('VendorsPage', () => {
  function routes(extra: Record<string, unknown> = {}) {
    return {
      'GET /api/staff/vendors': (c: ApiCall) => ({
        items: c.query['search']
          ? vendors.filter((v) => v.name.includes(c.query['search'] ?? ''))
          : vendors,
      }),
      'POST /api/staff/vendors': (c: ApiCall) => ({ id: 'ven-new', ...(c.body as object) }),
      'PATCH /api/staff/vendors/:id': (c: ApiCall) => c.body,
      ...extra,
    };
  }

  it('lists vendors with TRN, searches, adds one and refuses a bad TRN', async () => {
    const { api, user } = await renderV2('/vendors', { role: 'editor', routes: routes() });
    expect(await screen.findByText('Cool Breeze AC Services')).toBeTruthy();
    expect(screen.getByText('100345678900003')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Clean');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/vendors').query).toEqual({ search: 'Clean' });
    });
    expect(await screen.findByText('Clean & Shine Services')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Add vendor' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Gulf Lifts');
    await user.type(within(dialog).getByLabelText(/TRN/), '123');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    await user.clear(within(dialog).getByLabelText(/TRN/));
    await user.type(within(dialog).getByLabelText(/TRN/), '100456789000003');
    await user.type(within(dialog).getByLabelText(/Phone/), '+97142221133');
    await user.click(save);
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/vendors').body).toEqual({
        name: 'Gulf Lifts',
        phone: '+97142221133',
        email: null,
        trn: '100456789000003',
        notes: '',
        active: true,
      });
    });
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('edits a vendor and hides editing from viewers', async () => {
    const { api, user } = await renderV2('/vendors', { routes: routes() });
    const row = (await screen.findByText('Clean & Shine Services')).closest('tr');
    if (!row) throw new Error('no row');
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Active' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/vendors/ven-2').body).toMatchObject({
        active: false,
        notes: 'Pest control',
      });
    });
    cleanup();
    await renderV2('/vendors', { role: 'viewer', routes: routes() });
    expect(await screen.findByText('Cool Breeze AC Services')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add vendor' })).toBeNull();
  });
});
