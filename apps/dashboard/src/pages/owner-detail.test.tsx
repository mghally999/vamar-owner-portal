// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/test/api';
import { owner, ownerDetail } from '@/test/fixtures';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OwnerDetailPage', () => {
  it('shows the owner, their holdings and devices', async () => {
    await renderApp('/owners/own-1', {
      routes: {
        'GET /api/staff/owners/own-1': ownerDetail({
          devices: [
            ...ownerDetail().devices,
            {
              id: 'dev-2',
              platform: 'android',
              model: '',
              firstSeen: '2026-03-01T09:00:00.000Z',
              lastSeen: '2026-03-02T09:00:00.000Z',
              revokedAt: '2026-04-01T09:00:00.000Z',
              hasPushToken: false,
            },
          ],
        }),
      },
    });
    const title = await screen.findByRole('heading', { name: 'Ahmed Al Mansouri' });
    const header = title.closest('header');
    if (!header) throw new Error('no page header');
    expect(within(header).getByText('أحمد المنصوري')).toBeTruthy();
    expect(within(header).getByText('ahmed@example.ae')).toBeTruthy();
    expect(within(header).getByText('العربية')).toBeTruthy();
    const holding = screen.getByRole('link', { name: 'Al Noor Tower · 801' });
    expect(holding.getAttribute('href')).toBe('/buildings/bld-1');
    expect(screen.getByText('Share 50%')).toBeTruthy();
    expect(screen.getByText('iPhone 15')).toBeTruthy();
    expect(screen.getByText('Notifications on')).toBeTruthy();
    // A device without a model shows its platform; a revoked one says it was signed out.
    expect(screen.getAllByText('Android')).toHaveLength(1);
    expect(screen.getByText('Sign out', { selector: 'span' })).toBeTruthy();
  });

  it('disables an account after confirmation', async () => {
    const { api, user } = await renderApp('/owners/own-1', {
      role: 'editor',
      routes: {
        'GET /api/staff/owners/own-1': ownerDetail({ holdings: [], devices: [] }),
        'POST /api/staff/owners/own-1/status': owner({ status: 'disabled' }),
      },
    });
    expect(await screen.findByText('The owner has not signed in to the app yet.')).toBeTruthy();
    expect(
      screen.getByText('This owner holds no units yet. Assign units from the building page.'),
    ).toBeTruthy();
    // Only admins may change the sign-in phone.
    expect(screen.queryByRole('button', { name: 'Change phone number' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Disable account' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.last('POST', '/api/staff/owners/own-1/status').body).toEqual({
      status: 'disabled',
    });
  });

  it('re-enables a disabled account', async () => {
    const { api, user } = await renderApp('/owners/own-1', {
      routes: {
        'GET /api/staff/owners/own-1': ownerDetail({ status: 'disabled', preferredLang: 'en' }),
        'POST /api/staff/owners/own-1/status': owner(),
      },
    });
    expect(await screen.findByText('English')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Enable account' }));
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/owners/own-1/status').body).toEqual({
        status: 'active',
      });
    });
  });

  it('changes the sign-in phone with a reason and reports a clash', async () => {
    let clash = true;
    const { api, user } = await renderApp('/owners/own-1', {
      routes: {
        'GET /api/staff/owners/own-1': ownerDetail(),
        'POST /api/staff/owners/own-1/phone': () =>
          clash ? apiError(409, 'conflict') : owner({ phoneE164: '+971509990000' }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Change phone number' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    const phone = within(dialog).getByLabelText(/Phone \(sign-in number\)/);
    expect(phone).toHaveProperty('value', '+971501234567');

    await user.clear(phone);
    await user.type(phone, '+971509990000');
    expect(confirm).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Owner lost the SIM');
    expect(confirm).toHaveProperty('disabled', false);

    await user.click(confirm);
    expect(
      await within(dialog).findByText('An owner with this phone number already exists.'),
    ).toBeTruthy();

    clash = false;
    await user.click(confirm);
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.last('POST', '/api/staff/owners/own-1/phone').body).toEqual({
      phoneE164: '+971509990000',
      reason: 'Owner lost the SIM',
    });
  });

  it('shows the error state when the owner cannot be loaded, and retries', async () => {
    const { api, user } = await renderApp('/owners/missing', {
      routes: { 'GET /api/staff/owners/missing': apiError(404, 'not_found') },
    });
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/owners/missing').length).toBeGreaterThan(1);
    });
  });

  it('shows web and push-less devices, an unknown unit type, no e-mail, and cancels both dialogs', async () => {
    const base = ownerDetail();
    const { user } = await renderApp('/owners/own-1', {
      routes: {
        'GET /api/staff/owners/own-1': ownerDetail({
          email: null,
          holdings: base.holdings.map((h) => ({ ...h, type: 'penthouse' as never })),
          devices: [
            {
              id: 'dev-3',
              platform: 'web',
              model: '',
              firstSeen: '2026-05-01T09:00:00.000Z',
              lastSeen: '2026-05-02T09:00:00.000Z',
              revokedAt: null,
              hasPushToken: false,
            },
          ],
        }),
        'POST /api/staff/owners/own-1/phone': () => {
          throw new TypeError('Failed to fetch');
        },
      },
    });
    expect(await screen.findByRole('heading', { name: 'Ahmed Al Mansouri' })).toBeTruthy();
    expect(screen.queryByText('ahmed@example.ae')).toBeNull();
    // A type the dashboard has no label for is shown as it is stored.
    expect(screen.getByText('penthouse')).toBeTruthy();
    expect(screen.getAllByText('Web').length).toBeGreaterThan(0);
    expect(screen.getByText('Notifications off')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Disable account' }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: 'Change phone number' }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Owner lost the SIM');
    const phone = within(dialog).getByLabelText(/Phone \(sign-in number\)/);
    await user.clear(phone);
    await user.type(phone, '+971509990000');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
