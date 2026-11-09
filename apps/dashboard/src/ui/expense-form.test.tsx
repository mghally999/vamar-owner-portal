// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, buildingDetail } from '@/test/fixtures';
import { expenseRow, v2Routes } from '@/test/fixtures-v2';
import { renderApp, pickOption } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/buildings/:id': buildingDetail(),
    'POST /api/staff/expenses/preview-allocation': { method: 'by_ownership', items: [] },
    'POST /api/staff/expenses/warnings': { duplicateInvoice: null, outlier: null },
    ...extra,
  });

describe('ExpenseForm', () => {
  it('the new vendor dialog checks the TRN, sends the phone, says when it fails, and cancels', async () => {
    const { api, user } = await renderApp('/expenses/new', {
      role: 'editor',
      routes: routes({
        'POST /api/staff/vendors': apiError(409, 'conflict', 'Vendor exists'),
      }),
    });
    // The page loads lazily; the first load on a busy machine can be slow.
    await screen.findByText('New expense', undefined, { timeout: 90_000 });
    await user.click(screen.getByRole('button', { name: 'New vendor' }));
    const dialog = await screen.findByRole('dialog');
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toHaveProperty('disabled', true);
    await user.click(within(dialog).getByRole('textbox', { name: /^Vendor name/ }));
    await user.paste('Desert Cleaning');
    await user.click(within(dialog).getByRole('textbox', { name: /^Phone/ }));
    await user.paste('+971501112222');
    const trn = within(dialog).getByRole('textbox', { name: /^TRN/ });
    await user.click(trn);
    await user.paste('123');
    expect(trn.getAttribute('aria-invalid')).toBe('true');
    expect(create).toHaveProperty('disabled', true);
    await user.clear(trn);
    expect(create).toHaveProperty('disabled', false);

    await user.click(create);
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/vendors').body).toEqual({
      name: 'Desert Cleaning',
      phone: '+971501112222',
      trn: null,
    });
    // A refused vendor keeps the dialog open; Cancel closes it.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('keeps the save closed until the form is valid, and sends the chosen split, covered period and payment', async () => {
    const { api, user } = await renderApp('/expenses/new', {
      role: 'editor',
      routes: routes({
        // The duplicate and outlier check failing never blocks the form.
        'POST /api/staff/expenses/warnings': () => {
          throw new TypeError('Failed to fetch');
        },
        'POST /api/staff/expenses': (c: ApiCall) => ({
          ...expenseRow({ id: 'exp-new', status: 'draft' }),
          ...(c.body as object),
        }),
      }),
    });
    // The page loads lazily; the first load on a busy machine can be slow.
    await screen.findByText('New expense', undefined, { timeout: 90_000 });
    const save = screen.getByRole('button', { name: 'Save as draft' });
    await pickOption(user, screen.getByRole('combobox', { name: /^Building/ }), 'bld-1');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Category/ }), 'cat-lift');
    await user.click(screen.getByRole('textbox', { name: /^Reason \(Arabic\)/ }));
    await user.paste('صيانة');
    await user.click(screen.getByRole('textbox', { name: /^Reason \(English\)/ }));
    await user.paste('Upkeep');

    // An amount that is not a number, or zero, is marked and cannot be saved.
    const amount = screen.getByRole('textbox', { name: /^Amount before VAT/ });
    await user.click(amount);
    await user.paste('abc');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(save).toHaveProperty('disabled', true);
    await user.clear(amount);
    await user.paste('0');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    await user.clear(amount);
    await user.paste('500');
    expect(save).toHaveProperty('disabled', false);
    await vi.waitFor(() => {
      expect(api.to('POST', '/api/staff/expenses/warnings').length).toBeGreaterThan(0);
    });
    // Without a vendor or invoice number the check is sent with neither.
    expect(api.last('POST', '/api/staff/expenses/warnings').body).toMatchObject({
      vendorId: null,
      invoiceNo: null,
    });
    expect(screen.queryByRole('status')).toBeNull();

    // A VAT that is not a number blocks saving.
    const vat = screen.getByRole('textbox', { name: /^VAT \(AED\)/ });
    await user.clear(vat);
    await user.paste('x');
    expect(save).toHaveProperty('disabled', true);
    await user.clear(vat);
    expect(save).toHaveProperty('disabled', false);

    // A covered period that ends before it starts is refused.
    await user.type(screen.getByRole('textbox', { name: 'Covers from' }), '10/10/2026{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'Covers to' }), '01/10/2026{Enter}');
    expect(save).toHaveProperty('disabled', true);
    const to = screen.getByRole('textbox', { name: 'Covers to' });
    await user.clear(to);
    await user.type(to, '31/10/2026{Enter}');
    expect(save).toHaveProperty('disabled', false);

    // Picking one unit without choosing it asks for nothing to be previewed, and blocks saving.
    const before = api.to('POST', '/api/staff/expenses/preview-allocation').length;
    await user.click(screen.getByRole('radio', { name: 'One unit' }));
    expect(save).toHaveProperty('disabled', true);
    await new Promise((r) => setTimeout(r, 600));
    expect(
      api
        .to('POST', '/api/staff/expenses/preview-allocation')
        .slice(before)
        .some((c) => (c.body as { scope: string }).scope === 'unit'),
    ).toBe(false);
    await user.click(screen.getByRole('radio', { name: 'Whole building' }));

    await user.selectOptions(
      screen.getByRole('combobox', { name: /^Split between owners/ }),
      'by_ownership',
    );
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/expenses/preview-allocation').body).toMatchObject({
        scope: 'building',
        unitId: null,
        allocationMethod: 'by_ownership',
      });
    });
    await user.selectOptions(screen.getByRole('combobox', { name: /^Payment method/ }), 'transfer');
    await user.type(screen.getByRole('textbox', { name: 'Paid on' }), '05/11/2026{Enter}');

    await user.click(save);
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/expenses').body).toMatchObject({
        scope: 'building',
        unitId: null,
        vendorId: null,
        invoiceNo: null,
        vatFils: 0,
        coversFrom: '2026-10-10',
        coversTo: '2026-10-31',
        paidOn: '2026-11-05',
        paymentMethod: 'transfer',
        allocationMethod: 'by_ownership',
        visibleToOwner: true,
      });
    });
  });
});
