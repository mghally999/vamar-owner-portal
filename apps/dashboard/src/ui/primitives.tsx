import { Slot } from 'radix-ui';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,, useEffect } from 'react';
import type { ChequeStatus, ContractStatus, DisputeStatus } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// Buttons ---------------------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
  loading?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover border-transparent',
  secondary: 'bg-elevated text-ink border-line-strong hover:bg-sunken',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-sunken',
  danger: 'bg-elevated text-danger border-line-strong hover:bg-status-bounced-bg',
};
const sizeClass: Record<Size, string> = {
  md: 'h-11 px-4 text-[15px]',
  sm: 'h-9 px-3 text-[13px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', asChild, loading, className, children, disabled, ...rest },
  ref,
) {
  const classes = cx(
    'inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none',
    variantClass[variant],
    sizeClass[size],
    className,
  );
  if (asChild) {
    // Slot needs exactly one child element; the loading spinner never applies to link buttons.
    return (
      <Slot.Root ref={ref} className={classes} {...rest}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      className={classes}
      disabled={Boolean(disabled) || Boolean(loading)}
      type={rest.type ?? 'button'}
      {...rest}
    >
      {loading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
});

// Form controls ---------------------------------------------------------------------------------

const controlClass =
  'h-11 rounded-md border border-line-strong bg-elevated px-3 text-[15px] placeholder:text-ink-faint focus:border-primary disabled:bg-sunken disabled:text-ink-soft';

/** Controls are full-width unless the caller passes an explicit width (w-40, w-52...). */
function widthClass(className: string | undefined): string {
  return /(^|s)(w-|min-w-|max-w-|flex-1|grow)/.test(className ?? '') ? '' : 'w-full';
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; numeric?: boolean }
>(function Input({ className, invalid, numeric, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        controlClass,
        widthClass(className),
        numeric && 'tnum text-start',
        invalid && 'border-danger',
        className,
      )}
      aria-invalid={invalid ? true : undefined}
      dir={numeric ? 'ltr' : undefined}
      {...rest}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cx(
        controlClass,
        widthClass(className),
        'appearance-none bg-[length:16px] bg-no-repeat pe-9 ps-3',
        'bg-[image:var(--chevron)]',
        invalid && 'border-danger',
        className,
      )}
      style={{
        ['--chevron' as string]:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%235f7180' stroke-width='1.5'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")",
        backgroundPosition: 'var(--chev-pos, right 12px center)',
      }}
      {...rest}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(
        controlClass,
        widthClass(className),
        'h-auto min-h-24 py-2',
        invalid && 'border-danger',
        className,
      )}
      aria-invalid={invalid ? true : undefined}
      {...rest}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  required,
  htmlFor,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  required?: boolean | undefined;
  htmlFor?: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-ink-soft">
        <span>{label}</span>
        {!required && <span className="text-ink-faint">{t('optional')}</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[13px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[13px] text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Checkbox({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[15px]">
      <input type="checkbox" className="size-5 accent-primary" {...rest} />
      <span>{label}</span>
    </label>
  );
}

// Layout ----------------------------------------------------------------------------------------

export function Card({
  className,
  children,
  as: Comp = 'section',
}: {
  className?: string;
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
}) {
  return <Comp className={cx('card', className)}>{children}</Comp>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-title font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-[15px] text-ink-soft">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-heading font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-start gap-2 px-5 py-8">
      <p className="text-[15px] font-medium">{title}</p>
      {hint ? <p className="text-[13px] text-ink-soft">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  // Keep retrying on our own every 10 s while the server or the database comes back.
  useEffect(() => {
    if (!onRetry) return;
    const id = window.setTimeout(onRetry, 10_000);
    return () => {
      window.clearTimeout(id);
    };
  }, [onRetry]);
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 border-status-bounced px-5 py-4">
      <div>
        <p className="text-[15px] text-danger">{message ?? t('error_generic')}</p>
        {onRetry ? <p className="text-[13px] text-ink-soft">{t('error_autoRetry')}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden" aria-busy>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="row-line flex gap-6 px-4 py-3 last:border-b-0">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cx('h-4', c === 0 ? 'w-40' : 'w-24')} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Status chips: colour always paired with a text label --------------------------------------------

const chequeChip: Record<ChequeStatus, string> = {
  upcoming: 'bg-status-upcoming-bg text-status-upcoming',
  deposited: 'bg-status-deposited-bg text-status-deposited',
  cleared: 'bg-status-cleared-bg text-status-cleared',
  bounced: 'bg-status-bounced-bg text-status-bounced',
  replaced: 'bg-status-replaced-bg text-status-replaced',
  cancelled: 'bg-status-cancelled-bg text-status-cancelled',
};

export function ChequeStatusChip({ status }: { status: ChequeStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium',
        chequeChip[status],
      )}
    >
      {t(`cheque_status_${status}` as MessageKey)}
    </span>
  );
}

const contractChip: Record<ContractStatus, string> = {
  draft: 'bg-status-upcoming-bg text-status-upcoming',
  active: 'bg-status-cleared-bg text-status-cleared',
  expired: 'bg-status-cancelled-bg text-status-cancelled',
  terminated: 'bg-status-bounced-bg text-status-bounced',
  renewed: 'bg-status-replaced-bg text-status-replaced',
};

export function ContractStatusChip({ status }: { status: ContractStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium',
        contractChip[status],
      )}
    >
      {t(`contract_status_${status}` as MessageKey)}
    </span>
  );
}

const disputeLabels: Record<DisputeStatus, { ar: string; en: string; cls: string }> = {
  open: { ar: 'مفتوحة', en: 'Open', cls: 'bg-status-deposited-bg text-status-deposited' },
  in_progress: {
    ar: 'قيد المتابعة',
    en: 'In progress',
    cls: 'bg-status-upcoming-bg text-status-upcoming',
  },
  hearing_scheduled: {
    ar: 'جلسة محددة',
    en: 'Hearing scheduled',
    cls: 'bg-status-deposited-bg text-status-deposited',
  },
  judgment_issued: {
    ar: 'صدر الحكم',
    en: 'Judgment issued',
    cls: 'bg-status-cleared-bg text-status-cleared',
  },
  closed: { ar: 'مغلقة', en: 'Closed', cls: 'bg-status-cancelled-bg text-status-cancelled' },
};

export function DisputeStatusChip({ status }: { status: DisputeStatus }) {
  const { pick } = useI18n();
  const d = disputeLabels[status];
  return (
    <span
      className={cx('inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium', d.cls)}
    >
      {pick(d.ar, d.en)}
    </span>
  );
}

export function Money({
  fils,
  className,
  strong,
}: {
  fils: number | null | undefined;
  className?: string;
  strong?: boolean;
}) {
  const { money } = useI18n();
  return (
    <span className={cx('tnum whitespace-nowrap', strong && 'font-semibold', className)} dir="ltr">
      {money(fils)}
    </span>
  );
}

export function DateText({
  date,
  className,
}: {
  date: string | null | undefined;
  className?: string;
}) {
  const i18n = useI18n();
  return <span className={cx('tnum whitespace-nowrap', className)}>{i18n.date(date)}</span>;
}

export function Toast({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'error' | 'success';
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cx(
        'card px-4 py-3 text-[15px]',
        kind === 'error' && 'border-status-bounced text-danger',
        kind === 'success' && 'border-status-cleared text-success',
      )}
    >
      {children}
    </div>
  );
}
