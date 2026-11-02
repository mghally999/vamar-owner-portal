import { useState } from 'react';
import type { ChequeRow } from '@/lib/types';
import { Checkbox, ChequeStatusChip, DateText, Input, Money, Skeleton } from '@/ui/primitives';
import { useV2 } from './messages';

/** Pick the cheques a case is about from the unit's contracts; bounced ones come first. */
export function ChequePicker({
  cheques,
  loading,
  value,
  onChange,
  required,
}: {
  cheques: ChequeRow[];
  loading: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
  required: boolean;
}) {
  const { t } = useV2();
  const [search, setSearch] = useState('');
  const term = search.trim();
  const rank = (c: ChequeRow) => (c.status === 'bounced' ? 0 : c.status === 'replaced' ? 1 : 2);
  const shown = cheques
    .filter((c) => term === '' || (c.chequeNo ?? '').includes(term))
    .sort((a, b) => rank(a) - rank(b) || a.dueDate.localeCompare(b.dueDate));
  return (
    <fieldset className="rounded-md border border-line p-3">
      <legend className="px-1 text-[13px] font-medium text-ink-soft">
        {t('disputes_pickCheques')}
        {required ? ' *' : ''}
      </legend>
      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
        }}
        placeholder={t('disputes_chequeSearch')}
        aria-label={t('disputes_chequeSearch')}
        numeric
        className="mb-2"
      />
      {loading ? (
        <Skeleton className="h-16 w-full" />
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-ink-soft">{t('none')}</p>
      ) : (
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {shown.map((c) => (
            <Checkbox
              key={c.id}
              label={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
                  <span className="tnum font-medium" dir="ltr">
                    {c.chequeNo ?? '—'}
                  </span>
                  <span className="text-ink-soft">{c.bankName ?? ''}</span>
                  <Money fils={c.amountFils} />
                  <DateText date={c.dueDate} className="text-ink-soft" />
                  <ChequeStatusChip status={c.status} />
                </span>
              }
              checked={value.includes(c.id)}
              onChange={(e) => {
                onChange(e.target.checked ? [...value, c.id] : value.filter((x) => x !== c.id));
              }}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}
