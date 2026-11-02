import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking, Text } from 'react-native';
import PhoneScreen from '../../../app/(auth)/index';
import NotRegisteredScreen from '../../../app/(auth)/not-registered';
import OtpScreen from '../../../app/(auth)/otp';
import { useAuth } from '@/lib/auth';
import { mockApi, sent } from '@/test/api';
import { owner } from '@/test/fixtures';
import { confirmation, firebaseAuth } from '@/test/native';
import { renderApp } from '@/test/render';
import { routeState, router } from '@/test/router';

function Stage() {
  return <Text>{`stage:${useAuth().stage}`}</Text>;
}

describe('Phone number', () => {
  async function open() {
    await renderApp(<PhoneScreen />, { signedIn: false });
    return screen.findByLabelText('Mobile number');
  }

  it('keeps the button off until the number is a UAE mobile', async () => {
    const input = await open();
    const send = screen.getByRole('button', { name: 'Send code' });
    expect(send.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(input, '4123');
    expect(
      screen.getByRole('button', { name: 'Send code' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
    await fireEvent.changeText(input, '50 123 4567');
    expect(
      screen.getByRole('button', { name: 'Send code' }).props.accessibilityState,
    ).toMatchObject({ disabled: false });
  });

  it.each([
    ['50 123 4567', '+971501234567'],
    ['0501234567', '+971501234567'],
    ['971 55 123 4567', '+971551234567'],
    ['+971 52 765 4321', '+971527654321'],
  ])('sends the code for %s to %s and opens the code screen', async (typed, e164) => {
    const input = await open();
    await fireEvent.changeText(input, typed);
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/(auth)/otp',
        params: { phone: e164 },
      });
    });
    expect(firebaseAuth.signInWithPhoneNumber).toHaveBeenCalledWith(expect.anything(), e164);
  });

  it('explains the expected format when the keyboard submits a wrong number', async () => {
    const input = await open();
    await fireEvent.changeText(input, '+44 7700 900123');
    await fireEvent(input, 'submitEditing');
    expect(
      screen.getByText('Enter the 9 digits after +971, starting with 5 (for example 50 123 4567).'),
    ).toBeTruthy();
    expect(firebaseAuth.signInWithPhoneNumber).not.toHaveBeenCalled();
  });

  it('says when the code could not be sent', async () => {
    firebaseAuth.signInWithPhoneNumber.mockRejectedValue(new Error('auth/too-many-requests'));
    const input = await open();
    await fireEvent.changeText(input, '501234567');
    await fireEvent(input, 'submitEditing');
    expect(
      await screen.findByText(
        'We could not send the code to this number. Check the number and try again.',
      ),
    ).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('is in Arabic for Arabic', async () => {
    await renderApp(<PhoneScreen />, { lang: 'ar', signedIn: false });
    expect(await screen.findByText('تسجيل الدخول')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إرسال الرمز' })).toBeTruthy();
  });
});

describe('Verification code', () => {
  beforeEach(() => {
    routeState.params = { phone: '+971501234567' };
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  /** Opens the screen and sends a code, as the phone screen did before navigating here. */
  async function open() {
    await renderApp(
      <>
        <Stage />
        <OtpScreen />
      </>,
      { signedIn: false },
    );
    await screen.findByText('stage:anonymous');
    await fireEvent.press(screen.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() => {
      expect(firebaseAuth.signInWithPhoneNumber).toHaveBeenCalledWith(
        expect.anything(),
        '+971501234567',
      );
    });
    return screen.getByLabelText('Enter the code');
  }

  it('names the number the code went to', async () => {
    await open();
    expect(screen.getByText('We sent a 6-digit code to +971501234567.')).toBeTruthy();
  });

  it('accepts digits only, up to six, and verifies as soon as six are in', async () => {
    mockApi({
      'POST /api/auth/owner/exchange': {
        body: { accessToken: 'a', refreshToken: 'r', owner },
      },
      'POST /api/owner/push-token': { body: { ok: true } },
    });
    const input = await open();
    await fireEvent.changeText(input, '12-34');
    expect(screen.getByLabelText('Enter the code').props.value).toBe('1234');
    expect(screen.getByRole('button', { name: 'Verify' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.changeText(input, '1234567');
    expect(await screen.findByText('stage:authenticated')).toBeTruthy();
    expect(confirmation.confirm).toHaveBeenCalledWith('123456');
    expect(sent('POST /api/auth/owner/exchange')).toHaveLength(1);
  });

  it('says a wrong code is wrong and clears it', async () => {
    const input = await open();
    await fireEvent.changeText(input, '000000');
    expect(await screen.findByText('The code is not correct. Try again.')).toBeTruthy();
    expect(screen.getByLabelText('Enter the code').props.value).toBe('');
    expect(screen.getByText('stage:anonymous')).toBeTruthy();
  });

  it('does not verify a short code', async () => {
    const input = await open();
    await fireEvent.changeText(input, '12345');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
    expect(confirmation.confirm).not.toHaveBeenCalled();
  });

  it('sends an unknown number to the not-registered screen', async () => {
    mockApi({
      'POST /api/auth/owner/exchange': {
        status: 403,
        body: { error: { code: 'owner_not_registered', message: 'Unknown' } },
      },
    });
    const input = await open();
    await fireEvent.changeText(input, '123456');
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/(auth)/not-registered');
    });
  });

  it('tries the entered code again with the button', async () => {
    mockApi({
      'POST /api/auth/owner/exchange': {
        status: 403,
        body: { error: { code: 'owner_not_registered', message: 'Unknown' } },
      },
    });
    const input = await open();
    await fireEvent.changeText(input, '123456');
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => {
      expect(sent('POST /api/auth/owner/exchange')).toHaveLength(2);
    });
  });

  it('sends a disabled account to the not-registered screen in its disabled form', async () => {
    mockApi({
      'POST /api/auth/owner/exchange': {
        status: 403,
        body: { error: { code: 'owner_disabled', message: 'Disabled' } },
      },
    });
    const input = await open();
    await fireEvent.changeText(input, '123456');
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/(auth)/not-registered',
        params: { disabled: '1' },
      });
    });
  });

  it('goes back to change the number', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Change number' }));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('does not resend without a number', async () => {
    routeState.params = {};
    await renderApp(<OtpScreen />, { signedIn: false });
    await fireEvent.press(await screen.findByRole('button', { name: 'Send a new code' }));
    expect(firebaseAuth.signInWithPhoneNumber).not.toHaveBeenCalled();
  });
});

describe('Not registered', () => {
  it('explains the app is invite only and offers to call Vamar or try another number', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderApp(<NotRegisteredScreen />, { signedIn: false });
    expect(await screen.findByText('This number is not registered')).toBeTruthy();
    expect(screen.getByText(/property owners managed by Vamar/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Call Vamar' }));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+971505589967');
    await fireEvent.press(screen.getByRole('button', { name: 'Try another number' }));
    expect(router.replace).toHaveBeenCalledWith('/(auth)');
  });

  it('says when the account is disabled', async () => {
    routeState.params = { disabled: '1' };
    await renderApp(<NotRegisteredScreen />, { signedIn: false });
    expect(await screen.findByText('Account disabled')).toBeTruthy();
    expect(
      screen.getByText('Your account is currently disabled. Please contact Vamar.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try another number' })).toBeTruthy();
  });
});
