/**
 * Report exports done in the browser: Excel through SheetJS (loaded on demand, like the import
 * page) and PDF through a print view (the browser's own Arabic shaping and fonts, "Save as PDF"
 * in the print dialog).
 */
export interface ExportSheet {
  name: string;
  /** First row is the header. */
  rows: (string | number | null)[][];
}

export async function exportExcel(fileName: string, sheets: ExportSheet[]): Promise<void> {
  const xlsx = await import('xlsx');
  const wb = xlsx.utils.book_new();
  for (const s of sheets) {
    const ws = xlsx.utils.aoa_to_sheet(s.rows);
    xlsx.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  xlsx.writeFile(wb, fileName);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** The print view's HTML: a title, a subtitle, and one table per sheet. */
export function printHtml(
  title: string,
  subtitle: string,
  sheets: ExportSheet[],
  dir: 'rtl' | 'ltr',
): string {
  const tables = sheets
    .map((s) => {
      const [head = [], ...body] = s.rows;
      return `<h2>${escapeHtml(s.name)}</h2><table><thead><tr>${head
        .map((c) => `<th>${escapeHtml(String(c ?? ''))}</th>`)
        .join('')}</tr></thead><tbody>${body
        .map(
          (r) =>
            `<tr>${r
              .map(
                (c) =>
                  `<td class="${typeof c === 'number' ? 'num' : ''}">${escapeHtml(String(c ?? ''))}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')}</tbody></table>`;
    })
    .join('');
  return `<!doctype html><html lang="${dir === 'rtl' ? 'ar' : 'en'}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{font-family:Almarai,Arial,sans-serif;color:#25323a;margin:24px;font-size:13px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 8px}
p.sub{color:#5e676c;margin:0 0 12px}
table{border-collapse:collapse;width:100%;page-break-inside:auto}
th,td{border:1px solid #d6d7d3;padding:6px 8px;text-align:start;vertical-align:top}
th{background:#f4f4f3;font-weight:700}
td.num{text-align:end;font-variant-numeric:tabular-nums;direction:ltr}
@media print{body{margin:12mm}}
</style></head><body><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(subtitle)}</p>${tables}</body></html>`;
}

/** Opens the print view in a new window and asks the browser to print it. */
export function exportPdf(
  title: string,
  subtitle: string,
  sheets: ExportSheet[],
  dir: 'rtl' | 'ltr',
): boolean {
  const blob = new Blob([printHtml(title, subtitle, sheets, dir)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'width=900,height=700');
  if (!win) {
    URL.revokeObjectURL(url);
    return false;
  }
  win.addEventListener('load', () => {
    win.focus();
    win.print();
    URL.revokeObjectURL(url);
  });
  return true;
}
