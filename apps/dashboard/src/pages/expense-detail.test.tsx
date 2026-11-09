// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, buildingDetail } from '@/test/fixtures';
import { attachment, expenseDetail, expenseRow, v2Routes } from '@/test/fixtures-v2';
import { renderApp, pickOption } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const preview = {
  method: 'by_area',
  items: [
    {
      unitId: 'unit-801',
      unitNo: '801',
      ownerId: 'own-1',
      nameAr: 'خالد',
      nameEn: 'Khalid Al Mansoori',
      shareBp: 10_000,
      amountFils: 651_000,
    },
    {
      unitId: 'unit-802',
      unitNo: '802',
      ownerId: 'own-1',
      nameAr: 'خالد',
      nameEn: 'Khalid Al Mansoori',
      shareBp: 10_000,
      amountFils: 651_000,
    },
  ],
};

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/buildings/:id': buildingDetail(),
    'POST /api/staff/expenses/preview-allocation': preview,
    'POST /api/staff/expenses/warnings': { duplicateInvoice: null, outlier: null },
    ...extra,
  });

describe('ExpenseNewPage', () => {
  it('fills the form, previews the split live, defaults VAT from the vendor TRN, warns, and creates a draft', async () => {
    const { api, router, user } = await renderApp('/expenses/new', {
      role: 'editor',
      routes: routes({
        'POST /api/staff/expenses/warnings': {
          duplicateInvoice: { expenseId: 'exp-9', invoiceDate: '2026-09-01', status: 'posted' },
          outlier: { averageFils: 100_000, count: 5 },
        },
        'POST /api/staff/expenses': (c: ApiCall) => ({
          ...expenseRow({ id: 'exp-new', status: 'draft' }),
          ...(c.body as object),
          warnings: { duplicateInvoice: null, outlier: null },
        }),
        'GET /api/staff/expenses/:id': expenseDetail({
          id: 'exp-new',
          status: 'draft',
          allocations: [],
          attachments: [],
        }),
      }),
    });
    expect(await screen.findByText('New expense')).toBeTruthy();
    expect(
      screen.getByText('Fill in the building, date and amount to see the split.'),
    ).toBeTruthy();
    const building = screen.getByRole('combobox', { name: /^Building/ });
    // The buildings arrive after the form renders: pick one once it is in the list.
    await vi.waitFor(() => {
      expect(building.querySelector('option[value="bld-1"]')).not.toBeNull();
    });
    await pickOption(user, building, 'bld-1');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Category/ }), 'cat-lift');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Vendor/ }), 'ven-lifts');
    await user.type(screen.getByRole('textbox', { name: /^Invoice no\./ }), 'GL-TEST-1');
    await user.type(screen.getByRole('textbox', { name: /^Reason \(Arabic\)/ }), 'إصلاح');
    await user.type(screen.getByRole('textbox', { name: /^Reason \(English\)/ }), 'Lift repair');
    await user.type(screen.getByRole('textbox', { name: /^Amount before VAT/ }), '12,400');
    await vi.waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^VAT \(AED\)/ }).value).toBe(
        '620',
      );
    });
    expect(screen.getByText('AED 13,020')).toBeTruthy();
    // live preview
    expect(await screen.findByText('By area (sq ft) · AED 13,020')).toBeTruthy();
    expect(screen.getAllByText('Khalid Al Mansoori')).toHaveLength(2);
    expect(api.last('POST', '/api/staff/expenses/preview-allocation').body).toMatchObject({
      scope: 'building',
      buildingId: 'bld-1',
      totalFils: 1_302_000,
    });
    // warnings
    expect(
      await screen.findByText(/already has an invoice with this number \(dated 1 Sep 2026\)/),
    ).toBeTruthy();
    expect(screen.getByText(/More than three times the 12-month average/)).toBeTruthy();
    // VAT can be set to zero by hand
    const vat = screen.getByRole('textbox', { name: /^VAT \(AED\)/ });
    await user.clear(vat);
    await user.type(vat, '0');
    expect(screen.getByText('AED 12,400')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Visible to owners' }));

    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/expenses').body).toMatchObject({
        scope: 'building',
        buildingId: 'bld-1',
        categoryId: 'cat-lift',
        vendorId: 'ven-lifts',
        invoiceNo: 'GL-TEST-1',
        reasonEn: 'Lift repair',
        amountFils: 1_240_000,
        vatFils: 0,
        visibleToOwner: false,
      });
    });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/expenses/exp-new');
    });
  });

  it('switches to a unit expense, creates a vendor on the spot and shows the API error', async () => {
    const created = {
      id: 'ven-new',
      name: 'New Vendor',
      phone: null,
      email: null,
      trn: '100000000000003',
      notes: '',
      active: true,
    };
    const vendorList: (typeof created)[] = [];
    const { api, user } = await renderApp('/expenses/new?workOrderId=wo-1', {
      role: 'editor',
      routes: routes({
        'POST /api/staff/vendors': () => {
          vendorList.push(created);
          return created;
        },
        'GET /api/staff/vendors': () => ({ items: vendorList }),
        'POST /api/staff/expenses': apiError(422, 'validation', 'Invalid request'),
      }),
    });
    await screen.findByText('New expense');
    await user.click(screen.getByRole('radio', { name: 'One unit' }));
    await pickOption(user, screen.getByRole('combobox', { name: /^Building/ }), 'bld-1');
    await user.selectOptions(await screen.findByRole('combobox', { name: /^Unit/ }), 'unit-801');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Category/ }), 'cat-ac');
    await user.click(screen.getByRole('button', { name: 'New vendor' }));
    await user.type(screen.getByRole('textbox', { name: /^Vendor name/ }), 'New Vendor');
    await user.type(screen.getByRole('textbox', { name: /^TRN/ }), '100000000000003');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/vendors').body).toMatchObject({
        name: 'New Vendor',
        trn: '100000000000003',
      });
    });
    await user.type(screen.getByRole('textbox', { name: /^Reason \(Arabic\)/ }), 'تكييف');
    await user.type(screen.getByRole('textbox', { name: /^Reason \(English\)/ }), 'AC');
    await user.type(screen.getByRole('textbox', { name: /^Amount before VAT/ }), '3150');
    expect(screen.getByRole('combobox', { name: /^Split between owners/ })).toHaveProperty(
      'disabled',
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(api.last('POST', '/api/staff/expenses').body).toMatchObject({
      scope: 'unit',
      unitId: 'unit-801',
      allocationMethod: 'single_unit',
      workOrderId: 'wo-1',
    });
  });
});

describe('ExpenseDetailPage', () => {
  it('shows a posted expense read-only with shares, files, work order, and lets an admin void with a correction', async () => {
    const { api, router, user } = await renderApp('/expenses/exp-1', {
      routes: routes({
        'GET /api/staff/expenses/:id': expenseDetail(),
        'POST /api/staff/expenses/:id/void': {
          voided: expenseRow({ status: 'void' }),
          correction: { expense: expenseRow({ id: 'exp-fix' }) },
        },
      }),
    });
    expect(await screen.findByRole('heading', { name: 'Lift 2 repair' })).toBeTruthy();
    expect(screen.getByText('Posted')).toBeTruthy();
    expect(screen.getByText('TRN 100456789000003')).toBeTruthy();
    expect(screen.getByText('Omar Saeed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lift 2 out of service' }).getAttribute('href')).toBe(
      '/work-orders/wo-1',
    );
    expect(screen.getAllByRole('link', { name: 'Khalid Al Mansoori' })).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: 'invoice-GL-2026-0417.jpg' }).getAttribute('href'),
    ).toBe('/api/staff/attachments/att-inv');
    expect(screen.queryByRole('button', { name: 'Post' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Void' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByRole('textbox', { name: /Why is it voided/ }),
      'Wrong invoice amount',
    );
    await user.click(within(dialog).getByRole('checkbox', { name: 'Post a corrected copy' }));
    const amount = within(dialog).getByRole('textbox', { name: /^Amount before VAT/ });
    await user.clear(amount);
    await user.type(amount, '9000');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText('Corrected copy: AED 9,620')).toBeTruthy();
    await user.click(within(dialog).getAllByRole('button', { name: 'Void' }).at(-1)!);
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/expenses/exp-1/void').body).toMatchObject({
        reason: 'Wrong invoice amount',
        correction: { amountFils: 900_000, vatFils: 62_000 },
      });
    });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/expenses/exp-fix');
    });
  });

  it('a draft shows the form with save, post and delete, and uploads an invoice', async () => {
    const draft = expenseDetail({
      id: 'exp-2',
      status: 'draft',
      recurringRuleId: 'rule-1',
      allocations: [],
      attachments: [],
      postedByName: null,
      postedAt: null,
    });
    const { api, router, user } = await renderApp('/expenses/exp-2', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/expenses/:id': draft,
        'PATCH /api/staff/expenses/:id': expenseRow({ id: 'exp-2', status: 'draft' }),
        'POST /api/staff/expenses/:id/post': {
          expense: expenseRow({ id: 'exp-2' }),
          allocations: [],
          large: false,
        },
        'POST /api/staff/attachments': attachment({
          id: 'att-new',
          fileName: 'inv.pdf',
          mime: 'application/pdf',
        }),
        'DELETE /api/staff/expenses/:id': { ok: true },
      }),
    });
    expect(await screen.findByText(/Created by the daily job from a recurring rule/)).toBeTruthy();
    const amount = screen.getByRole('textbox', { name: /^Amount before VAT/ });
    expect(amount).toHaveProperty('value', '12400');
    await user.clear(amount);
    await user.type(amount, '12500');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/expenses/exp-2').body).toMatchObject({
        amountFils: 1_250_000,
      });
    });
    expect(await screen.findByText('Expense saved.')).toBeTruthy();

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'inv.pdf', {
      type: 'application/pdf',
    });
    await user.upload(screen.getByLabelText('Upload invoice (image or PDF)'), file);
    await vi.waitFor(() => {
      expect(api.to('POST', '/api/staff/attachments')).toHaveLength(1);
    });

    await user.click(screen.getByRole('button', { name: 'Post' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Post' }));
    await vi.waitFor(() => {
      expect(api.to('POST', '/api/staff/expenses/exp-2/post')).toHaveLength(1);
    });
    expect(await screen.findByText('Expense posted.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Delete draft' }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/expenses');
    });
  });

  it('shows a void expense with its correction and the error state', async () => {
    await renderApp('/expenses/exp-1', {
      routes: routes({
        'GET /api/staff/expenses/:id': expenseDetail({
          status: 'void',
          voidReason: 'Duplicate',
          voidedByName: 'Mariam Haddad',
          correctedBy: { id: 'exp-fix', status: 'posted' },
        }),
      }),
    });
    expect(await screen.findByText('Void')).toBeTruthy();
    expect(screen.getByText('Duplicate')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'exp-fix' })).toBeTruthy();
    cleanup();
    await renderApp('/expenses/exp-1', {
      routes: routes({ 'GET /api/staff/expenses/:id': apiError(500, 'internal') }),
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
