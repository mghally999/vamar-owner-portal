// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, buildingDetail } from '@/test/fixtures';
import { rule, v2Routes } from '@/test/fixtures-v2';
import { renderApp, pickOption } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/buildings/:id': buildingDetail(),
    'GET /api/staff/recurring-rules': {
      items: [
        rule(),
        rule({
          id: 'rule-2',
          reasonEn: 'Old lift contract',
          active: false,
          frequency: 'quarterly',
          dayOfMonth: 1,
        }),
      ],
    },
    ...extra,
  });

describe('ExpenseRulesPage', () => {
  it('lists the rules with the next due date, pauses and resumes', async () => {
    const { api, user } = await renderApp('/expenses/rules', {
      role: 'editor',
      routes: routes({ 'PATCH /api/staff/recurring-rules/:id': rule({ active: false }) }),
    });
    expect(await screen.findByText('Guard salaries')).toBeTruthy();
    expect(screen.getByText('Monthly · 25')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    // The paused rule's status, besides the "Paused" filter checkbox.
    expect(screen.getByRole('checkbox', { name: 'Paused' })).toBeTruthy();
    expect(screen.getAllByText('Paused')).toHaveLength(2);
    expect(screen.getAllByText('AED 6,500')).toHaveLength(2); // both test rules cost the same
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/recurring-rules/rule-1').body).toEqual({
        active: false,
      });
    });
    expect(await screen.findByText('Rule saved.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/recurring-rules/rule-2').body).toEqual({ active: true });
    });
    await user.click(screen.getByRole('checkbox', { name: 'Paused' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/recurring-rules').query['includeInactive']).toBe('1');
    });
  });

  it('creates a rule from the dialog with VAT from the vendor, and edits one', async () => {
    const { api, user } = await renderApp('/expenses/rules', {
      role: 'editor',
      routes: routes({
        'POST /api/staff/recurring-rules': rule({ id: 'rule-3' }),
        'PATCH /api/staff/recurring-rules/:id': rule(),
      }),
    });
    await screen.findByText('Guard salaries');
    await user.click(screen.getByRole('button', { name: 'New rule' }));
    const dialog = await screen.findByRole('dialog');
    await pickOption(user, within(dialog).getByRole('combobox', { name: /^Building/ }), 'bld-1');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Category/ }),
      'cat-dewa',
    );
    expect(within(dialog).queryByRole('option', { name: 'Lifts (repairs)' })).toBeNull();
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Vendor/ }),
      'ven-lifts',
    );
    await user.type(within(dialog).getByRole('textbox', { name: /^Reason \(Arabic\)/ }), 'ديوا');
    await user.type(within(dialog).getByRole('textbox', { name: /^Reason \(English\)/ }), 'DEWA');
    await user.type(within(dialog).getByRole('textbox', { name: /^Amount before VAT/ }), '1,850');
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: /^VAT/ }).value).toBe(
      '92.50',
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Frequency/ }),
      'quarterly',
    );
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Day of month/ }), '15');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/recurring-rules').body).toMatchObject({
        buildingId: 'bld-1',
        categoryId: 'cat-dewa',
        vendorId: 'ven-lifts',
        amountFils: 185_000,
        vatFils: 9_250,
        frequency: 'quarterly',
        dayOfMonth: 15,
      });
    });
    expect(await screen.findByText('Rule saved.')).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const edit = await screen.findByRole('dialog');
    await user.selectOptions(within(edit).getByRole('combobox', { name: /^Applies to/ }), 'unit');
    await user.selectOptions(
      await within(edit).findByRole('combobox', { name: /^Unit/ }),
      'unit-801',
    );
    await user.click(within(edit).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/recurring-rules/rule-1').body).toMatchObject({
        scope: 'unit',
        unitId: 'unit-801',
        allocationMethod: 'single_unit',
      });
    });
  });

  it('shows the API error in the dialog, hides buttons from viewers, and the empty and error states', async () => {
    const { user } = await renderApp('/expenses/rules', {
      role: 'editor',
      routes: routes({
        'POST /api/staff/recurring-rules': apiError(422, 'validation', 'Rules are for fixed costs'),
      }),
    });
    await screen.findByText('Guard salaries');
    await user.click(screen.getByRole('button', { name: 'New rule' }));
    const dialog = await screen.findByRole('dialog');
    await pickOption(user, within(dialog).getByRole('combobox', { name: /^Building/ }), 'bld-1');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Category/ }),
      'cat-sal',
    );
    await user.type(within(dialog).getByRole('textbox', { name: /^Reason \(Arabic\)/ }), 'x');
    await user.type(within(dialog).getByRole('textbox', { name: /^Reason \(English\)/ }), 'x');
    await user.type(within(dialog).getByRole('textbox', { name: /^Amount before VAT/ }), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    cleanup();
    await renderApp('/expenses/rules', {
      role: 'viewer',
      routes: routes({ 'GET /api/staff/recurring-rules': { items: [] } }),
    });
    expect(await screen.findByText(/No recurring rules yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New rule' })).toBeNull();
    cleanup();
    await renderApp('/expenses/rules', {
      routes: routes({ 'GET /api/staff/recurring-rules': apiError(500, 'internal') }),
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(vi.isMockFunction(fetch)).toBe(true);
    expect(
      ((c: ApiCall) => c.path)({
        method: 'GET',
        path: '/x',
        query: {},
        body: null,
        headers: new Headers(),
      }),
    ).toBe('/x');
  });

  it('edits a unit rule back to the building with a chosen split, own VAT and no owner visibility', async () => {
    let refuse: 'api' | 'network' | null = null;
    const unitRule = rule({
      id: 'rule-9',
      scope: 'unit',
      unitId: 'unit-801',
      unitNo: '801',
      vendorId: 'ven-lifts',
      vendorName: 'Gulf Lifts Technical Services',
      allocationMethod: 'single_unit',
    });
    const { api, user } = await renderApp('/expenses/rules', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/recurring-rules': { items: [unitRule] },
        'PATCH /api/staff/recurring-rules/:id': (c: ApiCall) => {
          if (refuse === 'api') return apiError(409, 'conflict', 'The rule is in use');
          if (refuse === 'network') throw new TypeError('Failed to fetch');
          return rule({ id: 'rule-9', ...(c.body as object) });
        },
      }),
    });
    expect(await screen.findByText('Al Noor Tower · 801')).toBeTruthy();
    expect(screen.getByText('Gulf Lifts Technical Services')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    let dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Applies to/ }),
      'building',
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Split between owners/ }),
      'by_ownership',
    );
    const vat = within(dialog).getByRole('textbox', { name: /^VAT/ });
    await user.clear(vat);
    await user.type(vat, 'abc');
    expect(vat.getAttribute('aria-invalid')).toBe('true');
    await user.clear(vat);
    await user.type(vat, '0');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Visible to owners' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Ends' }), '31/12/2027{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/recurring-rules/rule-9').body).toMatchObject({
        scope: 'building',
        unitId: null,
        allocationMethod: 'by_ownership',
        vatFils: 0,
        visibleToOwner: false,
        endDate: '2027-12-31',
      });
    });
    expect(await screen.findByText('Rule saved.')).toBeTruthy();

    // A save without an answer shows the generic message; Escape closes the dialog.
    refuse = 'network';
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // A refused pause says why.
    refuse = 'api';
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('The rule is in use')).toBeTruthy();
  });

  it('retries a failed list', async () => {
    const { api, user } = await renderApp('/expenses/rules', {
      routes: routes({ 'GET /api/staff/recurring-rules': apiError(500, 'internal') }),
    });
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/recurring-rules').length).toBeGreaterThan(1);
    });
  });
});
