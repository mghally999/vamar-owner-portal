// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import CSV from '@/test/bank-statement.csv?raw';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CANDIDATES = [
  {
    id: 'chq-1',
    chequeNo: '000101',
    bankName: 'Emirates NBD',
    amountFils: 2_375_000,
    dueDate: '2026-10-05',
    status: 'upcoming',
    depositedOn: null,
    unitNo: '801',
    buildingNameAr: 'برج النور',
    buildingNameEn: 'Al Noor Tower',
    tenantName: 'Sara Khan',
  },
  {
    id: 'chq-2',
    chequeNo: '000202',
    bankName: 'ADCB',
    amountFils: 1_500_000,
    dueDate: '2026-10-03',
    status: 'deposited',
    depositedOn: '2026-10-03',
    unitNo: '1204',
    buildingNameAr: 'مارينا هايتس',
    buildingNameEn: 'Marina Heights',
    tenantName: 'Liam Carter',
  },
  {
    id: 'chq-3',
    chequeNo: '000303',
    bankName: 'FAB',
    amountFils: 1_200_000,
    dueDate: '2026-10-01',
    status: 'deposited',
    depositedOn: '2026-10-02',
    unitNo: '305',
    buildingNameAr: 'برج النور',
    buildingNameEn: 'Al Noor Tower',
    tenantName: 'Omar Haddad',
  },
];

const ENBD = {
  bank: 'ENBD',
  dateColumn: 'Txn Date',
  amountColumn: 'Amount',
  chequeNoColumn: 'Cheque No',
  descriptionColumn: 'Description',
  signColumn: 'Dr/Cr',
  debitColumn: null,
};

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/settings/bank-csv-mappings': { items: [] },
    'PUT /api/staff/settings/bank-csv-mappings': (c: ApiCall) => ({ items: [c.body] }),
    'GET /api/staff/cheques/bank-candidates': { items: CANDIDATES },
    'POST /api/staff/cheques/bulk-status': (c: ApiCall) => ({
      updated: (c.body as { ids: string[] }).ids,
      notified: 0,
    }),
    ...extra,
  };
}

async function upload(user: Awaited<ReturnType<typeof renderApp>>['user'], text: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  await user.upload(input, new File([text], 'enbd-october.csv', { type: 'text/csv' }));
}

describe('BankStatementPage', () => {
  it('reads a CSV, maps it once, proposes matches and applies the ticked ones through the bulk endpoint', async () => {
    const { api, user } = await renderApp('/cheques/bank-statement', { routes: routes() });
    expect(await screen.findByRole('heading', { name: 'Bank statement' })).toBeTruthy();
    await upload(user, CSV);
    expect(await screen.findByText('5 rows read from enbd-october.csv')).toBeTruthy();

    await user.type(screen.getByLabelText('Bank name'), 'ENBD');
    await user.selectOptions(screen.getByLabelText(/^Date/), 'Txn Date');
    await user.selectOptions(screen.getByLabelText(/^Amount \(or credit\)/), 'Amount');
    await user.selectOptions(screen.getByLabelText(/^Cheque number/), 'Cheque No');
    await user.selectOptions(screen.getByLabelText(/^Description/), 'Description');
    await user.selectOptions(screen.getByLabelText(/^Debit\/credit indicator/), 'Dr/Cr');
    await user.click(screen.getByRole('button', { name: 'Save mapping and find matches' }));

    expect(api.last('PUT', '/api/staff/settings/bank-csv-mappings').body).toEqual(ENBD);
    expect(
      await screen.findByText('5 statement lines · 2 strong · 1 to review · 0 rows skipped'),
    ).toBeTruthy();
    expect(api.last('GET', '/api/staff/cheques/bank-candidates').query).toEqual({
      from: '2026-08-04',
      to: '2026-10-10',
    });

    // Strong matches start ticked; the weak one waits for a person.
    const strongClear = screen.getByRole('checkbox', { name: 'Row 6' });
    const weak = screen.getByRole('checkbox', { name: 'Row 7' });
    const bounce = screen.getByRole('checkbox', { name: 'Row 8' });
    expect(strongClear).toHaveProperty('checked', true);
    expect(weak).toHaveProperty('checked', false);
    expect(bounce).toHaveProperty('checked', true);
    expect(screen.getByText('Same amount within 3 days, no cheque number')).toBeTruthy();
    expect(screen.getByText('Upcoming: marked deposited first')).toBeTruthy();
    expect(screen.getByText('Lines without a match (2)')).toBeTruthy();
    expect(screen.getByText('Payment out, not a cheque')).toBeTruthy();
    expect(screen.getByText('No cheque with this number or amount')).toBeTruthy();
    expect(api.to('POST', '/api/staff/cheques/bulk-status')).toHaveLength(0);

    await user.click(weak);
    await user.click(screen.getByRole('button', { name: 'Apply 3 selected' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply bank statement' });
    expect(
      within(dialog).getByText(
        '2 cheques will be marked cleared and 1 bounced, each on its statement date.',
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        '1 upcoming cheques will first be marked deposited on the same date.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByLabelText(/Bounce reason/)).toHaveProperty(
      'value',
      'Returned by the bank',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('3 cheques updated from the statement.')).toBeTruthy();
    const note = 'Bank statement ENBD';
    expect(api.to('POST', '/api/staff/cheques/bulk-status').map((c) => c.body)).toEqual([
      { ids: ['chq-1'], status: 'deposited', date: '2026-10-03', note },
      { ids: ['chq-1'], status: 'cleared', date: '2026-10-03', note },
      { ids: ['chq-2'], status: 'cleared', date: '2026-10-04', note },
      {
        ids: ['chq-3'],
        status: 'bounced',
        date: '2026-10-06',
        reason: 'Returned by the bank',
        note,
      },
    ]);
  });

  it('picks the saved mapping that fits, reports missing columns and stops on a refused step', async () => {
    const { api, user } = await renderApp('/cheques/bank-statement', {
      routes: routes({
        'GET /api/staff/settings/bank-csv-mappings': {
          items: [{ ...ENBD, bank: 'ADCB', dateColumn: 'Value Date' }, ENBD],
        },
        'DELETE /api/staff/settings/bank-csv-mappings': { items: [] },
        'POST /api/staff/cheques/bulk-status': apiError(422, 'invalid_transition', 'refused', {
          rejected: [
            {
              id: 'chq-1',
              chequeNo: '000101',
              from: 'cleared',
              code: 'invalid_transition',
              reason: 'Cannot move a cheque from cleared to deposited',
            },
          ],
        }),
      }),
    });
    await screen.findByRole('heading', { name: 'Bank statement' });
    await upload(user, CSV);
    await screen.findByText('5 rows read from enbd-october.csv');
    // ADCB's mapping needs a "Value Date" column this file lacks, so ENBD is chosen.
    expect(screen.getByLabelText(/^Saved bank/)).toHaveProperty('value', 'ENBD');
    expect(screen.getByLabelText('Bank name')).toHaveProperty('value', 'ENBD');

    // Choosing a mapping made for another layout says which columns are missing.
    await user.selectOptions(screen.getByLabelText(/^Saved bank/), 'ADCB');
    await user.click(screen.getByRole('button', { name: 'Save mapping and find matches' }));
    expect(
      await screen.findByText('This file has no column named: Value Date. Check the mapping.'),
    ).toBeTruthy();
    // Unchanged saved mappings are not written again.
    expect(api.to('PUT', '/api/staff/settings/bank-csv-mappings')).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText(/^Saved bank/), 'ENBD');
    await user.click(screen.getByRole('button', { name: 'Save mapping and find matches' }));
    await screen.findByText('5 statement lines · 2 strong · 1 to review · 0 rows skipped');
    await user.click(screen.getByRole('button', { name: 'Apply 2 selected' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(dialog).findByText(
        'Stopped: nothing in this step was changed. Earlier steps were saved.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText('Is Cleared; cannot move to Deposited')).toBeTruthy();
    expect(api.to('POST', '/api/staff/cheques/bulk-status')).toHaveLength(1);
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);

    await user.click(screen.getByRole('button', { name: 'Delete saved mapping' }));
    expect(api.last('DELETE', '/api/staff/settings/bank-csv-mappings').query).toEqual({
      bank: 'ENBD',
    });
  });

  it('says when a file cannot be read, and works in Arabic without axe violations', async () => {
    const { user } = await renderApp('/cheques/bank-statement', { lang: 'ar', routes: routes() });
    expect(await screen.findByRole('heading', { name: 'كشف الحساب البنكي' })).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
    await upload(user, '');
    expect(await screen.findByText('تعذّرت قراءة هذا الملف ككشف حساب CSV.')).toBeTruthy();

    await upload(user, CSV);
    await screen.findByText('تمت قراءة 5 صفاً من enbd-october.csv');
    await user.type(screen.getByLabelText('اسم البنك'), 'ENBD');
    await user.selectOptions(screen.getByLabelText(/^التاريخ/), 'Txn Date');
    await user.selectOptions(screen.getByLabelText(/^المبلغ/), 'Amount');
    await user.selectOptions(screen.getByLabelText(/^رقم الشيك/), 'Cheque No');
    await user.selectOptions(screen.getByLabelText(/^الوصف/), 'Description');
    await user.selectOptions(screen.getByLabelText(/^مؤشر مدين/), 'Dr/Cr');
    await user.click(screen.getByRole('button', { name: 'حفظ الربط والبحث عن المطابقات' }));
    await screen.findByRole('checkbox', { name: 'الصف 6' });
    const main = document.querySelector('main') ?? document.body;
    expect((await axe.run(main)).violations).toEqual([]);
  });
});
