import { act, render, screen } from '@testing-library/react-native';
import { setAccessToken } from '@/lib/api';
import { setItem } from '@/lib/storage';
import { AuthImage } from '@/ui/auth-image';
import { mockApi, sent } from '@/test/api';

function propsOf(label: string): string {
  return JSON.stringify(screen.getByLabelText(label).props);
}

async function fail(label: string) {
  await act(async () => {
    (screen.getByLabelText(label).props.onError as (e: unknown) => void)({
      nativeEvent: { error: 'HTTP 401' },
    });
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('images behind the session', () => {
  it('refreshes an expired token once and loads the picture again', async () => {
    await setItem('refreshToken', 'refresh-1');
    mockApi({
      'POST /api/auth/owner/refresh': {
        body: { accessToken: 'access-2', refreshToken: 'refresh-2', refreshExpiresAt: '' },
      },
    });
    setAccessToken('access-1');
    await render(<AuthImage uri="https://api/x.jpg" style={{}} accessibilityLabel="Scan" />);
    expect(propsOf('Scan')).toContain('Bearer access-1');
    await fail('Scan');
    expect(sent('POST /api/auth/owner/refresh')).toHaveLength(1);
    expect(propsOf('Scan')).toContain('Bearer access-2');
    // A second failure (a missing picture) does not loop.
    await fail('Scan');
    expect(sent('POST /api/auth/owner/refresh')).toHaveLength(1);
  });

  it('keeps the picture as it is when the session cannot be refreshed', async () => {
    setAccessToken('access-1');
    await render(<AuthImage uri="https://api/x.jpg" style={{}} accessibilityLabel="Scan" />);
    await fail('Scan');
    expect(propsOf('Scan')).toContain('Bearer access-1');
  });
});
