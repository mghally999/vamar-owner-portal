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
