import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import DisputesScreen from '../../../app/(tabs)/disputes';
import { mockApi, sent } from '@/test/api';
import { dispute } from '@/test/fixtures';
import { pullToRefresh, renderApp } from '@/test/render';
import { router } from '@/test/router';

const items = [
  dispute(),
  dispute({
    id: 'dsp-2',
    caseNo: 'RDC-2026-0050',
    type: 'eviction',
    status: 'open',
    tenantName: null,
    nextHearingDate: null,
    amountClaimedFils: null,
    unitNo: '702',
  }),
];

beforeEach(() => {
  mockApi({ 'GET /api/owner/disputes': { body: { items, nextCursor: null } } });
});

describe('Disputes', () => {
  it('lists the disputes with type, status, unit, tenant, hearing and amount', async () => {
    await renderApp(<DisputesScreen />);
    expect(await screen.findByText('Rent arrears')).toBeTruthy();
    expect(screen.getByText('Hearing scheduled')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 1204 · Ahmed Rahman')).toBeTruthy();
    expect(screen.getByText('Case RDC-2026-0042')).toBeTruthy();
    expect(screen.getByText('Next hearing 12 Nov 2026')).toBeTruthy();
    expect(screen.getByText('AED 45,000')).toBeTruthy();

    expect(screen.getByText('Eviction')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 702')).toBeTruthy();
    expect(screen.getAllByText(/^Next hearing/)).toHaveLength(1);
  });

  it('uses Arabic labels in Arabic', async () => {
    await renderApp(<DisputesScreen />, { lang: 'ar' });
    expect(await screen.findByText('متأخرات إيجار')).toBeTruthy();
    expect(screen.getByText('برج الواحة 1204 · Ahmed Rahman')).toBeTruthy();
  });

  it('opens a dispute', async () => {
    await renderApp(<DisputesScreen />);
    await fireEvent.press(await screen.findByText('Eviction'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/dispute/[id]',
      params: { id: 'dsp-2' },
    });
  });

  it('loads more as the owner scrolls and reloads when pulled', async () => {
    mockApi({
      'GET /api/owner/disputes': (req) =>
        req.query.get('cursor') === 'p2'
          ? { body: { items: [dispute({ id: 'dsp-3', type: 'damages' })], nextCursor: null } }
          : { body: { items, nextCursor: 'p2' } },
    });
    await renderApp(<DisputesScreen />);
    await fireEvent(await screen.findByText('Eviction'), 'endReached');
    expect(await screen.findByText('Damages')).toBeTruthy();
    // Nothing more to load.
    await fireEvent(screen.getByText('Damages'), 'endReached');
    expect(sent('GET /api/owner/disputes')).toHaveLength(2);
    await pullToRefresh();
    await waitFor(() => {
      expect(sent('GET /api/owner/disputes').length).toBeGreaterThan(2);
    });
  });

  it('says when there are no disputes', async () => {
    mockApi({ 'GET /api/owner/disputes': { body: { items: [], nextCursor: null } } });
    await renderApp(<DisputesScreen />);
    expect(await screen.findByText('No disputes on your units.')).toBeTruthy();
  });

  it('shows placeholders while loading', async () => {
    mockApi({ 'GET /api/owner/disputes': () => new Promise(() => undefined) });
    await renderApp(<DisputesScreen />);
    await waitFor(() => {
      expect(sent('GET /api/owner/disputes')).toHaveLength(1);
    });
    expect(screen.queryByText('No disputes on your units.')).toBeNull();
    expect(screen.queryByText('Rent arrears')).toBeNull();
  });

  it('shows an error with a retry', async () => {
    mockApi({ 'GET /api/owner/disputes': { status: 500, body: {} } });
    await renderApp(<DisputesScreen />);
    mockApi({ 'GET /api/owner/disputes': { body: { items, nextCursor: null } } });
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Rent arrears')).toBeTruthy();
  });
});
