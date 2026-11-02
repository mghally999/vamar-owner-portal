// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function workbook(name: string, sheets: Record<string, Record<string, unknown>[]>): File {
  const wb = XLSX.utils.book_new();
  for (const [sheet, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet);
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], name);
}

const OWNERS_FILE = () =>
  workbook('owners.xlsx', {
    Owners: [
      {
        nameAr: 'سالم الكعبي',
        nameEn: 'Salem Al Kaabi',
        phoneE164: '050 123 4567',
        email: 'salem@example.ae',
        preferredLang: 'English',
      },
      { nameAr: 'نورة', nameEn: 'Noura', phoneE164: '12345', email: '', preferredLang: 'ar' },
    ],
    Tenants: [{ name: 'Bright Trading', phone: '0551112222', company: 'Bright LLC' }],
  });

async function upload(
  user: Awaited<ReturnType<typeof renderApp>>['user'],
  container: HTMLElement,
  file: File,
) {
  const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  await user.upload(input, file);
}

describe('ImportPage', () => {
  it('maps columns, validates rows and commits the valid ones', async () => {
    const { api, user, container } = await renderApp('/import', {
      routes: {
        'POST /api/staff/import/commit': {
          rowsOk: 1,
          rowsFailed: 0,
          results: [{ row: 2, ok: true, note: 'Existing owner updated' }],
        },
      },
    });
    expect(await screen.findByText('No file chosen')).toBeTruthy();
    expect(screen.getByLabelText(/^Sheet/)).toHaveProperty('disabled', true);
    expect(screen.getByRole('link', { name: 'Download the template' }).getAttribute('href')).toBe(
      '/vamar-import-template.xlsx',
    );

    await upload(user, container, OWNERS_FILE());
    expect(await screen.findByText('owners.xlsx')).toBeTruthy();
    expect(screen.getByLabelText(/^Sheet/)).toHaveProperty('value', 'Owners');
    // Nothing is mapped yet, so every row fails validation.
    expect(screen.getByText('0 rows ready')).toBeTruthy();
    expect(screen.getByText('2 rows with errors')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import 0 rows' })).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: 'Map columns' }));
    expect(screen.getByLabelText(/^Name \(Arabic\)/)).toHaveProperty('value', 'nameAr');
    expect(screen.getByLabelText(/^Phone/)).toHaveProperty('value', 'phoneE164');
    expect(screen.getByText('1 rows ready')).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('+971501234567')).toBeTruthy();
    expect(within(table).getByText('en')).toBeTruthy();
    expect(within(table).getByText(/phoneE164: /)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Import 1 rows' }));
    expect(await screen.findByText('Imported 1 rows. 0 failed.')).toBeTruthy();
    expect(screen.getByText('Existing owner updated')).toBeTruthy();
    const body = api.last('POST', '/api/staff/import/commit').body as Record<string, unknown>;
    expect(body).toMatchObject({
      target: 'owners',
      fileName: 'owners.xlsx',
      rows: [
        {
          row: 2,
          data: {
            nameAr: 'سالم الكعبي',
            nameEn: 'Salem Al Kaabi',
            phoneE164: '+971501234567',
            email: 'salem@example.ae',
            preferredLang: 'en',
          },
        },
      ],
    });
    // The same file, target, sheet and batch always get the same key.
    expect(body['idempotencyKey']).toMatch(/^[0-9a-f]{16}:owners:Owners:0$/);
    expect(screen.getByRole('button', { name: 'Import 1 rows' })).toHaveProperty('disabled', true);
  });

  it('switches sheet and target, and maps a column by hand', async () => {
    const { user, container } = await renderApp('/import', { lang: 'ar' });
    await upload(user, container, OWNERS_FILE());
    await screen.findByText('owners.xlsx');
    await user.selectOptions(screen.getByLabelText(/^الورقة/), 'Tenants');
    await user.selectOptions(screen.getByLabelText(/^ما الذي تحتويه/), 'tenants');
    expect(screen.getByRole('columnheader', { name: 'الشركة' })).toBeTruthy();
    expect(screen.getByLabelText(/^الشركة/)).toHaveProperty('value', 'company');
    await user.selectOptions(screen.getByLabelText(/^الشركة/), '');
    expect(within(screen.getByRole('table')).queryByText('Bright LLC')).toBeNull();
    expect(within(screen.getByRole('table')).getByText('+971551112222')).toBeTruthy();
  });

  it('shows the progress while sending and the earlier result of a repeated import', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const { user, container } = await renderApp('/import', {
      routes: {
        'POST /api/staff/import/commit': () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    await upload(user, container, OWNERS_FILE());
    await user.click(await screen.findByRole('button', { name: 'Map columns' }));
    await user.click(screen.getByRole('button', { name: 'Import 1 rows' }));
    expect(await screen.findByRole('button', { name: 'Importing 0 of 1 rows…' })).toBeTruthy();
    finish({
      rowsOk: 0,
      rowsFailed: 1,
      results: [{ row: 2, ok: false, errors: ['phone already used by another owner'] }],
      alreadyDone: true,
    });
    expect(
      await screen.findByText(
        'This sheet was already imported; showing the earlier result. Imported 0 rows. 1 failed.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('phone already used by another owner')).toBeTruthy();
  });
});
