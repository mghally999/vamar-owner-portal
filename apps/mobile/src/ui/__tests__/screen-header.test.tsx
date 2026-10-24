import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { LangProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';
import { ScreenHeader } from '../screen-header';

const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  getItem: (key: string) => Promise.resolve(mockStore.get(key) ?? null),
  setItem: (key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  },
}));
jest.mock('expo-updates', () => ({ reloadAsync: () => Promise.resolve() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children,
}));

async function renderIn(lang: 'ar' | 'en', ui: ReactNode) {
  mockStore.set('lang', lang);
  return await render(
    <ThemeProvider>
      <LangProvider>{ui}</LangProvider>
    </ThemeProvider>,
  );
}

describe('ScreenHeader', () => {
  it('tab screens: the title and the settings button, no back button', async () => {
    await renderIn('en', <ScreenHeader title="Home" />);
    expect(await screen.findByRole('header', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('stack screens: a back button that goes back, and no settings button', async () => {
    const onBack = jest.fn();
    await renderIn('ar', <ScreenHeader title="الشيك" onBack={onBack} showSettings={false} />);
    expect(await screen.findByRole('header', { name: 'الشيك' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'رجوع' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'الإعدادات' })).toBeNull();
  });

  it('a stack screen opened with nothing behind it shows no back button', async () => {
    await renderIn('en', <ScreenHeader title="Cheque" onBack={undefined} showSettings={false} />);
    expect(await screen.findByRole('header', { name: 'Cheque' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });
});
