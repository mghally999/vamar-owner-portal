// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, chequeRow, owner, page } from '@/test/fixtures';
import { bucket, reportSummary, settings, v2Routes } from '@/test/fixtures-v2';
import { renderApp, pickOption } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/owners': page([owner()]),
    'GET /api/staff/reports/summary': reportSummary(),
    'GET /api/staff/cheques': page([chequeRow({ status: 'bounced' })]),
    ...extra,
  });

describe('ReportsPage', () => {
  it('shows the building P&L by month, switches reports, and filters by building', async () => {
    const { api, user } = await renderApp('/reports?preset=last_3_months', { routes: routes() });
    expect(await screen.findByRole('heading', { name: /Building P&L/ })).toBeTruthy();
    expect(
      screen.getByRole('rowheader', { name: 'October 2026' }) || screen.getByText('October 2026'),
    ).toBeTruthy();
    expect(screen.getAllByText('AED 22,000').length).toBeGreaterThan(0); // monthly net
    expect(screen.getByText('44,000')).toBeTruthy(); // net card
    expect(api.last('GET', '/api/staff/reports/summary').query).toEqual({
      preset: 'last_3_months',
    });

    await pickOption(user, screen.getByRole('combobox', { name: 'Building' }), 'bld-1');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/reports/summary').query['buildingId']).toBe('bld-1');
    });
    await user.click(screen.getByRole('tab', { name: 'Expenses by category' }));
    expect(await screen.findByText('Building staff salaries')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Rent collection rate' }));
    // The total and each month show their collection rate.
    expect((await screen.findAllByText('75%')).length).toBeGreaterThan(1);
    await user.click(screen.getByRole('tab', { name: 'Occupancy over time' }));
    expect(await screen.findByText(/30 \/ 40/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Outstanding and bounced' }));
    expect(await screen.findByText('Sara Khan')).toBeTruthy();
    expect(api.last('GET', '/api/staff/cheques').query).toMatchObject({
      from: '2026-09-01',
      status: 'upcoming,deposited,bounced',
    });
  });

  it('the owner statement asks for an owner first, then sends the owner id', async () => {
    const { api, user } = await renderApp('/reports', { routes: routes() });
    await screen.findByRole('heading', { name: /Building P&L/ });
    await user.click(screen.getByRole('tab', { name: 'Owner statement' }));
    expect(await screen.findByText('Choose an owner to see their statement.')).toBeTruthy();
    const picker = screen.getByRole('combobox', { name: 'Owner' });
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: /Ahmed Al Mansouri/ }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/reports/summary').query['ownerId']).toBe('own-1');
    });
    expect(
      await screen.findByRole('heading', { name: /Owner statement · Ahmed Al Mansouri/ }),
    ).toBeTruthy();
  });

  it('exports to Excel and to a print view', async () => {
    const writeFile = vi.fn();
    vi.doMock('xlsx', () => ({
      utils: {
        book_new: () => ({ sheets: [] as string[] }),
        aoa_to_sheet: (rows: unknown[][]) => rows,
        book_append_sheet: (wb: { sheets: string[] }, _ws: unknown, name: string) => {
          wb.sheets.push(name);
        },
      },
      writeFile,
    }));
    const listeners: Record<string, () => void> = {};
    const win = {
      addEventListener: vi.fn((n: string, fn: () => void) => {
        listeners[n] = fn;
      }),
      focus: vi.fn(),
      print: vi.fn(),
    };
    const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    // Only the blob helpers are stubbed: the router still needs the real URL class.
    const urlStatics = URL as unknown as Record<string, unknown>;
    urlStatics['createObjectURL'] = vi.fn(() => 'blob:r');
    urlStatics['revokeObjectURL'] = vi.fn();
    const { user } = await renderApp('/reports?preset=last_3_months', { routes: routes() });
    await screen.findByRole('heading', { name: /Building P&L/ });
    await user.click(screen.getByRole('button', { name: 'Export to Excel' }));
    await vi.waitFor(() => {
      expect(writeFile).toHaveBeenCalledWith(
        { sheets: ['Building P&L', 'Expenses by category'] },
        'vamar-buildingPnl-2026-09-01-2026-10-31.xlsx',
      );
    });
    await user.click(screen.getByRole('button', { name: 'Export to PDF' }));
    expect(open).toHaveBeenCalledTimes(1);
    listeners['load']?.();
    expect(win.print).toHaveBeenCalledTimes(1);
    vi.doUnmock('xlsx');
  });

  it('shows the error state and a blocked popup', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await renderApp('/reports', {
      routes: routes({
        'GET /api/staff/reports/summary': (c: ApiCall) =>
          c.query['buildingId']
            ? apiError(500, 'internal')
            : reportSummary({
                comparison: { from: '2026-07-01', to: '2026-08-31' },
                previous: {
                  rent: reportSummary().rent,
                  expenses: reportSummary().expenses,
                  netFils: 1,
                },
              }),
      }),
    });
    await screen.findByRole('heading', { name: /Building P&L/ });
    await user.click(screen.getByRole('button', { name: 'Export to PDF' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    await pickOption(user, screen.getByRole('combobox', { name: 'Building' }), 'bld-1');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(within(document.body).queryByText('Choose an owner to see their statement.')).toBeNull();
  });

  it('retries, then shows a single month with nothing booked, empty units, and pages and exports the outstanding cheques', async () => {
    const writeFile = vi.fn();
    const sheets: unknown[][][] = [];
    vi.doMock('xlsx', () => ({
      utils: {
        book_new: () => ({}),
        aoa_to_sheet: (rows: unknown[][]) => {
          sheets.push(rows);
          return rows;
        },
        book_append_sheet: vi.fn(),
      },
      writeFile,
    }));
    let summaryCalls = 0;
    const { api, user } = await renderApp('/reports?preset=this_month', {
      routes: routes({
        'GET /api/staff/settings': settings({ showBeforeFeeLabel: false }),
        'GET /api/staff/reports/summary': () => {
          summaryCalls += 1;
          if (summaryCalls === 1) return apiError(500, 'internal');
          return reportSummary({
            buckets: [bucket('2026-11', { occupiedUnits: 0, totalUnits: 0 })],
            byCategory: [],
          });
        },
        'GET /api/staff/cheques': (c: ApiCall) =>
          c.query['cursor']
            ? page([chequeRow({ id: 'chq-p2', tenantName: 'Second Page' })])
            : page(
                [
                  chequeRow({
                    id: 'chq-blank',
                    chequeNo: null,
                    amountFils: null,
                    tenantName: 'No Amount Yet',
                  }),
                ],
                'cur-2',
              ),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: /Building P&L/ })).toBeTruthy();
    // The fee label is turned off in settings; a single month draws no chart.
    expect(screen.queryByText("Before Vamar's management fee")).toBeNull();
    expect(screen.queryByText('Rent and expenses by month')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Expenses by category' }));
    expect(await screen.findByText('Nothing in this period.')).toBeTruthy();
    // A month with no units shows 0% occupied instead of dividing by zero.
    await user.click(screen.getByRole('tab', { name: 'Occupancy over time' }));
    expect((await screen.findAllByText('0%')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: 'Outstanding and bounced' }));
    const row = (await screen.findByText('No Amount Yet')).closest('tr');
    expect(row && within(row).getAllByText('—').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second Page')).toBeTruthy();
    expect(api.last('GET', '/api/staff/cheques').query['cursor']).toBe('cur-2');

    await user.click(screen.getByRole('button', { name: 'Export to Excel' }));
    await vi.waitFor(() => {
      expect(writeFile).toHaveBeenCalledTimes(1);
    });
    // A cheque without a number or amount is exported as blanks, not as zero.
    const blank = sheets[0]?.find((r) => r[3] === 'No Amount Yet');
    expect(blank?.[4]).toBe('');
    expect(blank?.[5]).toBeNull();
    vi.doUnmock('xlsx');
  });
});
