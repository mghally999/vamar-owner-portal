import { useLayoutEffect, useRef, type TableHTMLAttributes } from 'react';

/**
 * A table that becomes a list of cards on narrow screens (below 768 px, `.card-table` in
 * styles.css): each row is a card and each cell shows its column header as a label, so amounts and
 * statuses stay visible at 390 px in both languages instead of scrolling off the side. The labels
 * are copied from the header cells after every render, so pages keep writing plain tables.
 */
export function ResponsiveTable({
  className = '',
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  const ref = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
      th.textContent.trim(),
    );
    for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
      Array.from(row.children).forEach((cell, i) => {
        const label = headers[i] ?? '';
        if ((cell as HTMLElement).dataset['label'] !== label)
          (cell as HTMLElement).dataset['label'] = label;
      });
    }
  });
  return <table ref={ref} className={`card-table ${className}`} {...props} />;
}
