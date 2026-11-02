import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { todayInDubai } from '@vamar/shared';
import ChequesScreen from '../../../app/(tabs)/cheques';
import { mockApi, sent } from '@/test/api';
import { building, cheque } from '@/test/fixtures';
import { pullToRefresh, renderApp } from '@/test/render';
import { router } from '@/test/router';

const thisMonth = todayInDubai().slice(0, 7);

const page = [
  cheque(),
  cheque({
    id: 'chq-2',
    amountFils: 1_250_000,
    shared: true,
    shareBp: 5_000,
    status: 'bounced',
    tenantName: 'Sara Ali',
    chequeNo: null,
  }),
  cheque({ id: 'chq-3', dueDate: '2026-10-20', status: 'cleared', unitNo: '702' }),
];

beforeEach(() => {
  mockApi({
    'GET /api/owner/buildings': {
      body: { items: [building(), building({ id: 'bld-2', nameEn: 'Al Nada Villa' })] },
    },
    'GET /api/owner/cheques': { body: { items: page, nextCursor: null } },
  });
});

function lastQuery() {
  const all = sent('GET /api/owner/cheques');
  return Object.fromEntries(all[all.length - 1]?.query ?? []);
}

describe('Cheques', () => {
  it("lists this month's cheques grouped by due date", async () => {
    await renderApp(<ChequesScreen />);
    expect(await screen.findByText('5 Oct 2026')).toBeTruthy();
    expect(lastQuery()).toEqual({ month: thisMonth, limit: '50' });
    expect(screen.getByText('20 Oct 2026')).toBeTruthy();
    expect(screen.getAllByText('AED 25,000')).toHaveLength(2);
    expect(screen.getByText('AED 12,500')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 1204 · Ahmed Rahman')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 1204 · Sara Ali')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 702 · Ahmed Rahman')).toBeTruthy();
    expect(screen.getAllByText('Cheque no. 000123')).toHaveLength(2);
    expect(screen.getByText('Cheque no. —')).toBeTruthy();
    expect(screen.getByText('Your share (50%)')).toBeTruthy();
    // The status filter chip and the cheque both say "Bounced".
    expect(screen.getAllByText('Bounced')).toHaveLength(2);
  });

  it('opens a cheque', async () => {
    await renderApp(<ChequesScreen />);
    await fireEvent.press(await screen.findByText('Oasis Tower 1204 · Sara Ali'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/cheque/[id]',
      params: { id: 'chq-2' },
    });
  });

  it('filters by property and by status, and clears the filters again', async () => {
    await renderApp(<ChequesScreen />);
    await screen.findByText('5 Oct 2026');
    const allProperties = screen.getByRole('button', { name: 'All properties' });
    expect(allProperties.props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole('button', { name: 'Al Nada Villa' }));
    await waitFor(() => {
      expect(lastQuery()).toMatchObject({ buildingId: 'bld-2' });
    });
    expect(
      screen.getByRole('button', { name: 'Al Nada Villa' }).props.accessibilityState,
    ).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole('button', { name: 'Cleared' }));
    await waitFor(() => {
      expect(lastQuery()).toMatchObject({ buildingId: 'bld-2', status: 'cleared' });
    });

    await fireEvent.press(screen.getByRole('button', { name: 'All statuses' }));
    await fireEvent.press(screen.getByRole('button', { name: 'All properties' }));
    await waitFor(() => {
      expect(lastQuery()).toEqual({ month: thisMonth, limit: '50' });
    });
  });

  it('moves to the next month', async () => {
    await renderApp(<ChequesScreen />);
    await screen.findByText('5 Oct 2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    const [y, m] = thisMonth.split('-').map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    await waitFor(() => {
      expect(lastQuery()).toMatchObject({ month: next });
    });
  });

  it('loads the next page when the list reaches its end', async () => {
    mockApi({
      'GET /api/owner/cheques': (req) =>
        req.query.get('cursor') === 'p2'
          ? { body: { items: [cheque({ id: 'chq-9', dueDate: '2026-10-30' })], nextCursor: null } }
          : { body: { items: page, nextCursor: 'p2' } },
    });
    await renderApp(<ChequesScreen />);
    await screen.findByText('5 Oct 2026');
    await fireEvent(screen.getByText('5 Oct 2026'), 'endReached');
    expect(await screen.findByText('30 Oct 2026')).toBeTruthy();
    expect(lastQuery()).toMatchObject({ cursor: 'p2' });
  });

  it('reloads when pulled down', async () => {
    await renderApp(<ChequesScreen />);
    await screen.findByText('5 Oct 2026');
    mockApi({
      'GET /api/owner/cheques': {
        body: { items: [cheque({ dueDate: '2026-10-07' })], nextCursor: null },
      },
    });
    await pullToRefresh();
    expect(await screen.findByText('7 Oct 2026')).toBeTruthy();
    expect(screen.queryByText('5 Oct 2026')).toBeNull();
  });

  it('shows placeholders while loading', async () => {
    mockApi({ 'GET /api/owner/cheques': () => new Promise(() => undefined) });
    await renderApp(<ChequesScreen />);
    expect(await screen.findByRole('button', { name: 'All properties' })).toBeTruthy();
    expect(screen.queryByText('No cheques match these filters.')).toBeNull();
    expect(screen.queryByText('AED 25,000')).toBeNull();
  });

  it('says when no cheque matches', async () => {
    mockApi({ 'GET /api/owner/cheques': { body: { items: [], nextCursor: null } } });
    await renderApp(<ChequesScreen />);
    expect(await screen.findByText('No cheques match these filters.')).toBeTruthy();
  });

  it('shows an error with a retry', async () => {
    mockApi({ 'GET /api/owner/cheques': { status: 500, body: {} } });
    await renderApp(<ChequesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(sent('GET /api/owner/cheques')).toHaveLength(2);
    });
  });
});
