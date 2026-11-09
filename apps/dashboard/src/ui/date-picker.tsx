/**
 * Date pickers on react-day-picker v9: a typed `dd/mm/yyyy` input with a calendar popover,
 * RTL in Arabic, our own month and weekday names (never ICU), Western digits, keyboard
 * accessible (the input is a normal field; the calendar grid takes arrow keys, Enter, Escape).
 * Values are PlainDate strings end to end; a JS Date exists only inside the calendar widget,
 * built from local year/month/day so no timezone can shift a day.
 */
import { CalendarDays, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  formatMonth,
  isPlainDate,
  isWeekend,
  WEEKDAY_SHORT,
  type PlainDate,
  type WeekStart,
} from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { Input, cx } from './primitives';

// Plain dates <-> the widget's local Date objects -----------------------------------------------

export function plainToDate(d: PlainDate): Date {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, day, 12);
}

export function dateToPlain(d: Date): PlainDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` as PlainDate;
}

/** `15/10/2026` (also accepts `15-10-2026`, `15.10.2026` and Arabic-Indic digits). */
export function parseTypedDate(text: string): PlainDate | null {
  const ascii = text
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .trim();
  // YYYY-MM-DD pasted from a spreadsheet or the API is accepted as well as dd/mm/yyyy.
  if (/^\d{4}-\d{2}-\d{2}$/.test(ascii)) return isPlainDate(ascii) ? ascii : null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(ascii);
  if (!m) return null;
  const iso = `${m[3] ?? ''}-${(m[2] ?? '').padStart(2, '0')}-${(m[1] ?? '').padStart(2, '0')}`;
  return isPlainDate(iso) ? iso : null;
}

export function formatTypedDate(d: PlainDate | '' | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day ?? ''}/${m ?? ''}/${y ?? ''}`;
}

const WEEK_START_INDEX: Record<WeekStart, 0 | 1 | 6> = { sunday: 0, monday: 1, saturday: 6 };

export type NonWorkingKind = 'weekend' | 'holiday' | null;

export function nonWorkingKind(
  d: PlainDate | '' | null | undefined,
  holidays?: ReadonlySet<string>,
): NonWorkingKind {
  if (!d) return null;
  if (holidays?.has(d)) return 'holiday';
  return isWeekend(d) ? 'weekend' : null;
}

// Calendar widget ---------------------------------------------------------------------------

/** `defaultMonth` only when there is one (exact optional props). */
function monthProp(d: Date | undefined): { defaultMonth?: Date } {
  return d ? { defaultMonth: d } : {};
}

interface CalendarCommon {
  holidays?: ReadonlySet<string> | undefined;
  weekStart?: WeekStart | undefined;
  min?: PlainDate | undefined;
  max?: PlainDate | undefined;
  numberOfMonths?: number | undefined;
  defaultMonth?: PlainDate | undefined;
}

function useCalendarProps({ holidays, weekStart = 'monday', min, max }: CalendarCommon) {
  const { lang, dir } = useI18n();
  const modifiers = {
    weekend: (date: Date) => isWeekend(dateToPlain(date)),
    holiday: (date: Date) => holidays?.has(dateToPlain(date)) ?? false,
  };
  return {
    dir,
    weekStartsOn: WEEK_START_INDEX[weekStart],
    showOutsideDays: true,
    modifiers,
    modifiersClassNames: { weekend: 'rdp-weekend', holiday: 'rdp-holiday' },
    formatters: {
      formatCaption: (date: Date) => formatMonth(dateToPlain(date), lang),
      formatWeekdayName: (date: Date) => WEEKDAY_SHORT[lang][date.getDay()] ?? '',
      formatDay: (date: Date) => String(date.getDate()),
    },
    disabled: [
      ...(min ? [{ before: plainToDate(min) }] : []),
      ...(max ? [{ after: plainToDate(max) }] : []),
    ],
  };
}

/** The popover around a calendar: closes on outside click or Escape, returns focus to the trigger. */
function Popover({
  open,
  onClose,
  anchor,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return (
    <div
      ref={box}
      role="dialog"
      className="absolute start-0 top-full z-30 mt-1 rounded-md border border-line bg-elevated p-2 shadow-lg"
    >
      {children}
    </div>
  );
}

// Single date ---------------------------------------------------------------------------------

export interface DatePickerProps extends CalendarCommon {
  value: PlainDate | '' | null | undefined;
  onChange: (next: PlainDate | null) => void;
  /** Show "falls on a weekend / holiday" under the field (a warning, never a block). */
  warnNonWorking?: boolean | undefined;
  id?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
  /** Allow an empty value (a clear button appears). */
  clearable?: boolean | undefined;
}

export function DatePicker({
  value,
  onChange,
  warnNonWorking,
  holidays,
  weekStart,
  min,
  max,
  defaultMonth,
  id,
  disabled,
  invalid,
  required,
  className,
  clearable,
  ...aria
}: DatePickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(formatTypedDate(value));
  const [typedInvalid, setTypedInvalid] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const inputId = id ?? autoId;
  const calendar = useCalendarProps({ holidays, weekStart, min, max });

  // Keep the text in step with the value when it changes from outside (a preset, a reset).
  useEffect(() => {
    setText(formatTypedDate(value));
    setTypedInvalid(false);
  }, [value]);

  const commitText = () => {
    if (text.trim() === '') {
      setTypedInvalid(false);
      if (value) onChange(null);
      return;
    }
    const parsed = parseTypedDate(text);
    if (parsed) {
      setTypedInvalid(false);
      if (parsed !== value) onChange(parsed);
    } else setTypedInvalid(true);
  };

  const warning = warnNonWorking ? nonWorkingKind(value, holidays) : null;
  const selected = value ? plainToDate(value) : undefined;

  return (
    <div ref={wrap} className={cx('relative', className)}>
      <div className="flex items-center gap-1">
        <Input
          id={inputId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText();
            }
          }}
          placeholder={t('date_placeholder')}
          numeric
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          invalid={Boolean(invalid) || typedInvalid}
          required={required}
          aria-label={aria['aria-label']}
          aria-labelledby={aria['aria-labelledby']}
          className="flex-1"
        />
        <button
          type="button"
          className="flex size-11 shrink-0 items-center justify-center rounded-md border border-line-strong bg-elevated text-ink-soft hover:bg-sunken disabled:opacity-50"
          aria-label={t('date_open')}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          <CalendarDays className="size-5" aria-hidden />
        </button>
        {clearable && value ? (
          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-soft hover:bg-sunken"
            aria-label={t('date_clear')}
            onClick={() => {
              onChange(null);
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {typedInvalid ? (
        <p className="mt-1 text-[13px] text-danger">{t('date_invalid')}</p>
      ) : warning ? (
        <p className="mt-1 text-[13px] text-status-deposited" role="status">
          {warning === 'holiday' ? t('date_warn_holiday') : t('date_warn_weekend')}
        </p>
      ) : null}
      <Popover
        open={open}
        anchor={wrap}
        onClose={() => {
          setOpen(false);
        }}
      >
        <DayPicker
          mode="single"
          autoFocus
          selected={selected}
          {...monthProp(selected ?? (defaultMonth ? plainToDate(defaultMonth) : undefined))}
          onSelect={(d) => {
            onChange(d ? dateToPlain(d) : null);
            setOpen(false);
          }}
          {...calendar}
        />
      </Popover>
    </div>
  );
}

// Date range ----------------------------------------------------------------------------------

export interface PlainRange {
  from: PlainDate;
  to: PlainDate;
}

export interface DateRangePickerProps extends CalendarCommon {
  value: PlainRange | null;
  onChange: (next: PlainRange | null) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
  /** What the trigger shows when nothing is picked. */
  placeholder?: string | undefined;
  label?: string | undefined;
}

/** Two months side by side, the range typed as two `dd/mm/yyyy` fields or picked on the grid. */
export function DateRangePicker({
  value,
  onChange,
  holidays,
  weekStart,
  min,
  max,
  numberOfMonths = 2,
  defaultMonth,
  disabled,
  className,
  placeholder,
  label,
}: DateRangePickerProps) {
  const { t, date } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  /** The first day clicked in the open calendar, until the second click commits the range. */
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [fromText, setFromText] = useState(formatTypedDate(value?.from));
  const [toText, setToText] = useState(formatTypedDate(value?.to));
  const wrap = useRef<HTMLDivElement>(null);
  const calendar = useCalendarProps({ holidays, weekStart, min, max });

  useEffect(() => {
    setFromText(formatTypedDate(value?.from));
    setToText(formatTypedDate(value?.to));
    setDraft(value ? { from: plainToDate(value.from), to: plainToDate(value.to) } : undefined);
  }, [value]);

  const applyTyped = () => {
    const from = parseTypedDate(fromText);
    const to = parseTypedDate(toText);
    if (from && to) {
      const ordered = from <= to ? { from, to } : { from: to, to: from };
      onChange(ordered);
      setOpen(false);
    }
  };

  const title = value
    ? `${date(value.from)} – ${date(value.to)}`
    : (placeholder ?? t('date_range'));

  return (
    <div ref={wrap} className={cx('relative', className)}>
      <button
        type="button"
        className={cx(
          'inline-flex h-11 items-center gap-2 rounded-md border border-line-strong bg-elevated px-3 text-[15px] hover:bg-sunken disabled:opacity-50',
          !value && 'text-ink-soft',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ?? t('date_range')}
        disabled={disabled}
        onClick={() => {
          setAnchor(null);
          setOpen((o) => !o);
        }}
      >
        <CalendarDays className="size-5 text-ink-soft" aria-hidden />
        <span className="tnum">{title}</span>
      </button>
      <Popover
        open={open}
        anchor={wrap}
        onClose={() => {
          setOpen(false);
        }}
      >
        <div className="mb-2 flex flex-wrap items-end gap-2 px-1">
          <label className="text-[13px] text-ink-soft">
            {t('from')}
            <Input
              value={fromText}
              onChange={(e) => {
                setFromText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyTyped();
                }
              }}
              placeholder={t('date_placeholder')}
              numeric
              inputMode="numeric"
              className="mt-1 h-10 w-36"
              aria-label={t('from')}
            />
          </label>
          <label className="text-[13px] text-ink-soft">
            {t('to')}
            <Input
              value={toText}
              onChange={(e) => {
                setToText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyTyped();
                }
              }}
              placeholder={t('date_placeholder')}
              numeric
              inputMode="numeric"
              className="mt-1 h-10 w-36"
              aria-label={t('to')}
            />
          </label>
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-3 text-[13px] font-medium text-on-primary"
            onClick={applyTyped}
          >
            {t('date_apply')}
          </button>
        </div>
        <DayPicker
          mode="range"
          autoFocus
          numberOfMonths={numberOfMonths}
          selected={draft}
          {...monthProp(
            value ? plainToDate(value.from) : defaultMonth ? plainToDate(defaultMonth) : undefined,
          )}
          // react-day-picker v9 turns the first click into a one-day range when a range is already
          // selected, which would commit at once. The first click sets the start, the second (before
          // or after it, or the same day) commits the ordered range.
          onSelect={(_range, day) => {
            if (!anchor) {
              setAnchor(day);
              setDraft({ from: day, to: undefined });
              return;
            }
            const [from, to] = anchor <= day ? [anchor, day] : [day, anchor];
            setAnchor(null);
            setDraft({ from, to });
            onChange({ from: dateToPlain(from), to: dateToPlain(to) });
            setOpen(false);
          }}
          {...calendar}
        />
      </Popover>
    </div>
  );
}
