// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportExcel, exportPdf, printHtml } from './export';

const sheets = [
  {
    name: 'Summary',
    rows: [
      ['Month', 'Amount'],
      ['Oct 2026', 1500.5],
      ['Nov 2026', null],
    ],
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('exports', () => {
  it('builds a print view with escaped text and numeric cells', () => {
    const html = printHtml('Report <1>', 'Sub & title', sheets, 'rtl');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('Report &lt;1&gt;');
    expect(html).toContain('Sub &amp; title');
    expect(html).toContain('<td class="num">1500.5</td>');
    expect(html).toContain('<td class="">Oct 2026</td>');
  });
  it('opens the print view in a new window and prints it when loaded', () => {
    const listeners: Record<string, () => void> = {};
    const win = {
      addEventListener: vi.fn((name: string, fn: () => void) => {
        listeners[name] = fn;
      }),
      focus: vi.fn(),
      print: vi.fn(),
    };
    vi.stubGlobal(
      'open',
      vi.fn(() => win),
    );
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
    });
    expect(exportPdf('T', 'S', sheets, 'ltr')).toBe(true);
    listeners['load']?.();
    expect(win.print).toHaveBeenCalledTimes(1);
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    expect(exportPdf('T', 'S', sheets, 'ltr')).toBe(false);
  });
  it('writes an Excel workbook with one sheet per table', async () => {
    const writeFile = vi.fn();
    vi.doMock('xlsx', () => ({
      utils: {
        book_new: () => ({ sheets: [] as string[] }),
        aoa_to_sheet: (rows: unknown[][]) => rows,
        book_append_sheet: (wb: { sheets: string[] }, _ws: unknown, name: string) => {
          wb.sheets.push(name);
        },
      },
      writeFile,
    }));
    await exportExcel('report.xlsx', sheets);
    expect(writeFile).toHaveBeenCalledWith({ sheets: ['Summary'] }, 'report.xlsx');
    vi.doUnmock('xlsx');
  });
});
