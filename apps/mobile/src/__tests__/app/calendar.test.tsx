import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { addDays, formatDate, formatMonth, todayInDubai, type PlainDate } from '@vamar/shared';
import CalendarScreen from '../../../app/calendar';
import WorkOrderDetailScreen from '../../../app/work-order/[id]';
import WorkOrdersScreen from '../../../app/work-orders';
import { mockApi, sent } from '@/test/api';
import { calendarItem, workOrder, workOrderDetail } from '@/test/fixtures';
import { pullToRefresh, renderApp } from '@/test/render';
import { routeState, router } from '@/test/router';

const today = todayInDubai();
const inMonth = (day: number) =>
  `${today.slice(0, 7)}-${String(day).padStart(2, '0')}` as PlainDate;

const items = [
  calendarItem({ date: inMonth(5), endDate: inMonth(5) }),
  calendarItem({
    kind: 'hearing',
    id: 'hearing:dsp-1',
    date: inMonth(12),
    endDate: inMonth(12),
    titleEn: 'Hearing D-2026-0002 (100200) · Oasis Tower 1204',
    titleAr: 'جلسة',
    entityType: 'dispute',
    entityId: 'dsp-1',
    amountFils: null,
  }),
  calendarItem({
    kind: 'work_order',
    id: 'work-order:wo-1',
    date: inMonth(12),
    endDate: inMonth(12),
    titleEn: 'Annual fire system inspection · Oasis Tower',
    titleAr: 'فحص',
    entityType: 'work_order',
    entityId: 'wo-1',
    amountFils: null,
  }),
  calendarItem({
    kind: 'event',
    id: 'event:ev-1',
    date: inMonth(20),
    endDate: inMonth(20),
    titleEn: 'Owners meeting',
    titleAr: 'اجتماع',
    entityType: 'calendar_event',
    entityId: 'ev-1',
    amountFils: null,
    allDay: false,
    time: '18:00',
  }),
  calendarItem({
    kind: 'holiday',
    id: 'holiday:x',
    date: inMonth(2),
    endDate: inMonth(2),
    titleEn: 'National Day',
    titleAr: 'اليوم الوطني',
    entityType: 'holiday',
    entityId: inMonth(2),
    amountFils: null,
  }),
];

function lastRange() {
  const all = sent('GET /api/owner/calendar');
  return Object.fromEntries(all[all.length - 1]?.query ?? []);
}

beforeEach(() => {
  mockApi({
    'GET /api/owner/calendar': { body: { items, holidays: [inMonth(2)] } },
    'GET /api/owner/me': {
      body: {
        id: 'owner-1',
        settings: {
          weekStart: 'monday',
          hijriDisplay: true,
          showBeforeFeeLabel: true,
          ownersSeeInvoiceFiles: true,
        },
      },
    },
  });
});

describe('Calendar', () => {
  it("opens on today's month with dots, the legend, the Hijri line and the day's items", async () => {
    await renderApp(<CalendarScreen />);
    expect(await screen.findByText(formatMonth(today, 'en'))).toBeTruthy();
    expect(screen.getByText(/1448|1447/)).toBeTruthy();
    const range = lastRange();
    expect(range.from! <= today && range.to! >= today).toBe(true);
    expect(screen.getByText('5 items')).toBeTruthy();
    expect(screen.getByText('Legend')).toBeTruthy();
    expect(screen.getByText('Cheque due')).toBeTruthy();
    expect(screen.getAllByText('Holiday').length).toBeGreaterThan(0);
    // Tap the 12th: two items that day.
    await fireEvent.press(screen.getByLabelText(new RegExp(`^12 .*2 items`)));
    expect(await screen.findByText('Hearing D-2026-0002 (100200) · Oasis Tower 1204')).toBeTruthy();
    expect(screen.getByText('Annual fire system inspection · Oasis Tower')).toBeTruthy();
    await fireEvent.press(screen.getByText('Hearing D-2026-0002 (100200) · Oasis Tower 1204'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/dispute/[id]',
      params: { id: 'dsp-1' },
    });
    await fireEvent.press(screen.getByText('Annual fire system inspection · Oasis Tower'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/work-order/[id]',
      params: { id: 'wo-1' },
    });
  });

  it('moves months with the arrows, jumps to a month, and comes back with Today', async () => {
    await renderApp(<CalendarScreen />);
    await screen.findByText(formatMonth(today, 'en'));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    const [y, m] = today.split('-').map(Number) as [number, number];
    const next =
      `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01` as PlainDate;
    expect(await screen.findByText(formatMonth(next, 'en'))).toBeTruthy();
    await waitFor(() => {
      expect(lastRange().to! >= next).toBe(true);
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Jump to a month or year' }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Jan/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(`January ${y}`)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText(formatMonth(today, 'en'))).toBeTruthy();
  });

  it('shows a year of mini months, a week, and an agenda', async () => {
    await renderApp(<CalendarScreen />);
    await screen.findByText(formatMonth(today, 'en'));
    await fireEvent.press(screen.getByRole('tab', { name: 'Year' }));
    expect(await screen.findByText(today.slice(0, 4))).toBeTruthy();
    await waitFor(() => {
      expect(lastRange()).toEqual({
        from: `${today.slice(0, 4)}-01-01`,
        to: `${today.slice(0, 4)}-12-31`,
      });
    });
    await fireEvent.press(screen.getByRole('button', { name: 'December' }));
    expect(await screen.findByText(`December ${today.slice(0, 4)}`)).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Week' }));
    await waitFor(() => {
      const r = lastRange();
      expect(r.from! <= r.to!).toBe(true);
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Agenda' }));
    expect(await screen.findByText('Owners meeting')).toBeTruthy();
    expect(screen.getByText('Event · 18:00')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(lastRange().from).toBe(addDays(today, -60));
    });
  });

  it('says when a day is empty, shows the error state, and reads in Arabic', async () => {
    await renderApp(<CalendarScreen />);
    await screen.findByText(formatMonth(today, 'en'));
    await fireEvent.press(screen.getByLabelText(formatDate(inMonth(3), 'en')));
    expect(await screen.findByText('Nothing on this day.')).toBeTruthy();
    mockApi({ 'GET /api/owner/calendar': { status: 500, body: {} } });
    await renderApp(<CalendarScreen />, { lang: 'ar' });
    expect(await screen.findByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    expect(screen.getByText(formatMonth(today, 'ar'))).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'سنة' })).toBeTruthy();
  });
});

describe('Maintenance', () => {
  beforeEach(() => {
    mockApi({
      'GET /api/owner/work-orders': {
        body: {
          items: [
            workOrder(),
            workOrder({
              id: 'wo-2',
              titleEn: 'Repaint corridor',
              status: 'open',
              priority: 'low',
              completedAt: null,
              scheduledFor: null,
              unitId: null,
              unitNo: null,
              expenseId: null,
              photoCount: 0,
            }),
          ],
          nextCursor: null,
        },
      },
    });
  });

  it('lists the jobs with status, place, dates and photos, and opens one', async () => {
    await renderApp(<WorkOrdersScreen />);
    expect(await screen.findByText('AC not cooling')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 1204 · Urgent')).toBeTruthy();
    expect(screen.getByText(/^Completed /)).toBeTruthy();
    expect(screen.getByText('3 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Photos 2')).toBeTruthy();
    expect(screen.getByText('Repaint corridor')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText(/^Reported /)).toBeTruthy();
    await fireEvent.press(screen.getByText('Repaint corridor'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/work-order/[id]',
      params: { id: 'wo-2' },
    });
    await pullToRefresh();
    expect(sent('GET /api/owner/work-orders').length).toBeGreaterThan(1);
  });

  it('says when there are none and shows the error state', async () => {
    mockApi({ 'GET /api/owner/work-orders': { body: { items: [], nextCursor: null } } });
    await renderApp(<WorkOrdersScreen />);
    expect(await screen.findByText('No maintenance jobs on your units.')).toBeTruthy();
    mockApi({ 'GET /api/owner/work-orders': { status: 500, body: {} } });
    await renderApp(<WorkOrdersScreen />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows one job with its photos and the invoice, and opens the invoice', async () => {
    routeState.params = { id: 'wo-1' };
    mockApi({ 'GET /api/owner/work-orders/wo-1': { body: workOrderDetail() } });
    await renderApp(<WorkOrderDetailScreen />);
    expect(await screen.findByText('AC not cooling')).toBeTruthy();
    expect(screen.getByText('Compressor replaced.')).toBeTruthy();
    expect(screen.getByText('1 Oct 2026')).toBeTruthy();
    expect(screen.getByText('2 Oct 2026')).toBeTruthy();
    expect(screen.getByText('3 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Cool Breeze AC Services')).toBeTruthy();
    expect(screen.getByText('Urgent')).toBeTruthy();
    expect(screen.getByText('AED 3,307.50')).toBeTruthy();
    expect(screen.getByLabelText('ac-before.jpg')).toBeTruthy();
    expect(screen.getByLabelText('ac-after.jpg')).toBeTruthy();
    await fireEvent.press(screen.getByText('Cost (invoice)'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/expense/[id]',
      params: { id: 'exp-1' },
    });
    mockApi({
      'GET /api/owner/work-orders/wo-1': {
        body: workOrderDetail({ attachments: [], expenseId: null }),
      },
    });
    await renderApp(<WorkOrderDetailScreen />);
    expect(await screen.findByText('No photos yet.')).toBeTruthy();
  });
});
