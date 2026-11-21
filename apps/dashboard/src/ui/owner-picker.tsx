import { useEffect, useId, useRef, useState } from 'react';
import { useDebounced } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useOwner, useOwners } from '@/lib/queries';
import { Input, cx } from '@/ui/primitives';

/**
 * Owner filter that searches the server instead of listing the first fifty owners. Typing asks the
 * API after a short pause; choosing a result reports the owner id. Clearing the box clears the
 * filter. An owner chosen before (a filter in the URL after a reload) is shown by name.
 */
export function OwnerPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (ownerId: string, label: string) => void;
  className?: string;
}) {
  const { t, pick } = useI18n();
  // null until staff type: the box then shows the name of the owner in `value`.
  const [typed, setTyped] = useState<string | null>(null);
  const linked = useOwner(value, typed === null);
  const text =
    typed ?? (linked.data?.id === value ? pick(linked.data.nameAr, linked.data.nameEn) : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useDebounced((typed ?? '').trim(), 300);
  const q = useOwners({ search: search || undefined });
  const options = (q.data?.pages.flatMap((p) => p.items) ?? []).slice(0, 20);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) setTyped(null);
  }, [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('mousedown', close);
    };
  }, []);

  const choose = (o: (typeof options)[number]) => {
    const label = pick(o.nameAr, o.nameEn);
    setTyped(label);
    setOpen(false);
    onChange(o.id, label);
  };

  return (
    <div ref={root} className={cx('relative', className)}>
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={t('cheque_filter_owner')}
        placeholder={`${t('owner')}: ${t('all')}`}
        value={text}
        onChange={(e) => {
          setTyped(e.target.value);
          setOpen(true);
          setActive(0);
          if (e.target.value === '' && value) onChange('', '');
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-elevated py-1 shadow-lg"
        >
          {q.isPending ? (
            <li className="px-3 py-2 text-[13px] text-ink-soft">{t('loading')}</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-ink-soft">{t('owners_empty')}</li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === value}
                className={cx(
                  'cursor-pointer px-3 py-2 text-[15px] hover:bg-sunken',
                  i === active && 'bg-sunken',
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
              >
                <span className="block">{pick(o.nameAr, o.nameEn)}</span>
                <span className="block text-[13px] text-ink-soft tnum" dir="ltr">
                  {o.phoneE164}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
