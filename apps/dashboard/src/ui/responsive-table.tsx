import { useEffect, useLayoutEffect, useRef, useState, type TableHTMLAttributes } from 'react';

/** The width below which `.card-table` shows rows as cards; keep in step with styles.css. */
const CARD_QUERY = '(max-width: 767.98px)';

function cardQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(CARD_QUERY) : null;
}

/**
 * True while tables show as cards (phones). For code that has to follow the CSS layout, such as a
 * virtualised list that scrolls with the page on a phone but inside its own box elsewhere.
 */
export function useCardLayout(): boolean {
  const [cards, setCards] = useState(() => cardQuery()?.matches ?? false);
  useEffect(() => {
    const mq = cardQuery();
    if (!mq) return;
    const sync = () => {
      setCards(mq.matches);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
    };
  }, []);
  return cards;
}

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
