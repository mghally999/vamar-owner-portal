import { renderHook } from '@testing-library/react-native';
import { usePushNavigation } from '@/lib/push';
import { pushResponses } from '@/test/native';

const response = (data: unknown) => ({ notification: { request: { content: { data } } } });

describe('opening the screen behind a tapped notification', () => {
  it('opens the notification that launched the app, then every tapped one, and stops when unmounted', async () => {
    const navigate = jest.fn();
    pushResponses.last = response({ type: 'hearing_soon', entityId: 'd1' });
    const { unmount } = await renderHook(() => {
      usePushNavigation(navigate, true);
    });
    expect(navigate).toHaveBeenCalledWith({ pathname: '/dispute/[id]', params: { id: 'd1' } });
    expect(pushResponses.listeners).toHaveLength(1);
    pushResponses.listeners[0]!(response({ type: 'large_expense', entityId: 'x1' }));
    expect(navigate).toHaveBeenLastCalledWith({ pathname: '/expense/[id]', params: { id: 'x1' } });
    await unmount();
    expect(pushResponses.listeners).toHaveLength(0);
  });

  it('opens the month a monthly summary names, with its statement, however late it is tapped', async () => {
    const navigate = jest.fn();
    pushResponses.last = response({
      type: 'monthly_summary',
      entityId: 'o1',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    await renderHook(() => {
      usePushNavigation(navigate, true);
    });
    expect(navigate).toHaveBeenCalledWith({
      pathname: '/(tabs)',
      params: { from: '2026-10-01', to: '2026-10-31', statement: '1' },
    });
    // A push from before the payload carried the month: last month, still with the statement.
    pushResponses.listeners[0]!(response({ type: 'monthly_summary', entityId: 'o1' }));
    expect(navigate).toHaveBeenLastCalledWith({
      pathname: '/(tabs)',
      params: { preset: 'last_month', statement: '1' },
    });
    // Dates that are not dates, or the wrong way round, count as missing.
    pushResponses.listeners[0]!(
      response({ type: 'monthly_summary', entityId: 'o1', from: '2026-10-31', to: '2026-10-01' }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      pathname: '/(tabs)',
      params: { preset: 'last_month', statement: '1' },
    });
    pushResponses.listeners[0]!(
      response({ type: 'monthly_summary', entityId: 'o1', from: '2026-13-01', to: 7 }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      pathname: '/(tabs)',
      params: { preset: 'last_month', statement: '1' },
    });
  });

  it('listens for nothing while the owner is signed out', async () => {
    const navigate = jest.fn();
    pushResponses.last = response({ type: 'hearing_soon', entityId: 'd1' });
    await renderHook(() => {
      usePushNavigation(navigate, false);
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(pushResponses.listeners).toHaveLength(0);
  });
});
