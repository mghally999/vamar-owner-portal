import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { status, themes } from '@vamar/tokens';
import { getItem, setItem } from '@/lib/storage';
import { statusColors, ThemeProvider, useTheme, useThemeChoice } from '@/lib/theme';

const mockScheme = { current: 'light' as 'light' | 'dark' | null };
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme.current,
}));

beforeEach(() => {
  mockScheme.current = 'light';
});

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function useBoth() {
  return { choice: useThemeChoice(), theme: useTheme() };
}

describe('theme', () => {
  it('starts on the default theme and becomes ready', async () => {
    const { result } = await renderHook(useBoth, { wrapper });
    await waitFor(() => {
      expect(result.current.choice.ready).toBe(true);
    });
    expect(result.current.choice.name).toBe('default');
    expect(result.current.theme.scheme).toBe('light');
    expect(result.current.theme.colors).toEqual({ ...themes.default, silver: '#c4c6be' });
  });

  it('restores the saved theme and ignores an unknown value', async () => {
    await setItem('theme', 'white');
    const { result, unmount } = await renderHook(useBoth, { wrapper });
    await waitFor(() => {
      expect(result.current.choice.name).toBe('white');
    });
    expect(result.current.theme.colors.bg).toBe(themes.white.bg);
    await unmount();

    await setItem('theme', 'neon');
    const second = await renderHook(useBoth, { wrapper });
    await waitFor(() => {
      expect(second.result.current.choice.ready).toBe(true);
    });
    expect(second.result.current.choice.name).toBe('default');
  });

  it('remembers the owner choice', async () => {
    const { result } = await renderHook(useBoth, { wrapper });
    await act(() => result.current.choice.setName('white'));
    expect(result.current.choice.name).toBe('white');
    expect(await getItem('theme')).toBe('white');
  });

  it('uses the dark palette whenever the phone is in dark mode', async () => {
    mockScheme.current = 'dark';
    await setItem('theme', 'white');
    const { result } = await renderHook(useBoth, { wrapper });
    await waitFor(() => {
      expect(result.current.choice.name).toBe('white');
    });
    expect(result.current.theme.scheme).toBe('dark');
    expect(result.current.theme.colors.bg).toBe(themes.dark.bg);
  });

  it('falls back to the default theme outside the provider', async () => {
    mockScheme.current = null;
    const { result } = await renderHook(() => useTheme());
    expect(result.current.name).toBe('default');
    expect(result.current.scheme).toBe('light');
  });

  it('refuses the theme choice outside the provider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useThemeChoice())).rejects.toThrow(
      'useThemeChoice outside ThemeProvider',
    );
  });

  it('picks the status colours for the scheme', async () => {
    const light = await renderHook(() => useTheme());
    expect(statusColors(light.result.current, 'bounced')).toEqual({
      fg: status.bounced.fg,
      bg: status.bounced.bg,
    });
    mockScheme.current = 'dark';
    const dark = await renderHook(() => useTheme());
    expect(statusColors(dark.result.current, 'bounced')).toEqual({
      fg: status.bounced.fgOnDark,
      bg: status.bounced.bgOnDark,
    });
  });
});
