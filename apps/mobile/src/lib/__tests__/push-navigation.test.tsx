import { renderHook, waitFor } from '@testing-library/react-native';
import { usePushNavigation, usePushUpdates } from '@/lib/push';
import { mockApi, sent } from '@/test/api';
import { notifications, pushResponses } from '@/test/native';

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

  it('opens the launch notification once: not again after a reload or the next sign-in', async () => {
    const navigate = jest.fn();
    const tap = {
      notification: {
        request: { identifier: 'n-1', content: { data: { type: 'hearing_soon', entityId: 'd1' } } },
      },
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    };
    pushResponses.last = tap;
    const first = await renderHook(
      ({ on }: { on: boolean }) => {
        usePushNavigation(navigate, on);
      },
      { initialProps: { on: true } },
    );
    // The same tap reported again by the listener is not opened twice.
    pushResponses.listeners[0]!(tap);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
    expect(pushResponses.last).toBeNull();
    // Signed out and in again (or reloaded): nothing left to open.
    await first.rerender({ on: false });
    await first.rerender({ on: true });
    expect(navigate).toHaveBeenCalledTimes(1);
    // A new tap still opens.
    pushResponses.listeners[0]!({
      notification: {
        request: { identifier: 'n-2', content: { data: { type: 'large_expense', entityId: 'x' } } },
      },
    });
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('keeps working on a phone whose native module cannot clear the launch tap', async () => {
    notifications.clearLastNotificationResponse.mockImplementation(() => {
      throw new Error('not available');
    });
    const navigate = jest.fn();
    pushResponses.last = response({ type: 'new_device_login' });
    await renderHook(() => {
      usePushNavigation(navigate, true);
    });
    expect(navigate).toHaveBeenCalledWith('/settings');
  });
});

describe('notifications while the app is open', () => {
  it('refreshes what an arriving notification is about, and nothing for an unknown one', async () => {
    const refresh = jest.fn();
    const { unmount } = await renderHook(() => {
      usePushUpdates(refresh, true);
    });
    pushResponses.received[0]!({
      request: { content: { data: { type: 'message_reply', entityId: 'm1' } } },
    });
    expect(refresh).toHaveBeenCalledWith([['messages']]);
    pushResponses.received[0]!({ request: { content: { data: { type: 'unknown' } } } });
    expect(refresh).toHaveBeenCalledTimes(1);
    await unmount();
    expect(pushResponses.received).toHaveLength(0);
    expect(pushResponses.tokens).toHaveLength(0);
  });

  it('registers a new push token as soon as the phone hands one out', async () => {
    mockApi({ 'POST /api/owner/push-token': { body: { ok: true } } });
    notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[new]' });
    await renderHook(() => {
      usePushUpdates(jest.fn(), true);
    });
    pushResponses.tokens[0]!({ data: 'fcm-new', type: 'android' });
    await waitFor(() => {
      expect(sent('POST /api/owner/push-token')[0]?.body).toMatchObject({
        pushToken: 'ExponentPushToken[new]',
      });
    });
    // Without asking for permission.
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('registers each new token once, so its own announcement does not loop', async () => {
    // Every registration asks for the token, and the library then announces that same token as
    // new: reacting to it again registered without end.
    mockApi({ 'POST /api/owner/push-token': { body: { ok: true } } });
    await renderHook(() => {
      usePushUpdates(jest.fn(), true);
    });
    const announce = (data: string) => {
      pushResponses.tokens[0]!({ data, type: 'android' });
    };
    announce('fcm-2');
    await waitFor(() => {
      expect(sent('POST /api/owner/push-token')).toHaveLength(1);
    });
    announce('fcm-2'); // the echo of that registration
    announce('fcm-2');
    await new Promise((r) => setTimeout(r, 50));
    expect(sent('POST /api/owner/push-token')).toHaveLength(1);
    announce('fcm-3'); // a real rotation
    await waitFor(() => {
      expect(sent('POST /api/owner/push-token')).toHaveLength(2);
    });
  });

  it('listens to nothing while signed out', async () => {
    await renderHook(() => {
      usePushUpdates(jest.fn(), false);
    });
    expect(pushResponses.received).toHaveLength(0);
    expect(pushResponses.tokens).toHaveLength(0);
  });
});
