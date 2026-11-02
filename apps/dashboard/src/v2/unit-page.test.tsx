// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { statusHistory, timelineEntries, unitRecord } from './test-fixtures';
import { renderV2 } from './test-render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/units/unit-801': unitRecord(),
    'GET /api/staff/units/unit-801/status-history': { items: statusHistory },
    'GET /api/staff/units/unit-801/timeline': (c: ApiCall) =>
      c.query['cursor'] === 'c2'
        ? { items: [timelineEntries()[3]], nextCursor: null }
        : {
            items: c.query['kinds']
              ? timelineEntries().filter((e) =>
                  (c.query['kinds'] ?? '').split(',').includes(e.kind),
                )
              : timelineEntries().slice(0, 3),
            nextCursor: c.query['kinds'] ? null : 'c2',
          },
    'POST /api/staff/units/unit-801/status': (c: ApiCall) =>
      unitRecord({ status: (c.body as { status: 'reserved' }).status }),
    'PATCH /api/staff/units/unit-801/identifiers': (c: ApiCall) => unitRecord(c.body as object),
    ...extra,
  };
}

describe('UnitPage', () => {
  it('shows the property number, status, owners, contracts and the timeline newest first', async () => {
    await renderV2('/units/unit-801', { routes: routes() });
    expect(await screen.findByRole('heading', { name: 'Unit 801' })).toBeTruthy();
    expect(screen.getByText('Occupied')).toBeTruthy();
    expect(screen.getByText('TD-1-0001')).toBeTruthy();
    expect(screen.getByText('2735894120')).toBeTruthy();
    expect(screen.getByText('301000977')).toBeTruthy();
    expect(screen.getByText('1 Jun 2016')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ahmed Al Mansouri' }).getAttribute('href')).toBe(
      '/owners/own-1',
    );
    expect(screen.getByText(/Share 100%/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sara Khan' }).getAttribute('href')).toBe(
      '/contracts/con-1',
    );
    expect(screen.getByText('Repainting before the next tenant')).toBeTruthy();
    expect(await screen.findByText('Status set to Under maintenance')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cheque 000101 cleared' }).getAttribute('href')).toBe(
      '/cheques/chq-1',
    );
    expect(screen.getByText('Variable expense: AC breakdown')).toBeTruthy();
    expect(screen.getByText('AED 3,307.50')).toBeTruthy();
  });

  it('loads more entries and filters the timeline by kind', async () => {
    const { api, user } = await renderV2('/units/unit-801', { routes: routes() });
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Contract started with Sara Khan')).toBeTruthy();
    expect(api.last('GET', '/api/staff/units/unit-801/timeline').query['cursor']).toBe('c2');
    for (const kind of [
      'Status changes',
      'Contracts',
      'Tenants',
      'Expenses',
      'Maintenance',
      'Disputes',
      'Ownership',
    ])
      await user.click(screen.getByRole('checkbox', { name: kind }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/units/unit-801/timeline').query['kinds']).toBe('cheque');
    });
    expect(await screen.findByText('Cheque 000101 cleared')).toBeTruthy();
    expect(screen.queryByText('Variable expense: AC breakdown')).toBeNull();
  });

  it('changes the status with a reason (occupied is not offered) and edits the identifiers', async () => {
    const { api, user } = await renderV2('/units/unit-801', { role: 'editor', routes: routes() });
    await user.click(await screen.findByRole('button', { name: 'Change status' }));
    const dialog = await screen.findByRole('dialog');
    const status = within(dialog).getByRole('combobox', { name: /Status/ });
    expect(within(status).queryByRole('option', { name: 'Occupied' })).toBeNull();
    await user.selectOptions(status, 'reserved');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByLabelText(/Reason/), 'Deposit received');
    await user.click(save);
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/units/unit-801/status').body).toEqual({
        status: 'reserved',
        reason: 'Deposit received',
      });
    });
    expect(await screen.findByText('Status changed.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Edit identifiers' }));
    const ids = await screen.findByRole('dialog');
    const makani = within(ids).getByLabelText(/Makani/);
    await user.clear(makani);
    await user.type(makani, '12');
    expect(within(ids).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    await user.clear(makani);
    await user.type(makani, '9876543210');
    await user.clear(within(ids).getByLabelText(/Plot/));
    await user.click(within(ids).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/units/unit-801/identifiers').body).toEqual({
        titleDeedNo: 'TD-1-0001',
        plotNo: null,
        makaniNo: '9876543210',
        dewaPremiseNo: '301000977',
        municipalityNo: '1001-801',
        handoverDate: '2016-06-01',
      });
    });
    expect(await screen.findByText('Identifiers saved.')).toBeTruthy();
  });

  it('shows the conflict when the status is unchanged, and Arabic labels for viewers', async () => {
    const { user } = await renderV2('/units/unit-801', {
      role: 'editor',
      routes: routes({ 'POST /api/staff/units/unit-801/status': apiError(409, 'conflict') }),
    });
    await user.click(await screen.findByRole('button', { name: 'Change status' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Trying again');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The unit already has this status.')).toBeTruthy();
    cleanup();
    await renderV2('/units/unit-801', { role: 'viewer', lang: 'ar', routes: routes() });
    expect(await screen.findByRole('heading', { name: 'الوحدة 801' })).toBeTruthy();
    expect(screen.getByText('مؤجَّرة')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'تغيير الحالة' })).toBeNull();
    expect(screen.getByText('رقم سند الملكية')).toBeTruthy();
  });

  it('shows the error state when the unit cannot load', async () => {
    await renderV2('/units/unit-801', {
      routes: routes({ 'GET /api/staff/units/unit-801': apiError(500, 'internal') }),
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
