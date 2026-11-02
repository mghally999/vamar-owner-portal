/**
 * The Foodics-style period bar: preset chips, a two-month range picker for a custom range and a
 * "compare with the previous period" switch. The choice lives in the URL (lib/period-search.ts)
 * and applies to the whole page.
 */
import { PERIOD_PRESET_LABEL, type ResolvablePreset } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import type { PeriodState } from '@/lib/period-search';
import { DateRangePicker } from './date-picker';
import { cx } from './primitives';

export const DEFAULT_CHIPS: ResolvablePreset[] = [
  'today',
  'this_week',
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'this_year',
  'last_year',
];

export function PeriodBar({
  state,
  chips = DEFAULT_CHIPS,
  compare = true,
  holidays,
  className,
}: {
  state: PeriodState;
  chips?: ResolvablePreset[];
  /** Show the compare switch. */
  compare?: boolean;
  holidays?: ReadonlySet<string> | undefined;
  className?: string;
}) {
  const { t, lang } = useI18n();
  return (
    <div
      className={cx('flex flex-wrap items-center gap-2', className)}
      role="group"
      aria-label={t('period')}
    >
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('period')}>
        {chips.map((p) => {
          const active = state.preset === p;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                state.setPreset(p);
              }}
              className={cx(
                'h-9 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap',
                active
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-line-strong bg-elevated text-ink hover:bg-sunken',
              )}
            >
              {PERIOD_PRESET_LABEL[p][lang]}
            </button>
          );
        })}
      </div>
      <DateRangePicker
        value={state.preset === 'custom' ? state.period : null}
        onChange={(r) => {
          if (r) state.setRange(r.from, r.to);
        }}
        holidays={holidays}
        placeholder={PERIOD_PRESET_LABEL.custom[lang]}
        label={PERIOD_PRESET_LABEL.custom[lang]}
      />
      {compare ? (
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={state.compare}
            onChange={(e) => {
              state.setCompare(e.target.checked);
            }}
          />
          {t('period_compare')}
        </label>
      ) : null}
    </div>
  );
}
