// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ResponsiveTable } from './responsive-table';

afterEach(cleanup);

function Cheques({ rows }: { rows: [string, string][] }) {
  return (
    <ResponsiveTable className="w-full md:min-w-[900px]">
      <thead>
        <tr>
          <th>Unit</th>
          <th>Amount</th>
          <th>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([unit, amount]) => (
          <tr key={unit}>
            <td>{unit}</td>
            <td>{amount}</td>
            <td>
              <button type="button">Open</button>
            </td>
          </tr>
        ))}
      </tbody>
    </ResponsiveTable>
  );
}

describe('ResponsiveTable', () => {
  it('labels every cell with its column header for the narrow-screen card layout', () => {
    const { container } = render(
      <Cheques
        rows={[
          ['Al Noor Tower 801', 'AED 15,750'],
          ['Al Safa 101', 'AED 8,333'],
        ]}
      />,
    );
    const table = container.querySelector('table');
    expect(table?.className).toContain('card-table');
    const labels = Array.from(container.querySelectorAll('tbody td')).map(
      (td) => (td as HTMLElement).dataset['label'],
    );
    expect(labels).toEqual(['Unit', 'Amount', 'Actions', 'Unit', 'Amount', 'Actions']);
  });

  it('labels rows added after the first render', () => {
    function Growing() {
      const [rows, setRows] = useState<[string, string][]>([['A 1', 'AED 1']]);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setRows([...rows, ['B 2', 'AED 2']]);
            }}
          >
            more
          </button>
          <Cheques rows={rows} />
        </>
      );
    }
    const { container, getByText } = render(<Growing />);
    getByText('more').click();
    return Promise.resolve().then(() => {
      const last = container.querySelectorAll('tbody tr')[1];
      expect((last?.children[1] as HTMLElement | undefined)?.dataset['label']).toBe('Amount');
    });
  });

  it('stays an accessible table', async () => {
    const { container } = render(<Cheques rows={[['A 1', 'AED 1']]} />);
    const result = await axe.run(container);
    expect(result.violations).toEqual([]);
  });
});
