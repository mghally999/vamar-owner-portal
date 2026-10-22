import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { LangProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';
import { Amount, ErrorState, StatusChip } from '..';
import { MonthSwitcher } from '../month-switcher';

const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  getItem: (key: string) => Promise.resolve(mockStore.get(key) ?? null),
  setItem: (key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  },
}));
jest.mock('expo-updates', () => ({ reloadAsync: () => Promise.resolve() }));

async function renderIn(lang: 'ar' | 'en', ui: ReactNode) {
  mockStore.set('lang', lang);
  return await render(
    <ThemeProvider>
      <LangProvider>{ui}</LangProvider>
    </ThemeProvider>,
  );
}

describe('owner app UI', () => {
  it('shows an amount with the currency in each language', async () => {
    await renderIn('en', <Amount fils={1_250_050} />);
    expect(await screen.findByText('AED')).toBeTruthy();
    expect(screen.getByText('12,500.50')).toBeTruthy();
  });

  it('shows the Arabic currency and a dash for a missing amount', async () => {
    await renderIn(
      'ar',
      <>
        <Amount fils={1_250_000} />
        <Amount fils={null} />
      </>,
    );
    expect(await screen.findByText('درهم')).toBeTruthy();
    expect(screen.getByText('12,500')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('labels cheque statuses', async () => {
    await renderIn('en', <StatusChip status="bounced" />);
    expect(await screen.findByText('Bounced')).toBeTruthy();
  });

  it('moves a month back and forward', async () => {
    const onChange = jest.fn();
    await renderIn('en', <MonthSwitcher value="2026-01-01" onChange={onChange} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Previous month' }));
    expect(onChange).toHaveBeenLastCalledWith('2025-12-01');
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-02-01');
  });

  it('offers a retry on the error state', async () => {
    const onRetry = jest.fn();
    await renderIn('en', <ErrorState onRetry={onRetry} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
