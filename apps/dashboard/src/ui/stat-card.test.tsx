// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, configure, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '@/lib/i18n';
import { BarChart } from './bar-chart';
import { StatCard } from './stat-card';

// Typing through user-event is slow on a busy machine; CI finishes in a fraction of this.
configure({ asyncUtilTimeout: 30_000 });
vi.setConfig({ testTimeout: 120_000 });

afterEach(() => {
  cleanup();
});

function renderUi(ui: ReactElement, lang: 'ar' | 'en' = 'en') {
  localStorage.setItem('vamar.lang', lang);
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <LangProvider>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </LangProvider>,
  );
}

describe('StatCard', () => {
  it('shows the amount, the delta against the previous period and links to the list', async () => {
    renderUi(
      <StatCard
        label="Collected"
        fils={1_500_000}
        previousFils={1_000_000}
        to="/cheques"
        search={{ status: 'cleared' }}
        hint="hint"
      />,
    );
    const link = await screen.findByRole('link', { name: /Collected/ });
    expect(link.getAttribute('href')).toBe('/cheques?status=cleared');
    expect(screen.getByText('15,000')).toBeTruthy();
    expect(screen.getByText(/▲ 50%/)).toBeTruthy();
    expect(screen.getByText('hint')).toBeTruthy();
  });
  it('shows a falling delta, the previous value when it was zero, and a dash without data', async () => {
    renderUi(
      <>
        <StatCard label="Down" fils={500} previousFils={1_000} tone="danger" />
        <StatCard label="Flat" fils={500} previousFils={0} />
        <StatCard label="Missing" fils={undefined} tone="hero" />
      </>,
    );
    expect(await screen.findByText(/▼ 50%/)).toBeTruthy();
    expect(screen.getByText(/Previous period: 0/)).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('BarChart', () => {
  it('draws one bar per series and month with a screen-reader table', async () => {
    renderUi(
      <BarChart
        title="Rent and expenses"
        months={['2026-09', '2026-10']}
        series={[
          { key: 'rent', label: 'Rent', values: [400_000, 300_000] },
          { key: 'exp', label: 'Expenses', values: [100_000, 0] },
        ]}
      />,
    );
    const svg = await screen.findByRole('img', { name: 'Rent and expenses' });
    expect(svg.querySelectorAll('rect').length).toBe(4);
    expect(screen.getByRole('table', { name: 'Rent and expenses' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'October 2026' })).toBeTruthy();
  });
  it('labels months in Arabic', async () => {
    renderUi(
      <BarChart
        title="رسم"
        months={['2026-10']}
        series={[{ key: 'a', label: 'أ', values: [1] }]}
      />,
      'ar',
    );
    expect(await screen.findByText('أكتوبر')).toBeTruthy();
  });
});
