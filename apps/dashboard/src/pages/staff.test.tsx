// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/test/api';
import { staffRow } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { roleLabel } from './staff';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STAFF = [
  staffRow({
    id: 'staff-me',
    name: 'Mariam Haddad',
    email: 'mariam@vamar.ae',
    role: 'admin',
    totpEnabled: true,
    totpRequired: true,
  }),
  staffRow(),
  staffRow({ id: 'stf-3', name: 'Layla Hassan', email: 'layla@vamar.ae', active: false }),
  staffRow({ id: 'stf-4', name: 'Read Only', email: 'viewer@vamar.ae', role: 'viewer' }),
];

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/staff': { items: STAFF },
    'PATCH /api/staff/staff/:id': { ok: true },
    'POST /api/staff/staff/:id/reset-totp': { ok: true },
    'POST /api/staff/staff': { id: 'stf-9' },
    ...extra,
  };
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name, { selector: 'td' }).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe('StaffPage', () => {
  it('lists staff without API-only viewers and protects the signed-in admin', async () => {
    await renderApp('/staff', { routes: routes() });
    await screen.findByText('omar@vamar.ae');
    expect(screen.queryByText('viewer@vamar.ae')).toBeNull();

    const me = rowOf('Mariam Haddad');
    expect(within(me).getByRole('combobox')).toHaveProperty('disabled', true);
    expect(within(me).getByRole('checkbox')).toHaveProperty('disabled', true);
    expect(within(me).getByText('Set up')).toBeTruthy();
    expect(within(me).getByText(/Required/)).toBeTruthy();
    expect(within(me).queryByRole('button', { name: 'Deactivate' })).toBeNull();

    const omar = rowOf('Omar Saeed');
    expect(within(omar).getByText('Not set up')).toBeTruthy();
    expect(within(omar).getByText(/Off \(trial\)/)).toBeTruthy();
    expect(within(omar).getByRole('combobox')).toHaveProperty('value', 'editor');
    expect(within(rowOf('Layla Hassan')).getByText('Deactivated')).toBeTruthy();
  });

  it('changes role, 2-step requirement and active state', async () => {
    const { api, user } = await renderApp('/staff', { routes: routes() });
    await screen.findByText('omar@vamar.ae');
    const omar = rowOf('Omar Saeed');
    await user.selectOptions(
      within(omar).getByRole('combobox', { name: 'Role: Omar Saeed' }),
      'admin',
    );
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/staff/stf-2').body).toEqual({ role: 'admin' });
    });
    await user.click(within(omar).getByRole('checkbox'));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/staff/stf-2').body).toEqual({ totpRequired: true });
    });
    await user.click(within(omar).getByRole('button', { name: 'Deactivate' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/staff/stf-2').body).toEqual({ active: false });
    });
    await user.click(within(rowOf('Layla Hassan')).getByRole('button', { name: 'Activate' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/staff/stf-3').body).toEqual({ active: true });
    });
  });

  it('resets an authenticator after confirmation', async () => {
    const { api, user } = await renderApp('/staff', { routes: routes() });
    await screen.findByText('omar@vamar.ae');
    await user.click(
      within(rowOf('Omar Saeed')).getByRole('button', { name: 'Reset authenticator' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Omar Saeed')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.to('POST', '/api/staff/staff/stf-2/reset-totp')).toHaveLength(1);

    await user.click(
      within(rowOf('Layla Hassan')).getByRole('button', { name: 'Reset authenticator' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.to('POST', '/api/staff/staff/stf-3/reset-totp')).toHaveLength(0);
  });

  it('invites a staff member as data entry or admin', async () => {
    const { api, user } = await renderApp('/staff', { routes: routes() });
    await screen.findByText('omar@vamar.ae');
    await user.click(screen.getByRole('button', { name: 'Invite staff' }));
    const dialog = await screen.findByRole('dialog');
    const invite = within(dialog).getByRole('button', { name: 'Invite staff' });
    expect(invite).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByLabelText(/^Name/), ' Huda Karim ');
    await user.type(within(dialog).getByLabelText(/^Email/), 'huda@vamar.ae ');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'admin');
    await user.click(invite);
    expect(
      await screen.findByText(
        'Invited. Create the same email in Firebase Authentication with a temporary password and share it securely.',
      ),
    ).toBeTruthy();
    expect(api.last('POST', '/api/staff/staff').body).toEqual({
      email: 'huda@vamar.ae',
      name: 'Huda Karim',
      role: 'admin',
    });
  });

  it('shows Arabic role names, the empty list and the error state', async () => {
    await renderApp('/staff', { lang: 'ar', routes: routes() });
    await screen.findByText('omar@vamar.ae');
    expect(within(rowOf('Omar Saeed')).getByRole('option', { name: 'إدخال بيانات' })).toBeTruthy();
    expect(within(rowOf('Omar Saeed')).getByRole('option', { name: 'مدير' })).toBeTruthy();
    cleanup();
    await renderApp('/staff', {
      routes: routes({ 'GET /api/staff/staff': { items: [STAFF[3]] } }),
    });
    expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
    cleanup();
    await renderApp('/staff', { routes: routes({ 'GET /api/staff/staff': apiError(500, 'x') }) });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('roleLabel', () => {
  it('names the two client roles and passes any other role through', () => {
    expect(roleLabel('admin', 'en')).toBe('Admin');
    expect(roleLabel('editor', 'ar')).toBe('إدخال بيانات');
    expect(roleLabel('viewer', 'en')).toBe('viewer');
  });
});
