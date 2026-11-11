/**
 * Global search (Ctrl+K): one box, grouped results from GET /api/staff/search, arrow keys and
 * Enter to open the page behind a hit.
 */
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CHEQUE_STATUSES, DISPUTE_STATUSES, EXPENSE_STATUSES } from '@vamar/shared';
import { useDebounced } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useSearch as useGlobalSearch } from '@/lib/queries-v2';
import type { SearchHit, SearchHitType } from '@/lib/types-v2';
import { Dialog } from './dialog';
import { Input, cx, disputeStatusName } from './primitives';

const ORDER: SearchHitType[] = [
  'owner',
  'unit',
  'building',
  'cheque',
  'dispute',
  'expense',
  'tenant',
];

const isOneOf = <T extends string>(list: readonly T[], v: string | undefined): v is T =>
  v !== undefined && (list as readonly string[]).includes(v);

/**
 * The hit's second line in the page's language. The API sends codes and ISO dates ("in_progress",
 * "2026-11-11 · deposited", "INV-1 · posted"); anything else is shown as sent (phones, plot no.).
 */
export function hitDetail(
  hit: SearchHit,
  {
    t,
    pick,
    date,
  }: {
    t: (k: MessageKey) => string;
    pick: (ar: string, en: string) => string;
    date: (d: string) => string;
  },
): string {
  const [first, status] = hit.detail.split(' · ');
  if (hit.type === 'dispute' && isOneOf(DISPUTE_STATUSES, hit.detail)) {
    const name = disputeStatusName(hit.detail);
    return pick(name.ar, name.en);
  }
  if (hit.type === 'cheque' && first && isOneOf(CHEQUE_STATUSES, status))
    return `${date(first)} · ${t(`cheque_status_${status}` as MessageKey)}`;
  if (hit.type === 'expense' && first !== undefined && isOneOf(EXPENSE_STATUSES, status)) {
    const label = t(`expense_status_${status}` as MessageKey);
    return first ? `${first} · ${label}` : label;
  }
  return hit.detail;
}

/** Where a hit leads. */
export function hitTarget(hit: SearchHit): { to: string; params?: Record<string, string> } {
  switch (hit.type) {
    case 'owner':
      return { to: '/owners/$ownerId', params: { ownerId: hit.id } };
    case 'unit':
      return { to: '/units/$unitId', params: { unitId: hit.id } };
    case 'building':
      return { to: '/buildings/$buildingId', params: { buildingId: hit.id } };
    case 'cheque':
      return { to: '/cheques/$chequeId', params: { chequeId: hit.id } };
    case 'dispute':
      return { to: '/disputes/$disputeId', params: { disputeId: hit.id } };
    case 'expense':
      return { to: '/expenses/$expenseId', params: { expenseId: hit.id } };
    case 'tenant':
      return { to: '/contracts' };
  }
}

export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const i18n = useI18n();
  const { t, pick } = i18n;
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 250);
  const q = useGlobalSearch(open ? query : '');
  const hits = useMemo(() => {
    const list = q.data ?? [];
    return [...list].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  }, [q.data]);

  useEffect(() => {
    if (!open) {
      setText('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    setActive(0);
  }, [hits]);

  const go = (hit: SearchHit) => {
    const target = hitTarget(hit);
    onOpenChange(false);
    void navigate({ to: target.to as never, params: (target.params ?? {}) as never });
  };

  let lastType: SearchHitType | null = null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('search_title')}
      description={t('search_hint')}
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-ink-soft"
          aria-hidden
        />
        <Input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault();
              go(hits[active]);
            }
          }}
          placeholder={t('search_placeholder')}
          aria-label={t('search_title')}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          className="ps-10"
        />
      </div>
      <ul id="global-search-results" role="listbox" className="mt-3 max-h-96 overflow-auto">
        {hits.map((h, i) => {
          const header = h.type !== lastType;
          lastType = h.type;
          return (
            <li key={`${h.type}-${h.id}`} role="presentation">
              {header ? (
                <p className="px-2 pt-3 pb-1 text-[12px] font-medium text-ink-faint uppercase">
                  {t(`search_type_${h.type}` as MessageKey)}
                </p>
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={cx(
                  'flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-start hover:bg-sunken',
                  i === active && 'bg-sunken',
                )}
                onMouseEnter={() => {
                  setActive(i);
                }}
                onClick={() => {
                  go(h);
                }}
              >
                <span className="font-medium" dir="auto">
                  {pick(h.titleAr, h.titleEn)}
                </span>
                <span className="text-[13px] text-ink-soft tnum" dir="auto">
                  {hitDetail(h, i18n)}
                </span>
              </button>
            </li>
          );
        })}
        {query && !q.isPending && hits.length === 0 ? (
          <li className="px-2 py-3 text-[13px] text-ink-soft">{t('search_empty')}</li>
        ) : null}
      </ul>
    </Dialog>
  );
}

export { useSearchShortcut } from './search-shortcut';
