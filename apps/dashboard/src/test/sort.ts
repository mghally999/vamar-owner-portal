/**
 * Clicks a sortable column header twice and checks the list asked the API for that column,
 * ascending then descending, with aria-sort following.
 */
import { screen, within } from '@testing-library/react';
import { expect, vi } from 'vitest';
import type { MockApi } from './api';

export async function expectSortsBy(
  user: { click: (el: Element) => Promise<void> },
  api: MockApi,
  path: string,
  header: string | RegExp,
  column: string,
): Promise<void> {
  for (const [dir, aria] of [
    ['asc', 'ascending'],
    ['desc', 'descending'],
  ] as const) {
    const th = await screen.findByRole('columnheader', { name: header });
    await user.click(within(th).getByRole('button'));
    await vi.waitFor(() => {
      expect(api.last('GET', path).query).toMatchObject({ sort: column, dir });
    });
    // The table is drawn again for the new order; read the header afresh.
    expect(
      (await screen.findByRole('columnheader', { name: header })).getAttribute('aria-sort'),
    ).toBe(aria);
  }
}
