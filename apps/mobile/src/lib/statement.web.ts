/// <reference lib="dom" />
/**
 * Web app statement: the same HTML as the phone's PDF, opened in a new tab with the print dialog,
 * where "Save as PDF" gives the file.
 */
import { statementHtml, type StatementInput } from './statement-html';

export { periodLabel, statementHtml, type StatementInput } from './statement-html';

export async function shareStatement(input: StatementInput): Promise<void> {
  const html = statementHtml(input, "url('/fonts/Almarai-Regular.woff2') format('woff2')");
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error('popup blocked');
  }
  await new Promise<void>((resolve) => {
    win.addEventListener('load', () => {
      resolve();
    });
  });
  win.focus();
  win.print();
  URL.revokeObjectURL(url);
}
