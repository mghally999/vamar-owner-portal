// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { todayInDubai } from '@vamar/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { buildingDetail, owner, page, unit } from '@/test/fixtures';
import { at, renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TWO_OWNERS = buildingDetail({
  units: [
    unit({
      owners: [
        { ownerId: 'own-1', nameAr: 'أحمد', nameEn: 'Ahmed Al Mansouri', shareBp: 6000 },
        { ownerId: 'own-2', nameAr: 'فاطمة', nameEn: 'Fatima Al Zarooni', shareBp: 4000 },
      ],
    }),
  ],
});

const OWNER_PAGES = {
  'GET /api/staff/owners': (c: ApiCall) =>
    c.query['cursor'] === 'p2'
      ? page([owner({ id: 'own-3', nameEn: 'Rashid Obaid', phoneE164: '+971503334444' })])
      : page(
          [
            owner(),
            owner({ id: 'own-2', nameEn: 'Fatima Al Zarooni', phoneE164: '+971502223333' }),
          ],
          'p2',
        ),
};

describe('BuildingDetailPage', () => {
  it('lists units with owners, tenants, status and rent', async () => {
    await renderApp('/buildings/bld-1', {
      routes: { 'GET /api/staff/buildings/bld-1': buildingDetail() },
    });
    expect(await screen.findByRole('heading', { name: 'Al Noor Tower' })).toBeTruthy();
    expect(screen.getByText('برج النور · Business Bay · Marasi Drive')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    const [, first, second] = rows;
    if (!first || !second) throw new Error('expected two unit rows');
    expect(within(first).getByText('801')).toBeTruthy();
    expect(within(first).getByText('· 2 BR')).toBeTruthy();
    expect(within(first).getByRole('link', { name: 'Ahmed Al Mansouri' })).toBeTruthy();
    expect(
      within(first)
        .getByRole('link', { name: /Sara Khan/ })
        .getAttribute('href'),
    ).toBe('/contracts/con-1');
    expect(within(first).getByText('Occupied')).toBeTruthy();
    expect(within(first).getByText('AED 95,000')).toBeTruthy();
    expect(within(second).getByText('No owner assigned')).toBeTruthy();
    expect(within(second).getByText('Vacant, ready')).toBeTruthy();
    expect(within(first).getByText('Occupied')).toBeTruthy();
    expect(within(first).getByRole('link', { name: '801' }).getAttribute('href')).toBe(
      '/units/unit-801',
    );
  });

  it('shows shares when a unit has several owners, in Arabic too', async () => {
    await renderApp('/buildings/bld-1', {
      lang: 'ar',
      routes: { 'GET /api/staff/buildings/bld-1': TWO_OWNERS },
    });
    const ahmed = await screen.findByRole('link', { name: /أحمد/ });
    expect(ahmed.textContent).toBe('أحمد 60%');
    expect(screen.getByRole('link', { name: /فاطمة/ }).textContent).toBe('فاطمة 40%');
    expect(screen.getByText('شقة')).toBeTruthy();
  });

  it('adds a unit with the typed values', async () => {
    const { api, user } = await renderApp('/buildings/bld-1', {
      role: 'editor',
      routes: {
        'GET /api/staff/buildings/bld-1': buildingDetail({ units: [] }),
        'POST /api/staff/units': { id: 'unit-new' },
      },
    });
    expect(await screen.findByText('No units in this building yet.')).toBeTruthy();
    await user.click(at(screen.getAllByRole('button', { name: 'Add unit' }), 1));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Unit no\./), '1203');
    await user.selectOptions(within(dialog).getByLabelText(/Type/), 'villa');
    await user.type(within(dialog).getByLabelText(/Bedrooms/), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.last('POST', '/api/staff/units').body).toEqual({
      unitNo: '1203',
      type: 'villa',
      bedrooms: 3,
      sizeSqft: null,
      buildingId: 'bld-1',
    });
  });

  it('reports a duplicate unit number', async () => {
    const { user } = await renderApp('/buildings/bld-1', {
      routes: {
        'GET /api/staff/buildings/bld-1': buildingDetail(),
        'POST /api/staff/units': apiError(409, 'conflict'),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Add unit' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Unit no\./), '801');
    await user.type(within(dialog).getByLabelText(/Size/), '900');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(
      await within(dialog).findByText('This change conflicts with existing data.'),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('splits a unit between two owners and saves shares that add up to 100%', async () => {
    const { api, user } = await renderApp('/buildings/bld-1', {
      routes: {
        'GET /api/staff/buildings/bld-1': buildingDetail(),
        ...OWNER_PAGES,
        'PUT /api/staff/units/:id/owners': { ok: true },
      },
    });
    await user.click(at(await screen.findAllByRole('button', { name: 'Assign owners' }), 0));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Total 100%')).toBeTruthy();

    // Every page of owners is loaded for the picker.
    expect(await within(dialog).findByRole('option', { name: /Rashid Obaid/ })).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Add owner' }));
    const owners = within(dialog).getAllByLabelText('Owner');
    const percents = within(dialog).getAllByLabelText('Share %');
    // An owner already chosen in another row cannot be picked twice.
    const taken = within(at(owners, 1)).getByRole('option', { name: /\+971501234567/ });
    expect(taken).toHaveProperty('disabled', true);

    await user.selectOptions(at(owners, 1), 'own-2');
    await user.type(at(percents, 1), '40');
    expect(
      within(dialog).getByText('Shares add up to 140%. They must be exactly 100%.'),
    ).toBeTruthy();
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);

    await user.clear(at(percents, 0));
    await user.type(at(percents, 0), '60');
    expect(within(dialog).getByText('Total 100%')).toBeTruthy();
    const from = within(dialog).getByLabelText('Effective from');
    expect(from).toHaveProperty('value', todayInDubai());
    await user.clear(from);
    await user.type(from, '2026-11-01');
    await user.click(save);

    expect(await screen.findByText('Owners updated.')).toBeTruthy();
    expect(api.last('PUT', '/api/staff/units/unit-801/owners').body).toEqual({
      fromDate: '2026-11-01',
      owners: [
        { ownerId: 'own-1', shareBp: 6000 },
        { ownerId: 'own-2', shareBp: 4000 },
      ],
    });
  });

  it('removes a row and shows the API refusal of invalid shares', async () => {
    const { user } = await renderApp('/buildings/bld-1', {
      routes: {
        'GET /api/staff/buildings/bld-1': TWO_OWNERS,
        ...OWNER_PAGES,
        'PUT /api/staff/units/:id/owners': apiError(422, 'shares_invalid'),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Assign owners' }));
    const dialog = await screen.findByRole('dialog');
    const remove = within(dialog).getAllByRole('button', { name: 'Remove' });
    await user.click(at(remove, 1));
    expect(within(dialog).getByText('Total 60%')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toHaveProperty('disabled', true);
    const percent = within(dialog).getByLabelText('Share %');
    await user.clear(percent);
    await user.type(percent, '100');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('Shares add up to 100%. They must be exactly 100%.'),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('hides editing from viewers and shows the error state', async () => {
    await renderApp('/buildings/bld-1', {
      role: 'viewer',
      routes: { 'GET /api/staff/buildings/bld-1': buildingDetail({ units: [] }) },
    });
    expect(await screen.findByText('No units in this building yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add unit' })).toBeNull();
    cleanup();
    await renderApp('/buildings/gone', {
      routes: { 'GET /api/staff/buildings/gone': apiError(500, 'internal') },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
