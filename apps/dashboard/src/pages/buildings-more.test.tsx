// @vitest-environment jsdom
/**
 * The buildings list beyond the happy path: a retry after a failed load, creating from the page
 * header, a refused create that keeps the dialog open, and cancelling.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/test/api';
import { building } from '@/test/fixtures';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BuildingsPage, more', () => {
  it('retries the list when it cannot load', async () => {
    let fail = true;
    const { user } = await renderApp('/buildings', {
      routes: {
        'GET /api/staff/buildings': () =>
          fail ? apiError(503, 'unavailable') : { items: [building()] },
      },
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    await user.click(retry);
    expect(await screen.findByRole('link', { name: /Al Noor Tower/ })).toBeTruthy();
  });

  it('creates from the header, keeps the dialog on a refused create and cancels', async () => {
    const { api, user } = await renderApp('/buildings', {
      role: 'editor',
      routes: {
        'GET /api/staff/buildings': { items: [building()] },
        'POST /api/staff/buildings': apiError(500, 'internal'),
      },
    });
    await screen.findByRole('link', { name: /Al Noor Tower/ });
    // With buildings on the list, the only create button is in the header.
    await user.click(screen.getByRole('button', { name: 'New building' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Building name \(Arabic\)/), 'برج الواحة');
    await user.type(within(dialog).getByLabelText(/Building name \(English\)/), 'Oasis Tower');
    await user.type(within(dialog).getByLabelText(/Area \/ community/), 'JLT');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(api.to('POST', '/api/staff/buildings')).toHaveLength(1);
    // What was typed is still there to try again.
    expect(within(dialog).getByLabelText(/Building name \(English\)/)).toHaveProperty(
      'value',
      'Oasis Tower',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
