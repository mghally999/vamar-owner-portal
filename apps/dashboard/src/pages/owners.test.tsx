// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { owner, ownerDetail, page } from '@/test/fixtures';
import { at, renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OWNERS = [
  owner(),
  owner({
    id: 'own-2',
    nameAr: 'فاطمة الزرعوني',
    nameEn: 'Fatima Al Zarooni',
    phoneE164: '+971502223333',
    status: 'invited',
    unitCount: 1,
  }),
];

describe('OwnersPage', () => {
  it('lists owners from the API and filters through the request URL', async () => {
    const { api, user } = await renderApp('/owners', {
      routes: {
        'GET /api/staff/owners': (c: ApiCall) =>
          c.query['search'] === 'fatima' ? page([OWNERS[1]]) : page(OWNERS),
        'GET /api/staff/owners/:id': ownerDetail(),
      },
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'Ahmed Al Mansouri' })).toBeTruthy();
    expect(within(table).getByText('أحمد المنصوري')).toBeTruthy();
    expect(within(table).getByText('Invited')).toBeTruthy();
    expect(api.last('GET', '/api/staff/owners').query).toEqual({ limit: '50' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'active');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/owners').query['status']).toBe('active');
    });

    await user.type(screen.getByRole('textbox', { name: 'Search' }), ' fatima ');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/owners').query).toMatchObject({
        search: 'fatima',
        status: 'active',
      });
    });
    await vi.waitFor(() => {
      expect(screen.queryByText('Ahmed Al Mansouri')).toBeNull();
    });

    // Hovering a row warms the owner's detail page.
    await user.hover(screen.getByRole('link', { name: 'Fatima Al Zarooni' }));
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/owners/own-2')).toHaveLength(1);
    });
  });

  it('loads the next page with the cursor', async () => {
    const { api, user } = await renderApp('/owners', {
      routes: {
        'GET /api/staff/owners': (c: ApiCall) =>
          c.query['cursor'] === 'c2' ? page([OWNERS[1]]) : page([OWNERS[0]], 'c2'),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Fatima Al Zarooni')).toBeTruthy();
    expect(api.last('GET', '/api/staff/owners').query['cursor']).toBe('c2');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('creates an owner with the typed values and shows the notice', async () => {
    const { api, user } = await renderApp('/owners', {
      role: 'editor',
      routes: {
        'GET /api/staff/owners': page([]),
        'POST /api/staff/owners': owner({ id: 'own-new' }),
      },
    });
    expect(
      await screen.findByText('No owners yet. Create the first owner to invite them to the app.'),
    ).toBeTruthy();
    await user.click(at(screen.getAllByRole('button', { name: 'New owner' }), 0));
    const dialog = await screen.findByRole('dialog');

    // Required fields are checked before anything is sent.
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(api.to('POST', '/api/staff/owners')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Name \(Arabic\)/), 'سالم الكعبي');
    await user.type(within(dialog).getByLabelText(/Name \(English\)/), 'Salem Al Kaabi');
    const phone = within(dialog).getByLabelText(/Phone \(sign-in number\)/);
    await user.clear(phone);
    await user.type(phone, '+971504445555');
    await user.type(within(dialog).getByLabelText(/Email/), ' salem@example.ae ');
    await user.selectOptions(within(dialog).getByLabelText(/Preferred language/), 'en');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByText(
        'Owner created. They can now sign in to the app with their phone number.',
      ),
    ).toBeTruthy();
    expect(api.last('POST', '/api/staff/owners').body).toEqual({
      nameAr: 'سالم الكعبي',
      nameEn: 'Salem Al Kaabi',
      phoneE164: '+971504445555',
      email: 'salem@example.ae',
      preferredLang: 'en',
    });
  });

  it('explains a duplicate phone number from the API', async () => {
    const { user } = await renderApp('/owners', {
      routes: {
        'GET /api/staff/owners': page(OWNERS),
        'POST /api/staff/owners': apiError(409, 'conflict'),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'New owner' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name \(Arabic\)/), 'سالم');
    await user.type(within(dialog).getByLabelText(/Name \(English\)/), 'Salem');
    await user.type(within(dialog).getByLabelText(/Phone \(sign-in number\)/), '501234567');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'An owner with this phone number already exists.',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('hides the create button from viewers and shows the error state', async () => {
    await renderApp('/owners', {
      role: 'viewer',
      routes: { 'GET /api/staff/owners': apiError(500, 'internal') },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New owner' })).toBeNull();
  });

  it('says when a search finds nobody', async () => {
    const { user } = await renderApp('/owners', {
      routes: { 'GET /api/staff/owners': page([]) },
    });
    await user.type(await screen.findByRole('textbox', { name: 'Search' }), 'zzz');
    expect(await screen.findByText('No owners match your search.')).toBeTruthy();
  });
});
