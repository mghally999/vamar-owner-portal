import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import ChequeDetailScreen from '../../../app/cheque/[id]';
import DisputeDetailScreen from '../../../app/dispute/[id]';
import UnitDetailScreen from '../../../app/unit/[id]';
import { setAccessToken } from '@/lib/api';
import { mockApi, sent } from '@/test/api';
import { chequeDetail, disputeDetail, timelineEntry, unitDetail } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { routeState, router } from '@/test/router';

beforeEach(() => {
  setAccessToken(null);
});

describe('Cheque detail', () => {
  beforeEach(() => {
    routeState.params = { id: 'chq-1' };
  });

  it('shows the amount, status, details and timeline of the cheque in the link', async () => {
    mockApi({ 'GET /api/owner/cheques/chq-1': { body: chequeDetail() } });
    await renderApp(<ChequeDetailScreen />, { signedIn: false });
    expect(await screen.findByText('AED 25,000')).toBeTruthy();
    expect(sent('GET /api/owner/cheques/chq-1')).toHaveLength(1);
    expect(screen.getByText('Cheque')).toBeTruthy();
    // The due date, and the deposit on that day in the timeline.
    expect(screen.getAllByText('5 Oct 2026')).toHaveLength(2);
    expect(screen.getByText('000123')).toBeTruthy();
    expect(screen.getByText('Emirates NBD')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 1204')).toBeTruthy();
    expect(screen.getByText('Ahmed Rahman')).toBeTruthy();
    expect(screen.getByText('Timeline')).toBeTruthy();
    // Current status, then each step of the timeline.
    expect(screen.getAllByText('Upcoming')).toHaveLength(2);
    expect(screen.getByText('Deposited')).toBeTruthy();
    expect(screen.getByText('1 Sep 2026')).toBeTruthy();
    expect(screen.queryByText('Cheque image')).toBeNull();
  });

  it('shows the owner share, the bounce reason, missing fields and the cheque image', async () => {
    setAccessToken('access-1');
    mockApi({
      'GET /api/owner/cheques/chq-1': {
        body: chequeDetail({
          shared: true,
          shareBp: 5_000,
          status: 'bounced',
          bounceReason: 'Insufficient funds',
          chequeNo: null,
          bankName: null,
          hasImage: true,
        }),
      },
    });
    await renderApp(<ChequeDetailScreen />, { signedIn: false });
    expect(await screen.findByText('Your share (50%)')).toBeTruthy();
    expect(screen.getByText('Reason: Insufficient funds')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('Cheque image')).toBeTruthy();
    const image = screen.getByLabelText('Cheque image');
    expect(JSON.stringify(image.props)).toContain('/api/owner/cheques/chq-1/image');
    expect(JSON.stringify(image.props)).toContain('Bearer access-1');
  });

  it('shows placeholders while loading', async () => {
    mockApi({ 'GET /api/owner/cheques/chq-1': () => new Promise(() => undefined) });
    await renderApp(<ChequeDetailScreen />, { signedIn: false });
    expect(await screen.findByText('Timeline')).toBeTruthy();
    expect(screen.queryByText('AED 25,000')).toBeNull();
  });

  it('shows an error with a retry', async () => {
    mockApi({ 'GET /api/owner/cheques/chq-1': { status: 404, body: {} } });
    await renderApp(<ChequeDetailScreen />, { signedIn: false });
    mockApi({ 'GET /api/owner/cheques/chq-1': { body: chequeDetail() } });
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('AED 25,000')).toBeTruthy();
  });
});

describe('Unit detail', () => {
  beforeEach(() => {
    routeState.params = { id: 'unit-1' };
    mockApi({
      'GET /api/owner/units/unit-1/timeline': {
        body: {
          items: [
            timelineEntry(),
            timelineEntry({
              kind: 'expense',
              id: 'expense:exp-1',
              at: '2026-09-12T04:00:00.000Z',
              date: '2026-09-12',
              titleAr: 'expense_variable',
              titleEn: 'Lift 2 repair',
              detailAr: 'إصلاح المصعد',
              detailEn: 'GL-2026-0417',
              entityType: 'expense',
              entityId: 'exp-1',
              amountFils: 130_200,
              status: 'posted',
            }),
            timelineEntry({
              kind: 'status',
              id: 'status:ev-1',
              at: '2026-08-01T04:00:00.000Z',
              date: '2026-08-01',
              titleAr: 'status',
              titleEn: 'under_maintenance',
              detailAr: 'Repainting',
              detailEn: 'vacant_ready',
              entityType: 'unit',
              entityId: 'unit-1',
              amountFils: null,
              status: 'under_maintenance',
            }),
          ],
          nextCursor: 'p2',
        },
      },
    });
  });

  it('shows the status badge, the property record and the history with filters and paging', async () => {
    mockApi({
      'GET /api/owner/units/unit-1': {
        body: unitDetail({
          titleDeedNo: 'TD-1-0001',
          makaniNo: '2735894120',
          dewaPremiseNo: '300001001',
          municipalityNo: '1001-1204',
          handoverDate: '2016-06-01',
        }),
      },
    });
    await renderApp(<UnitDetailScreen />, { signedIn: false });
    expect(await screen.findByText('Occupied')).toBeTruthy();
    expect(screen.getByText('Property record')).toBeTruthy();
    expect(screen.getByText('TD-1-0001')).toBeTruthy();
    expect(screen.getByText('2735894120')).toBeTruthy();
    expect(screen.getByText('DEWA / SEWA account no.')).toBeTruthy();
    expect(screen.getByText('1 Jun 2016')).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
    expect(await screen.findByText('Cheque cleared · 000123')).toBeTruthy();
    expect(screen.getByText('Variable expense · Lift 2 repair')).toBeTruthy();
    expect(screen.getByText('GL-2026-0417')).toBeTruthy();
    expect(screen.getByText('Status: Under maintenance')).toBeTruthy();
    expect(screen.getByText('Repainting')).toBeTruthy();
    await fireEvent.press(screen.getByText('Variable expense · Lift 2 repair'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/expense/[id]',
      params: { id: 'exp-1' },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      const calls = sent('GET /api/owner/units/unit-1/timeline');
      expect(calls[calls.length - 1]?.query.get('cursor')).toBe('p2');
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Expenses' }));
    await waitFor(() => {
      const calls = sent('GET /api/owner/units/unit-1/timeline');
      expect(calls[calls.length - 1]?.query.get('kinds')).toBe('expense');
    });
  });

  it('shows a vacant unit with its manual status, in Arabic too', async () => {
    mockApi({
      'GET /api/owner/units/unit-1': {
        body: unitDetail({ occupied: false, status: 'reserved', tenantName: null }),
      },
      'GET /api/owner/units/unit-1/timeline': { body: { items: [], nextCursor: null } },
    });
    await renderApp(<UnitDetailScreen />, { lang: 'ar', signedIn: false });
    expect(await screen.findByText('محجوزة')).toBeTruthy();
    expect(screen.queryByText('سجل العقار')).toBeNull();
    expect(await screen.findByText('لا يوجد سجل بعد.')).toBeTruthy();
  });

  it('shows a rented unit with its rent, cheques and contracts', async () => {
    mockApi({ 'GET /api/owner/units/unit-1': { body: unitDetail() } });
    await renderApp(<UnitDetailScreen />, { signedIn: false });
    expect(await screen.findByText('Oasis Tower 1204')).toBeTruthy();
    expect(screen.getByText('Rented · Ahmed Rahman')).toBeTruthy();
    expect(screen.getByText('Annual rent')).toBeTruthy();
    expect(screen.getAllByText('AED 120,000').length).toBeGreaterThan(0);
    expect(screen.getByText('31 Mar 2027')).toBeTruthy();

    expect(screen.getAllByText('5 Oct 2026').length).toBeGreaterThan(0);
    expect(screen.getByText('000123 · Emirates NBD')).toBeTruthy();
    expect(screen.getByText('— · ')).toBeTruthy();

    expect(screen.getByText('1 Apr 2026 – 31 Mar 2027 · Active')).toBeTruthy();
    expect(screen.getByText('1 Apr 2025 – 31 Mar 2026 · Expired')).toBeTruthy();
    expect(screen.getByText('Old Tenant LLC')).toBeTruthy();
  });

  it('opens a cheque of the unit', async () => {
    mockApi({ 'GET /api/owner/units/unit-1': { body: unitDetail() } });
    await renderApp(<UnitDetailScreen />, { signedIn: false });
    await fireEvent.press(await screen.findByText('000123 · Emirates NBD'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/cheque/[id]', params: { id: 'chq-1' } });
  });

  it('shows a vacant unit, a shared unit and a unit with no cheques', async () => {
    mockApi({
      'GET /api/owner/units/unit-1': {
        body: unitDetail({
          occupied: false,
          tenantName: null,
          vacantSince: '2026-08-01',
          shareBp: 2_500,
          cheques: [],
          contracts: [],
        }),
      },
    });
    await renderApp(<UnitDetailScreen />, { signedIn: false });
    expect(await screen.findByText('Vacant since 1 Aug 2026 · Your share 25%')).toBeTruthy();
    expect(screen.queryByText('Annual rent')).toBeNull();
    expect(screen.getByText('No cheques match these filters.')).toBeTruthy();
  });

  it('labels a unit that was never rented and contracts in Arabic', async () => {
    mockApi({
      'GET /api/owner/units/unit-1': {
        body: unitDetail({
          occupied: false,
          vacantSince: null,
          contracts: [
            { ...unitDetail().contracts[0]!, id: 'c1', status: 'renewed' },
            { ...unitDetail().contracts[0]!, id: 'c2', status: 'archived' as 'draft' },
          ],
        }),
      },
    });
    await renderApp(<UnitDetailScreen />, { lang: 'ar', signedIn: false });
    expect(await screen.findByText('لم تُؤجَّر بعد')).toBeTruthy();
    expect(screen.getByText(/· مُجدَّد$/)).toBeTruthy();
    // An unknown status is shown as it came.
    expect(screen.getByText(/· archived$/)).toBeTruthy();
  });

  it('shows the tenant line even when the tenant name is missing', async () => {
    mockApi({ 'GET /api/owner/units/unit-1': { body: unitDetail({ tenantName: null }) } });
    await renderApp(<UnitDetailScreen />, { signedIn: false });
    expect(await screen.findByText('Rented · ')).toBeTruthy();
  });

  it('shows placeholders while loading and an error with a retry', async () => {
    mockApi({ 'GET /api/owner/units/unit-1': () => new Promise(() => undefined) });
    const first = await renderApp(<UnitDetailScreen />, { signedIn: false });
    expect((await screen.findAllByText('Contracts')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Oasis Tower 1204')).toBeNull();
    await first.unmount();

    mockApi({ 'GET /api/owner/units/unit-1': { status: 500, body: {} } });
    await renderApp(<UnitDetailScreen />, { signedIn: false });
    mockApi({ 'GET /api/owner/units/unit-1': { body: unitDetail() } });
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Oasis Tower 1204')).toBeTruthy();
  });
});

describe('Dispute detail', () => {
  beforeEach(() => {
    routeState.params = { id: 'dsp-1' };
  });

  it('shows the case, the cheque numbers with bank, amount, dates and reason, and the updates', async () => {
    mockApi({
      'GET /api/owner/disputes/dsp-1': {
        body: disputeDetail({
          chequeNos: ['000123'],
          cheques: [
            {
              id: 'chq-1',
              chequeNo: '000123',
              bankName: 'Emirates NBD',
              amountFils: 2_500_000,
              dueDate: '2026-10-05',
              status: 'bounced',
              bouncedAt: '2026-10-08T06:00:00Z',
              bounceReason: 'Insufficient funds',
              contractId: 'ctr-1',
            },
          ],
        }),
      },
    });
    await renderApp(<DisputeDetailScreen />, { signedIn: false });
    expect(await screen.findByText('Case RDC-2026-0042 · Hearing scheduled')).toBeTruthy();
    expect(screen.getByText('Rent arrears')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 1204 · Ahmed Rahman')).toBeTruthy();
    expect(screen.getByText('AED 45,000')).toBeTruthy();
    expect(screen.getByText('12 Nov 2026')).toBeTruthy();
    expect(screen.getByText('1 Jul 2026')).toBeTruthy();
    expect(screen.getByText('Case filed with the Rental Dispute Centre.')).toBeTruthy();
    expect(screen.getByText('First hearing set for 12 November.')).toBeTruthy();
    expect(screen.getByText('2 Jul 2026')).toBeTruthy();
    expect(screen.getByText('Cheque 000123')).toBeTruthy();
    expect(screen.getByText('Cheques in this case')).toBeTruthy();
    expect(screen.getByText('Cheque no. 000123')).toBeTruthy();
    expect(screen.getByText('Bank: Emirates NBD')).toBeTruthy();
    expect(screen.getByText('AED 25,000')).toBeTruthy();
    expect(screen.getByText('Due date: 5 Oct 2026 · Bounced on: 8 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Reason: Insufficient funds')).toBeTruthy();
    await fireEvent.press(screen.getByText('Cheque no. 000123'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/cheque/[id]',
      params: { id: 'chq-1' },
    });
  });

  it('shows dashes for unknown facts and says when there are no updates', async () => {
    mockApi({
      'GET /api/owner/disputes/dsp-1': {
        body: disputeDetail({
          amountClaimedFils: null,
          nextHearingDate: null,
          tenantName: null,
          updates: [],
        }),
      },
    });
    await renderApp(<DisputeDetailScreen />, { signedIn: false });
    expect(await screen.findByText('No updates yet.')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('Oasis Tower 1204')).toBeTruthy();
  });

  it('shows placeholders while loading and an error with a retry', async () => {
    mockApi({ 'GET /api/owner/disputes/dsp-1': () => new Promise(() => undefined) });
    const first = await renderApp(<DisputeDetailScreen />, { signedIn: false });
    expect(await screen.findByText('Updates from Vamar')).toBeTruthy();
    expect(screen.queryByText('Rent arrears')).toBeNull();
    await first.unmount();

    mockApi({ 'GET /api/owner/disputes/dsp-1': { status: 500, body: {} } });
    await renderApp(<DisputeDetailScreen />, { signedIn: false });
    mockApi({ 'GET /api/owner/disputes/dsp-1': { body: disputeDetail() } });
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Rent arrears')).toBeTruthy();
  });
});
