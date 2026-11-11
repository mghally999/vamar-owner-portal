// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { addDays, todayInDubai } from '@vamar/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renewalMessages, type RenewalMessageKey } from '@/lib/renewal-messages';
import type { RenewalSuggestion } from '@/lib/renewal-queries';
import { contractDetail, contractRow } from '@/test/fixtures';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const comparable = (unitNo: string, startDate: string, rent: number, size: number) => ({
  contractId: `con-${unitNo}`,
  unitId: `unit-${unitNo}`,
  unitNo,
  buildingId: 'bld-1',
  buildingNameAr: 'برج النور',
  buildingNameEn: 'Al Noor Tower',
  sizeSqft: size,
  startDate: startDate as RenewalSuggestion['endDate'],
  annualRentFils: rent,
  filsPerSqft: Math.round(rent / size),
});

function dubai(over: Partial<RenewalSuggestion> = {}): RenewalSuggestion {
  return {
    contractId: 'con-1',
    today: '2026-11-11',
    endDate: '2026-12-31',
    dueInDays: 50,
    due: true,
    windowDays: 90,
    currentRentFils: 6_000_000,
    unit: { id: 'unit-801', unitNo: '801', type: 'apartment', bedrooms: 1, sizeSqft: 1000 },
    building: {
      id: 'bld-1',
      nameAr: 'برج النور',
      nameEn: 'Al Noor Tower',
      area: 'Business Bay, Dubai',
    },
    emirate: 'dubai',
    market: {
      status: 'ok',
      scope: 'building',
      comparables: [
        comparable('1205', '2026-07-01', 8_500_000, 1000),
        comparable('2001', '2026-04-01', 8_000_000, 1000),
        comparable('1501', '2026-02-01', 7_500_000, 1000),
      ],
      medianFilsPerSqft: 8000,
      minFilsPerSqft: 7500,
      maxFilsPerSqft: 8500,
      referenceRentFils: 8_000_000,
      minComparables: 3,
      startedAfter: '2025-11-11',
    },
    cap: { kind: 'dubai', belowReferenceBp: 2500, increasePct: 10, maxRentFils: 6_600_000 },
    suggestedRentFils: 6_600_000,
    renewal: null,
    ...over,
  };
}

function sharjahThin(): RenewalSuggestion {
  return dubai({
    building: {
      id: 'bld-3',
      nameAr: 'مجمع الخان',
      nameEn: 'Al Khan Residence',
      area: 'Al Khan, Sharjah',
    },
    emirate: 'sharjah',
    market: {
      status: 'not_enough_data',
      scope: 'emirate',
      comparables: [comparable('102', '2026-06-01', 4_000_000, 1100)],
      minComparables: 3,
      startedAfter: '2025-11-11',
    },
    cap: { kind: 'check_emirate_rules' },
    suggestedRentFils: 6_000_000,
  });
}

const routes = (s: RenewalSuggestion) => ({
  'GET /api/staff/contracts/con-1': contractDetail(),
  'GET /api/staff/contracts/con-1/renewal-suggestion': s,
  'GET /api/staff/contracts/con-2': contractDetail({ id: 'con-2', status: 'draft' }),
  'POST /api/staff/contracts/con-1/renew': contractDetail({ id: 'con-2', status: 'draft' }),
});

const card = async (name: string) =>
  (await screen.findByRole('heading', { name })).closest('section')!;

describe('renewal suggestion card', () => {
  it('shows the reference, its comparables and the Dubai cap in English, axe-clean', async () => {
    await renderApp('/contracts/con-1', { routes: routes(dubai()) });
    const c = await card('Renewal suggestion');
    expect(within(c).getByText('Renewal due in 50 days')).toBeTruthy();
    expect(
      within(c).getByText('Based on Vamar’s recent contracts. Not an official rent index.'),
    ).toBeTruthy();
    expect(within(c).getByText(/same building/)).toBeTruthy();
    expect(within(c).getByText('Median per sq ft a year')).toBeTruthy();
    // Median and range; the per sq ft column repeats the same figures.
    expect(within(c).getAllByText('AED 80').length).toBeGreaterThanOrEqual(2);
    expect(within(c).getAllByText('AED 75').length).toBeGreaterThanOrEqual(2);
    expect(within(c).getByText('Reference for this unit (1000 sq ft)')).toBeTruthy();
    const table = within(c).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Al Noor Tower · 1205')).toBeTruthy();
    expect(within(table).getByText('AED 85,000')).toBeTruthy();
    expect(
      within(c).getByText(
        'The current rent is 25 % below the reference, so the allowed increase is 10 %.',
      ),
    ).toBeTruthy();
    expect(within(c).getAllByText('AED 66,000').length).toBeGreaterThanOrEqual(2);
    expect(within(c).getByRole('link', { name: 'All contracts due for renewal' })).toBeTruthy();
    expect((await axe.run(c)).violations).toEqual([]);
  });

  it('prepares the renewal with the suggested rent, which staff can change', async () => {
    const { api, router, user } = await renderApp('/contracts/con-1', {
      role: 'editor',
      routes: routes(dubai()),
    });
    const c = await card('Renewal suggestion');
    await user.click(within(c).getByRole('button', { name: 'Prepare renewal' }));
    const dialog = await screen.findByRole('dialog');
    expect((await axe.run(dialog)).violations).toEqual([]);
    const input = within(dialog).getByLabelText<HTMLInputElement>(/New annual rent/);
    expect(input.value).toBe('66000');
    await user.clear(input);
    await user.type(input, '70,000');
    expect(within(dialog).getByText('Above the Dubai cap of AED 66,000.')).toBeTruthy();
    await user.clear(input);
    expect(within(dialog).getByRole('button', { name: 'Create draft' })).toHaveProperty(
      'disabled',
      true,
    );
    await user.type(input, '65500');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/contracts/con-2');
    });
    expect(api.last('POST', '/api/staff/contracts/con-1/renew').body).toEqual({
      annualRentFils: 6_550_000,
    });
  });

  it('links to an existing renewal and hides the action from viewers', async () => {
    await renderApp('/contracts/con-1', {
      role: 'viewer',
      routes: routes(dubai({ renewal: { id: 'con-2', status: 'draft' } })),
    });
    const c = await card('Renewal suggestion');
    expect(within(c).getByRole('link', { name: 'Open renewal draft' }).getAttribute('href')).toBe(
      '/contracts/con-2',
    );
    expect(within(c).queryByRole('button', { name: 'Prepare renewal' })).toBeNull();
  });

  it('Arabic, Sharjah and not enough data: no cap, the rules pointer, axe-clean in RTL', async () => {
    await renderApp('/contracts/con-1', { lang: 'ar', routes: routes(sharjahThin()) });
    const c = await card('اقتراح التجديد');
    expect(document.documentElement.dir).toBe('rtl');
    expect(within(c).getByText('التجديد مستحق خلال 50 يوماً')).toBeTruthy();
    expect(
      within(c).getByText('مبني على عقود فامار الأخيرة، وليس مؤشراً رسمياً للإيجارات.'),
    ).toBeTruthy();
    expect(within(c).getByText(/البيانات غير كافية/)).toBeTruthy();
    expect(within(c).getByText('العقود التي وُجدت (1)')).toBeTruthy();
    expect(within(c).getByText('راجع قواعد الإيجار في الإمارة')).toBeTruthy();
    expect(within(c).getByText(/لا يُحسب سقف للزيادة في الشارقة/)).toBeTruthy();
    expect(within(c).queryByText('سقف زيادة الإيجار في دبي')).toBeNull();
    expect((await axe.run(c)).violations).toEqual([]);
  });

  it('Arabic Dubai cap and the Arabic day forms', async () => {
    await renderApp('/contracts/con-1', {
      lang: 'ar',
      routes: routes(dubai({ dueInDays: 7 })),
    });
    const c = await card('اقتراح التجديد');
    expect(within(c).getByText('التجديد مستحق خلال 7 أيام')).toBeTruthy();
    expect(within(c).getByText('سقف زيادة الإيجار في دبي')).toBeTruthy();
    expect(
      within(c).getByText('الإيجار الحالي أقل من المرجع بنسبة 25 %، لذا الزيادة المسموحة 10 %.'),
    ).toBeTruthy();
  });

  it('is not shown for drafts', async () => {
    const { api } = await renderApp('/contracts/con-2', { routes: routes(dubai()) });
    await screen.findByRole('heading', { name: 'Al Noor Tower · 801' });
    expect(screen.queryByRole('heading', { name: 'Renewal suggestion' })).toBeNull();
    expect(api.to('GET', '/api/staff/contracts/con-2/renewal-suggestion')).toHaveLength(0);
  });
});

describe('contracts list reminder', () => {
  it('marks active contracts ending within 90 days, in both languages', async () => {
    const today = todayInDubai();
    const rows = [
      contractRow({ id: 'a', unitNo: '801', endDate: addDays(today, 20) }),
      contractRow({ id: 'b', unitNo: '802', endDate: addDays(today, 120) }),
      contractRow({ id: 'c', unitNo: '803', endDate: addDays(today, 20), status: 'draft' }),
    ];
    const page = { items: rows, nextCursor: null };
    await renderApp('/contracts', {
      routes: { 'GET /api/staff/contracts': page, 'GET /api/staff/buildings': { items: [] } },
    });
    expect(await screen.findAllByText('Renewal due in 20 days')).toHaveLength(1);
    cleanup();
    vi.unstubAllGlobals();
    await renderApp('/contracts', {
      lang: 'ar',
      routes: { 'GET /api/staff/contracts': page, 'GET /api/staff/buildings': { items: [] } },
    });
    expect(await screen.findAllByText('التجديد مستحق خلال 20 يوماً')).toHaveLength(1);
  });
});

describe('renewal messages', () => {
  it('have the same keys and placeholders in Arabic and English, Western digits only', () => {
    const keys = Object.keys(renewalMessages.en) as RenewalMessageKey[];
    expect(Object.keys(renewalMessages.ar).sort()).toEqual([...keys].sort());
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) {
      expect(renewalMessages.ar[k].trim(), k).not.toBe('');
      expect(ph(renewalMessages.ar[k]), k).toEqual(ph(renewalMessages.en[k]));
      expect(renewalMessages.ar[k], k).not.toMatch(/[٠-٩۰-۹]/);
    }
  });
});
