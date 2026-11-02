import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking, Text } from 'react-native';
import { todayInDubai } from '@vamar/shared';
import SettingsScreen from '../../../app/settings';
import { API_BASE } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getItem, setItem } from '@/lib/storage';
import { mockApi, sent } from '@/test/api';
import { cheque, deviceItem } from '@/test/fixtures';
import { application, localAuth, notifications, print, sharing, updates } from '@/test/native';
import { renderApp } from '@/test/render';

const today = todayInDubai();
const year = today.slice(0, 4);

function Stage() {
  return <Text>{`stage:${useAuth().stage}`}</Text>;
}

async function open(lang: 'ar' | 'en' = 'en') {
  const result = await renderApp(
    <>
      <Stage />
      <SettingsScreen />
    </>,
    { lang },
  );
  await screen.findByText('stage:authenticated');
  return result;
}

beforeEach(() => {
  mockApi({
    'GET /api/auth/owner/devices': {
      body: {
        items: [
          deviceItem(),
          deviceItem({ id: 'dev-2', model: '', platform: 'ios', current: false }),
          deviceItem({ id: 'dev-3', model: 'Old phone', revokedAt: '2026-10-01T00:00:00Z' }),
        ],
      },
    },
    'PATCH /api/owner/me': { body: { ok: true } },
    'POST /api/auth/owner/logout': { body: { ok: true } },
    'DELETE /api/owner/push-token': { body: { ok: true } },
  });
});

describe('Settings', () => {
  it('shows the owner, the signed-in devices and the app version', async () => {
    await open();
    expect(await screen.findByText('Salem Al Kaabi')).toBeTruthy();
    expect(await screen.findByText('Pixel 8')).toBeTruthy();
    expect(screen.getByText('This device')).toBeTruthy();
    // A device without a model name is shown by its platform; revoked devices are hidden.
    expect(screen.getByText('ios')).toBeTruthy();
    expect(screen.queryByText('Old phone')).toBeNull();
    expect(screen.getAllByText('20 Oct 2026')).toHaveLength(2);
    expect(screen.getByText('Vamar Owner Portal · Version 1.4.0')).toBeTruthy();
  });

  it('shows the Arabic name in Arabic and a fallback version', async () => {
    application.nativeApplicationVersion = null;
    await open('ar');
    expect(await screen.findByText('سالم الكعبي')).toBeTruthy();
    expect(screen.getByText(/0\.1\.0/)).toBeTruthy();
  });

  it('switches the language, tells the API and reloads the app', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'English' }));
    expect(sent('PATCH /api/owner/me')).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: 'العربية' }));
    await waitFor(() => {
      expect(sent('PATCH /api/owner/me')[0]?.body).toEqual({ preferredLang: 'ar' });
    });
    expect(await getItem('lang')).toBe('ar');
    expect(updates.reloadAsync).toHaveBeenCalled();
  });

  it('switches the theme and remembers it', async () => {
    await open();
    const white = screen.getByRole('button', { name: 'White' });
    expect(white.props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(white);
    expect(screen.getByRole('button', { name: 'White' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByRole('button', { name: 'Default' }).props.accessibilityState).toMatchObject({
      selected: false,
    });
    expect(await getItem('theme')).toBe('white');
  });

  it('explains why notifications are not reaching the phone, and turns them off', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await setItem('pushState', 'denied');
    await open();
    const [notificationsSwitch] = screen.getAllByRole('switch');
    expect(notificationsSwitch?.props.value).toBe(true);
    expect(
      await screen.findByText(
        'Allow notifications for Vamar in the phone settings to receive alerts.',
      ),
    ).toBeTruthy();

    await fireEvent(notificationsSwitch!, 'valueChange', false);
    await waitFor(() => {
      expect(sent('DELETE /api/owner/push-token')).toHaveLength(1);
    });
    expect(await getItem('notifications')).toBe('0');
    expect(screen.queryByText(/Allow notifications/)).toBeNull();
  });

  it('turns notifications back on and registers the phone', async () => {
    await setItem('notifications', '0');
    await open();
    const [notificationsSwitch] = screen.getAllByRole('switch');
    await waitFor(() => {
      expect(notificationsSwitch?.props.value).toBe(false);
    });
    await fireEvent(notificationsSwitch!, 'valueChange', true);
    await waitFor(() => {
      expect(sent('POST /api/owner/push-token').length).toBeGreaterThan(0);
    });
    expect(await getItem('notifications')).toBe('1');
    await waitFor(async () => {
      expect(await getItem('pushState')).toBe('registered');
    });
    expect(screen.queryByText('Switched off.')).toBeNull();
  });

  it('offers the biometric lock only where the phone supports it', async () => {
    await open();
    const lock = screen.getAllByRole('switch')[1];
    expect(lock?.props.disabled).toBe(true);
  });

  it('turns the biometric lock on after a successful check', async () => {
    localAuth.hasHardwareAsync.mockResolvedValue(true);
    await open();
    const lock = screen.getAllByRole('switch')[1]!;
    await waitFor(() => {
      expect(lock.props.disabled).toBe(false);
    });
    await fireEvent(lock, 'valueChange', true);
    await waitFor(async () => {
      expect(await getItem('biometrics')).toBe('1');
    });
    expect(localAuth.authenticateAsync).toHaveBeenCalled();
  });

  it("shares this month's statement as a PDF", async () => {
    mockApi({
      'GET /api/owner/cheques': {
        body: { items: [cheque(), cheque({ id: 'b', status: 'cleared' })], nextCursor: null },
      },
    });
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'This month (PDF)' }));
    await waitFor(() => {
      expect(sharing.shareAsync).toHaveBeenCalled();
    });
    const [req] = sent('GET /api/owner/cheques');
    expect(req?.query.get('month')).toBe(today.slice(0, 7));
    expect(req?.query.get('limit')).toBe('100');
    const html = print.printToFileAsync.mock.calls[0]?.[0].html ?? '';
    expect(html).toContain('Salem Al Kaabi');
    expect(html).toContain('Cheques: 2');
    // Ready for another statement once the share sheet is open.
    expect(screen.getByRole('button', { name: 'This month (PDF)' })).toBeTruthy();
  });

  it("shares this year's statement with only this year's cheques", async () => {
    mockApi({
      'GET /api/owner/cheques': {
        body: {
          items: [
            cheque({ dueDate: `${year}-02-01` }),
            cheque({ id: 'old', dueDate: `${Number(year) - 1}-12-01` }),
          ],
          nextCursor: null,
        },
      },
    });
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'This year (PDF)' }));
    await waitFor(() => {
      expect(sharing.shareAsync).toHaveBeenCalled();
    });
    expect(sent('GET /api/owner/cheques')[0]?.query.has('month')).toBe(false);
    const html = print.printToFileAsync.mock.calls[0]?.[0].html ?? '';
    expect(html).toContain(`Salem Al Kaabi · ${year}`);
    expect(html).toContain('Cheques: 1');
  });

  it('signs out the other devices', async () => {
    mockApi({ 'POST /api/auth/owner/devices/revoke-others': { body: { ok: true } } });
    await open();
    await screen.findByText('Pixel 8');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out other devices' }));
    await waitFor(() => {
      expect(sent('POST /api/auth/owner/devices/revoke-others')).toHaveLength(1);
    });
    await waitFor(() => {
      expect(sent('GET /api/auth/owner/devices')).toHaveLength(2);
    });
  });

  it('opens the privacy policy', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Privacy policy' }));
    expect(Linking.openURL).toHaveBeenCalledWith(`${API_BASE}/privacy`);
  });

  it('signs out', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('stage:anonymous')).toBeTruthy();
    expect(sent('POST /api/auth/owner/logout')).toHaveLength(1);
  });

  it('asks for confirmation before requesting deletion, and can be cancelled', async () => {
    await open();
    expect(
      screen.getByText(
        'Your account will be disabled immediately and Vamar will delete your data within 30 days.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Request account deletion' }));
    expect(screen.getByRole('button', { name: 'Request deletion' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Request deletion' })).toBeNull();
    expect(sent('POST /api/owner/account/delete-request')).toHaveLength(0);
  });

  it('requests deletion and then signs out', async () => {
    mockApi({ 'POST /api/owner/account/delete-request': { body: { ok: true } } });
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Request account deletion' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Request deletion' }));
    expect(await screen.findByText('stage:anonymous')).toBeTruthy();
    expect(sent('POST /api/owner/account/delete-request')[0]?.body).toEqual({ reason: '' });
  });
});
