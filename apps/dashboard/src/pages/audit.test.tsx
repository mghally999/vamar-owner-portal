// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { auditRow, page, staffRow } from '@/test/fixtures';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROWS = [
  auditRow(),
  auditRow({
    id: 'aud-2',
    actorType: 'system',
    actorId: null,
    actorName: null,
    action: 'contract.expire',
    entityType: 'contract',
    entityId: null,
    before: { status: 'active' },
    after: null,
  }),
  auditRow({ id: 'aud-3', actorType: 'owner', actorName: null, action: 'owner.login' }),
];

describe('AuditPage', () => {
  it('lists entries and expands the before and after of one', async () => {
    const { user } = await renderApp('/audit', {
      routes: {
        'GET /api/staff/staff': { items: [staffRow()] },
        'GET /api/staff/audit': page(ROWS),
      },
    });
    const create = await screen.findByText('owner.create');
    expect(screen.getByText('System')).toBeTruthy();
    // Without a name the actor type is shown.
    const ownerRow = screen.getByText('owner.login').closest('tr');
    expect(ownerRow?.children[1]?.textContent).toBe('owner');
    expect(screen.getAllByText('· 3f1c9a2e')).toHaveLength(2);

    await user.click(create);
    expect(screen.getByText('Before')).toBeTruthy();
    const [before, after] = Array.from(document.querySelectorAll('pre'));
    expect(before?.textContent).toBe('—');
    expect(JSON.parse(after?.textContent ?? '')).toEqual({ nameEn: 'Ahmed Al Mansouri' });
    await user.click(create);
    expect(screen.queryByText('Before')).toBeNull();

    await user.click(screen.getByText('contract.expire'));
    expect(screen.getByText('—', { selector: 'pre' })).toBeTruthy();
  });

  it('sends the chosen filters and pages with the cursor', async () => {
    const { api, user } = await renderApp('/audit', {
      routes: {
        'GET /api/staff/staff': { items: [staffRow()] },
        'GET /api/staff/audit': (c: ApiCall) =>
          c.query['cursor'] ? page([]) : page([ROWS[0]], 'older'),
      },
    });
    await screen.findByText('owner.create');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Actor' }), 'stf-2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Entity' }), 'cheque');
    await user.type(screen.getByRole('textbox', { name: 'From' }), '01/10/2026{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'To' }), '31/10/2026{Enter}');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/audit').query).toEqual({
        actorId: 'stf-2',
        entityType: 'cheque',
        from: '2026-10-01',
        to: '2026-10-31',
        limit: '50',
      });
    });
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/audit').query['cursor']).toBe('older');
    });
  });

  it('shows the empty and error states', async () => {
    await renderApp('/audit', {
      routes: { 'GET /api/staff/staff': { items: [] }, 'GET /api/staff/audit': page([]) },
    });
    expect(await screen.findByText('No audit entries match these filters.')).toBeTruthy();
    cleanup();
    await renderApp('/audit', {
      routes: {
        'GET /api/staff/staff': { items: [] },
        'GET /api/staff/audit': apiError(500, 'internal'),
      },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
