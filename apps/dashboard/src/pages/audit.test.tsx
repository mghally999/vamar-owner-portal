// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { auditRow, page, staffRow } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { expectSortsBy } from '@/test/sort';
import { ENTITY_TYPES } from './audit';

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
    const create = await screen.findByText('Owner added');
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

    await user.click(screen.getByText('Contract expired'));
    expect(screen.getByText('—', { selector: 'pre' })).toBeTruthy();
  });

  it('names each action in words, in Arabic too, and shows an unknown code as it is', async () => {
    await renderApp('/audit', {
      lang: 'ar',
      routes: {
        'GET /api/staff/staff': { items: [staffRow()] },
        'GET /api/staff/audit': page([
          ...ROWS,
          auditRow({ id: 'aud-4', action: 'repair_approval.silence' }),
        ]),
      },
    });
    expect(await screen.findByText('إضافة مالك')).toBeTruthy();
    expect(screen.getByText('موافقة على إصلاح لعدم الرد')).toBeTruthy();
    expect(screen.queryByText('repair_approval.silence')).toBeNull();
    expect(screen.getByText('owner.login').getAttribute('dir')).toBe('ltr');
  });

  it('sends the chosen filters and pages with the cursor', async () => {
    const { api, user } = await renderApp('/audit', {
      routes: {
        'GET /api/staff/staff': { items: [staffRow()] },
        'GET /api/staff/audit': (c: ApiCall) =>
          c.query['cursor'] ? page([]) : page([ROWS[0]], 'older'),
      },
    });
    await screen.findByText('Owner added');
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

  it('filters on every entity the API audits, approvals and work orders included', async () => {
    const { api, user } = await renderApp('/audit', {
      routes: {
        'GET /api/staff/staff': { items: [staffRow()] },
        'GET /api/staff/audit': page(ROWS),
      },
    });
    await screen.findByText('Owner added');
    const entity = screen.getByRole('combobox', { name: 'Entity' });
    const options = Array.from(entity.querySelectorAll('option')).map((o) => o.value);
    for (const type of [
      'expense',
      'work_order',
      'repair_approval',
      'budget',
      'message_thread',
      'calendar_event',
      'settings',
    ]) {
      expect(options).toContain(type);
    }
    expect(options).toEqual(['', ...ENTITY_TYPES]);
    await user.selectOptions(entity, 'repair_approval');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/audit').query['entityType']).toBe('repair_approval');
    });
  });

  it('keeps the filters in the URL, so a reload or a shared link lists the same entries', async () => {
    const { api, router, user } = await renderApp(
      '/audit?actorId=stf-2&entityType=cheque&from=2026-10-01',
      {
        routes: {
          'GET /api/staff/staff': { items: [staffRow()] },
          'GET /api/staff/audit': page(ROWS),
        },
      },
    );
    await screen.findByText('Owner added');
    // The first request already carries the filters from the link.
    expect(api.to('GET', '/api/staff/audit').map((c) => c.query)).toEqual([
      {
        actorId: 'stf-2',
        entityType: 'cheque',
        from: '2026-10-01',
        limit: '50',
      },
    ]);
    expect(screen.getByRole('combobox', { name: 'Entity' })).toHaveProperty('value', 'cheque');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Entity' }), '');
    await vi.waitFor(() => {
      expect(router.state.location.search).toEqual({ actorId: 'stf-2', from: '2026-10-01' });
    });
  });

  it('opens an entry from the keyboard', async () => {
    const { user } = await renderApp('/audit', {
      routes: {
        'GET /api/staff/staff': { items: [staffRow()] },
        'GET /api/staff/audit': page(ROWS),
      },
    });
    const row = (await screen.findByText('Owner added')).closest('tr');
    if (!row) throw new Error('no row');
    const toggle = within(row).getByRole('button', { expanded: false });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Before')).toBeTruthy();
    await user.keyboard(' ');
    expect(screen.queryByText('Before')).toBeNull();
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

  it('sorts by time and actor through the API', async () => {
    const { api, user } = await renderApp('/audit', {
      routes: {
        'GET /api/staff/staff': { items: [staffRow()] },
        'GET /api/staff/audit': page(ROWS),
      },
    });
    await screen.findByText('Owner added');
    await expectSortsBy(user, api, '/api/staff/audit', 'When', 'at');
    await expectSortsBy(user, api, '/api/staff/audit', 'Actor', 'actor');
  });
});
