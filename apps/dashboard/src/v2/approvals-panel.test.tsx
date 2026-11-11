// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, buildingDetail, page } from '@/test/fixtures';
import {
  expenseDetail,
  expenseRow,
  expenseTotals,
  v2Routes,
  workOrderDetail,
  workOrderRow,
} from '@/test/fixtures-v2';
import { renderApp } from '@/test/render';
import type { Approvals, StaffApproval } from '@/lib/types-v2';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const answer = (a: Partial<StaffApproval>): StaffApproval => ({
  id: 'ap-1',
  ownerId: 'own-1',
  nameAr: 'فاطمة السويدي',
  nameEn: 'Fatima Al Suwaidi',
  amountFils: 900_000,
  shareFils: 540_000,
  status: 'pending',
  note: null,
  askedOn: '2026-10-05',
  answeredAt: null,
  deadline: '2026-10-08',
  overriddenAt: null,
  overriddenByName: null,
  overrideReason: null,
  ...a,
});

const waiting: Approvals = {
  source: 'work_order',
  state: 'rejected',
  items: [
    answer({
      status: 'approved',
      note: 'تمام',
      answeredAt: '2026-10-06T06:30:00.000Z',
      deadline: null,
    }),
    answer({
      id: 'ap-2',
      ownerId: 'own-2',
      nameAr: 'عمر حداد',
      nameEn: 'Omar Haddad',
      shareFils: 360_000,
      status: 'rejected',
      note: 'Get a second quote',
      answeredAt: '2026-10-06T07:00:00.000Z',
      deadline: null,
    }),
    answer({
      id: 'ap-3',
      ownerId: 'own-3',
      nameAr: 'راشد بن طوق',
      nameEn: 'Rashid Bin Touq',
      shareFils: 0,
      status: 'pending',
    }),
  ],
};

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/buildings/:id': buildingDetail(),
    'GET /api/staff/work-orders/:id': workOrderDetail({
      estimateFils: 900_000,
      approvalState: 'rejected',
      approvals: waiting,
    }),
    ...extra,
  });

describe('owner approvals on the work order', () => {
  it('shows each owner’s answer, share, note and deadline, and an admin overrides with a reason', async () => {
    const { api, user } = await renderApp('/work-orders/wo-1', {
      role: 'admin',
      routes: routes({
        'POST /api/staff/work-orders/:id/approvals/override': { items: [] },
      }),
    });
    expect(await screen.findByRole('heading', { name: 'AC not cooling' })).toBeTruthy();
    const section = screen.getByRole('region', { name: /Owner approval/ });
    expect(within(section).getByText('Asked to approve AED 9,000')).toBeTruthy();
    const omar = within(section).getByText('Omar Haddad').closest('li');
    if (!omar) throw new Error('no row');
    expect(within(omar).getByText('Rejected')).toBeTruthy();
    expect(within(omar).getByText(/Get a second quote/)).toBeTruthy();
    const rashid = within(section).getByText('Rashid Bin Touq').closest('li');
    if (!rashid) throw new Error('no row');
    expect(within(rashid).getByText('Awaiting answer')).toBeTruthy();
    expect(within(rashid).getByText('Counts as approved if no answer by 8 Oct 2026')).toBeTruthy();
    expect(within(section).getByText('Rejected by an owner')).toBeTruthy();
    // The estimate shows in AED with the threshold in the hint.
    const estimate = screen.getByRole('textbox', { name: /Estimate \(AED\)/ });
    expect(estimate).toHaveProperty('value', '9000');
    expect(screen.getByText(/At AED 5,000 or more the owners are asked/)).toBeTruthy();

    await user.click(within(section).getByRole('button', { name: 'Override approval' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Override approval' });
    expect(confirm).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByRole('textbox'), 'Water leaking into 201');
    await user.click(confirm);
    expect(await screen.findByText('Approval overridden.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/work-orders/wo-1/approvals/override').body).toEqual({
      reason: 'Water leaking into 201',
    });
  });

  it('editors see the answers but no override, and a refused start says why', async () => {
    const { api, user } = await renderApp('/work-orders/wo-1', {
      role: 'editor',
      routes: routes({
        'PATCH /api/staff/work-orders/:id': apiError(409, 'approval_required', 'An owner rejected'),
      }),
    });
    expect(await screen.findByRole('heading', { name: 'AC not cooling' })).toBeTruthy();
    expect(screen.getByText('Omar Haddad')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Override approval' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(await screen.findByText(/The owners have not approved this job yet/)).toBeTruthy();
    expect(api.last('PATCH', '/api/staff/work-orders/wo-1').body).toMatchObject({
      status: 'done',
      estimateFils: 900_000,
    });
    // The form goes back to the job's real status.
    expect(screen.getByRole('combobox', { name: /^Status/ })).toHaveProperty(
      'value',
      'in_progress',
    );
  });

  it('sends the estimate in fils, and null when cleared', async () => {
    const { api, user } = await renderApp('/work-orders/wo-1', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/work-orders/:id': workOrderDetail(),
        'PATCH /api/staff/work-orders/:id': (c: ApiCall) => workOrderRow({ ...(c.body as object) }),
      }),
    });
    const estimate = await screen.findByRole('textbox', { name: /Estimate \(AED\)/ });
    expect(screen.queryByRole('region', { name: /Owner approval/ })).toBeNull();
    await user.type(estimate, '12500.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/work-orders/wo-1').body).toMatchObject({
        estimateFils: 1_250_050,
      });
    });
    await user.clear(estimate);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/work-orders/wo-1').body).toMatchObject({
        estimateFils: null,
      });
    });
  });

  it('reads in Arabic, right to left, with Western digits', async () => {
    await renderApp('/work-orders/wo-1', { role: 'admin', lang: 'ar', routes: routes() });
    const section = await screen.findByRole('region', { name: /موافقة الملاك/ });
    expect(document.documentElement.dir).toBe('rtl');
    expect(within(section).getByText('مرفوض')).toBeTruthy();
    expect(within(section).getByText('بانتظار الرد')).toBeTruthy();
    expect(within(section).getByText('رفضه مالك')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'تجاوز الموافقة' })).toBeTruthy();
    expect(section.textContent).toMatch(/9,000/);
    expect(section.textContent).not.toMatch(/[٠-٩]/);
  });
});

describe('owner approvals on expenses and the lists', () => {
  it('an expense paying for an asked job shows the job’s answers; a refused post says why', async () => {
    const { user } = await renderApp('/expenses/exp-1', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/expenses/:id': expenseDetail({
          status: 'draft',
          approvals: { ...waiting, state: 'pending', items: [answer({})] },
        }),
        'POST /api/staff/expenses/:id/post': apiError(409, 'approval_required', 'Waiting'),
      }),
    });
    const section = await screen.findByRole('region', { name: /Owner approval/ });
    expect(within(section).getByText(/on the work order this expense pays for/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Post' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Post' }));
    expect(await screen.findByText(/The owners have not approved this job yet/)).toBeTruthy();
  });

  it('filters work orders and expenses to those awaiting approval, with a chip on the row', async () => {
    const { api, user } = await renderApp('/work-orders', {
      role: 'viewer',
      routes: routes({
        'GET /api/staff/work-orders': page([
          workOrderRow({ approvalState: 'pending' }),
          workOrderRow({ id: 'wo-2', titleEn: 'Repaint corridor', approvalState: 'approved' }),
        ]),
      }),
    });
    const row = (await screen.findByRole('link', { name: 'AC not cooling' })).closest('tr');
    if (!row) throw new Error('no row');
    expect(within(row).getByText('Awaiting owner approval')).toBeTruthy();
    const other = screen.getByRole('link', { name: 'Repaint corridor' }).closest('tr');
    if (!other) throw new Error('no row');
    expect(within(other).queryByText('Approved by the owners')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Awaiting owner approval' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await user.click(toggle);
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/work-orders').query['approval']).toBe('awaiting');
    });
    cleanup();

    const xs = await renderApp('/expenses?approval=awaiting', {
      role: 'viewer',
      routes: routes({
        'GET /api/staff/expenses': {
          ...page([expenseRow({ status: 'draft', approvalState: 'rejected' })]),
          totals: expenseTotals(),
        },
      }),
    });
    expect(await screen.findByText('Rejected by an owner')).toBeTruthy();
    const call = xs.api.last('GET', '/api/staff/expenses');
    expect(call.query['approval']).toBe('awaiting');
    // Waiting drafts are listed whatever their invoice date.
    expect(call.query['from']).toBeUndefined();
    expect(
      screen.getByRole('button', { name: 'Awaiting owner approval' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
