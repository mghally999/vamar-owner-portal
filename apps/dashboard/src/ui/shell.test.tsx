// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, reply } from '@/test/api';
import { overview, page, staffUser } from '@/test/fixtures';
import { at, renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  delete document.documentElement.dataset['theme'];
});

const routes = {
  'GET /api/staff/overview': overview(),
  'GET /api/staff/owners': page([]),
};

function navLabels(nav: HTMLElement) {
  return within(nav)
    .getAllByRole('link')
    .map((a) => a.textContent);
}

describe('AppShell', () => {
  it('shows every section to an admin and marks the current one', async () => {
    const { router, user } = await renderApp('/', { routes });
    const nav = screen.getByRole('navigation', { name: 'Overview' });
    expect(navLabels(nav)).toEqual([
      'Overview',
      'Owners',
      'Buildings & units',
      'Contracts',
      'Cheques',
      'Disputes',
      'Import',
      'Staff users',
      'Audit log',
    ]);
    expect(within(nav).getByRole('link', { name: 'Overview' }).className).toContain('bg-on-header');
    expect(screen.getByText('Admin')).toBeTruthy();

    await user.click(within(nav).getByRole('link', { name: 'Owners' }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/owners');
    });
    expect(within(nav).getByRole('link', { name: 'Owners' }).className).toContain('bg-on-header');
    expect(within(nav).getByRole('link', { name: 'Overview' }).className).not.toContain(
      'bg-on-header',
    );
  });

  it('leaves admin sections out for an editor', async () => {
    await renderApp('/', { role: 'editor', routes });
    const nav = screen.getByRole('navigation', { name: 'Overview' });
    expect(navLabels(nav)).not.toContain('Staff users');
    expect(navLabels(nav)).not.toContain('Audit log');
    expect(screen.getByText('Editor')).toBeTruthy();
  });

  it('switches to Arabic and back', async () => {
    const { user } = await renderApp('/', { routes });
    await user.click(screen.getByRole('button', { name: 'العربية' }));
    expect(screen.getByRole('link', { name: 'الملاك' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem('vamar.lang')).toBe('ar');
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('link', { name: 'Owners' })).toBeTruthy();
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches between the default and white themes', async () => {
    const { user } = await renderApp('/', { routes });
    const button = screen.getByRole('button', { name: 'Theme: Default' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await user.click(button);
    expect(screen.getByRole('button', { name: 'Theme: White' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(document.documentElement.dataset['theme']).toBe('white');
    expect(localStorage.getItem('vamar.theme')).toBe('white');
    await user.click(screen.getByRole('button', { name: 'Theme: White' }));
    expect(document.documentElement.dataset['theme']).toBeUndefined();
  });

  it('opens and closes the mobile menu', async () => {
    const { router, user } = await renderApp('/', { routes });
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getAllByRole('navigation')).toHaveLength(2);
    // The close button and the dimmed backdrop both close it.
    const closers = screen.getAllByRole('button', { name: 'Close' });
    expect(closers).toHaveLength(2);
    await user.click(at(closers, 0));
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(at(screen.getAllByRole('button', { name: 'Close' }), 1));
    expect(screen.getAllByRole('navigation')).toHaveLength(1);

    // Following a link from the drawer closes it as well.
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const drawer = at(screen.getAllByRole('navigation'), 1);
    await user.click(within(drawer).getByRole('link', { name: 'Owners' }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/owners');
    });
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('signs out and forgets the session', async () => {
    const { api, user } = await renderApp('/', {
      routes: { ...routes, 'POST /api/auth/staff/logout': apiError(500, 'internal') },
    });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => {
      expect(screen.queryByText(staffUser('admin').name)).toBeNull();
    });
    // A failed logout call still ends the session in the browser.
    expect(api.to('POST', '/api/auth/staff/logout')).toHaveLength(1);
    expect(localStorage.getItem('vamar_staff_session')).toBeNull();
  });

  it('ends the session when the API and the refresh both refuse', async () => {
    let refreshes = 0;
    window.history.replaceState(null, '', '/login');
    const { api, user } = await renderApp('/', {
      routes: {
        ...routes,
        'POST /api/auth/staff/refresh': () => {
          refreshes += 1;
          return refreshes === 1
            ? { accessToken: 'access-1', user: staffUser('admin') }
            : reply(401, { error: { code: 'unauthenticated', message: 'Expired' } });
        },
        'GET /api/staff/owners': reply(401, { error: { code: 'unauthenticated', message: 'x' } }),
      },
    });
    await user.click(screen.getByRole('link', { name: 'Owners' }));
    await vi.waitFor(() => {
      expect(screen.queryByText(staffUser('admin').name)).toBeNull();
    });
    // One refresh restored the session on load; the next one was refused.
    expect(refreshes).toBeGreaterThanOrEqual(2);
    expect(api.to('GET', '/api/staff/owners').length).toBeGreaterThan(0);
    expect(localStorage.getItem('vamar_staff_session')).toBeNull();
  });

  it('sends unknown addresses to the overview', async () => {
    const { router } = await renderApp('/no-such-page', { routes });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(await screen.findByText('Expected this month')).toBeTruthy();
  });
});
