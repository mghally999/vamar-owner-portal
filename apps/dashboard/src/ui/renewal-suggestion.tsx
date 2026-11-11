/**
 * Renewal suggestion card on the contract page: when the renewal is due, the market reference
 * from Vamar's own recent contracts (with the contracts behind it), the Dubai cap or a pointer to
 * the emirate's rules, and "Prepare renewal", which creates the draft at a rent staff confirm.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { addDays, formatNumber, parseAmountInput, RENEWAL_WINDOW_DAYS } from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useRenewalI18n } from '@/lib/renewal-messages';
import {
  usePrepareRenewal,
  useRenewalSuggestion,
  type RenewalSuggestion,
} from '@/lib/renewal-queries';
import { Dialog } from './dialog';
import { Button, Card, DateText, Field, Input, Money, Skeleton, Toast, cx } from './primitives';
import { ResponsiveTable } from './responsive-table';

/** "Renewal due in N days" chip, used on the contract page and in the contracts list. */
export function RenewalDueChip({ days, className }: { days: number; className?: string }) {
  const { dueLabel } = useRenewalI18n();
  return (
    <span
      className={cx(
        'inline-flex min-h-6 items-center rounded-sm bg-status-upcoming-bg px-2 text-[13px] font-medium text-status-upcoming',
        className,
      )}
    >
      {dueLabel(days)}
    </span>
  );
}

const pctText = (bp: number) => {
  const v = Math.abs(bp) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

export function RenewalSuggestionCard({
  contractId,
  canEdit,
}: {
  contractId: string;
  canEdit: boolean;
}) {
  const { t, lib } = useRenewalI18n();
  const q = useRenewalSuggestion(contractId, contractId !== '');
  if (q.isPending) return <Skeleton className="h-48 w-full" />;
  if (q.isError)
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[15px]">
        <span className="text-ink-soft">{t('renewal_unavailable')}</span>
        <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
          {lib('retry')}
        </Button>
      </Card>
    );
  return <RenewalSuggestionView s={q.data} canEdit={canEdit} />;
}

export function RenewalSuggestionView({ s, canEdit }: { s: RenewalSuggestion; canEdit: boolean }) {
  const { t, pick, emirateName } = useRenewalI18n();
  const headingId = useId();
  const [preparing, setPreparing] = useState(false);
  const m = s.market;

  return (
    <Card className="space-y-5 px-5 py-4" as="section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-heading font-semibold">
            {t('renewal_title')}
          </h2>
          {s.due ? <RenewalDueChip days={s.dueInDays} /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {s.renewal ? (
            <Button asChild variant="secondary">
              <Link to="/contracts/$contractId" params={{ contractId: s.renewal.id }}>
                {t('renewal_openDraft')}
              </Link>
            </Button>
          ) : canEdit ? (
            <Button
              onClick={() => {
                setPreparing(true);
              }}
            >
              {t('renewal_prepare')}
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-[13px] text-ink-soft">{t('renewal_current')}</dt>
          <dd className="text-[17px]">
            <Money fils={s.currentRentFils} />
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-soft">{t('renewal_suggested')}</dt>
          <dd className="text-[17px]">
            <Money fils={s.suggestedRentFils} strong />
          </dd>
          <dd className="text-[13px] text-ink-soft">{t('renewal_suggested_hint')}</dd>
        </div>
      </dl>

      <section aria-labelledby={`${headingId}-market`} className="space-y-3">
        <div>
          <h3 id={`${headingId}-market`} className="font-semibold">
            {t('renewal_market_title')}
          </h3>
          <p className="text-[13px] text-ink-soft">{t('renewal_market_source')}</p>
        </div>
        {m.status === 'no_size' ? (
          <p className="text-[15px]">{t('renewal_noSize')}</p>
        ) : (
          <>
            {m.status === 'ok' ? (
              <>
                <p className="text-[15px]">{t(`renewal_scope_${m.scope}`)}</p>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-[13px] text-ink-soft">{t('renewal_median')}</dt>
                    <dd>
                      <Money fils={m.medianFilsPerSqft} strong />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-ink-soft">{t('renewal_range')}</dt>
                    <dd className="flex flex-wrap gap-x-1">
                      <Money fils={m.minFilsPerSqft} />
                      <span aria-hidden>–</span>
                      <Money fils={m.maxFilsPerSqft} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-ink-soft">
                      {t('renewal_reference', { size: String(s.unit.sizeSqft ?? '') })}
                    </dt>
                    <dd>
                      <Money fils={m.referenceRentFils} />
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="text-[15px]">
                {t('renewal_notEnough', { n: m.comparables.length, min: m.minComparables })}
              </p>
            )}
            {m.comparables.length > 0 ? (
              <div>
                <h4 className="mb-2 text-[13px] font-medium text-ink-soft">
                  {t(m.status === 'ok' ? 'renewal_comparables' : 'renewal_comparablesFound', {
                    n: m.comparables.length,
                  })}
                </h4>
                <ResponsiveTable className="w-full text-[15px]">
                  <thead>
                    <tr className="row-line text-[13px] text-ink-soft">
                      <th className="px-3 py-2 text-start font-medium">{t('renewal_col_unit')}</th>
                      <th className="px-3 py-2 text-start font-medium">{t('renewal_col_start')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('renewal_col_rent')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('renewal_col_perSqft')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.comparables.map((c) => (
                      <tr key={c.contractId} className="row-line last:border-b-0">
                        <td className="px-3 py-2">
                          {pick(c.buildingNameAr, c.buildingNameEn)} · {c.unitNo}
                        </td>
                        <td className="px-3 py-2">
                          <DateText date={c.startDate} />
                        </td>
                        <td className="px-3 py-2 text-end">
                          <Money fils={c.annualRentFils} />
                        </td>
                        <td className="px-3 py-2 text-end">
                          <Money fils={c.filsPerSqft} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
              </div>
            ) : null}
          </>
        )}
      </section>

      <CapSection s={s} emirateLabel={emirateName(s.emirate)} />

      <Link
        to="/contracts"
        search={{ endingWithinDays: RENEWAL_WINDOW_DAYS }}
        className="inline-block text-[15px] font-medium underline underline-offset-2"
      >
        {t('renewal_seeAll')}
      </Link>

      {preparing ? (
        <PrepareRenewalDialog
          s={s}
          onClose={() => {
            setPreparing(false);
          }}
        />
      ) : null}
    </Card>
  );
}

function CapSection({ s, emirateLabel }: { s: RenewalSuggestion; emirateLabel: string }) {
  const { t } = useRenewalI18n();
  const cap = s.cap;
  if (cap.kind === 'check_emirate_rules')
    return (
      <section className="space-y-1">
        <h3 className="font-semibold">{t('renewal_checkRules')}</h3>
        <p className="text-[15px] text-ink-soft">
          {t('renewal_checkRules_body', { emirate: emirateLabel })}
        </p>
      </section>
    );
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{t('renewal_cap_title')}</h3>
      {cap.kind === 'dubai_no_reference' ? (
        <p className="text-[15px]">{t('renewal_cap_noReference')}</p>
      ) : (
        <>
          <p className="text-[15px]">
            {cap.belowReferenceBp > 0
              ? t('renewal_cap_below', {
                  gap: pctText(cap.belowReferenceBp),
                  pct: cap.increasePct,
                })
              : t('renewal_cap_notBelow')}
          </p>
          <p className="flex flex-wrap items-baseline gap-2 text-[15px]">
            <span className="text-ink-soft">{t('renewal_cap_max')}</span>
            <Money fils={cap.maxRentFils} strong />
          </p>
        </>
      )}
      <p className="text-[13px] text-ink-soft">{t('renewal_cap_rule')}</p>
    </section>
  );
}

function PrepareRenewalDialog({ s, onClose }: { s: RenewalSuggestion; onClose: () => void }) {
  const { t, lib, money, date } = useRenewalI18n();
  const navigate = useNavigate();
  const prepare = usePrepareRenewal(s.contractId);
  const inputId = useId();
  // Plain digits so the field can be edited; Arabic-Indic digits and commas are accepted too.
  const [text, setText] = useState(formatNumber(s.suggestedRentFils, 'en').replace(/,/g, ''));
  const [error, setError] = useState<string | null>(null);
  const fils = parseAmountInput(text);
  const valid = fils !== null && fils > 0;
  const overCap = valid && s.cap.kind === 'dubai' && fils > s.cap.maxRentFils;

  async function submit() {
    if (!valid) return;
    setError(null);
    try {
      const draft = await prepare.mutateAsync(fils);
      onClose();
      await navigate({ to: '/contracts/$contractId', params: { contractId: draft.id } });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : lib('error_generic'));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('renewal_prepare')}
      description={t('renewal_dialog_body', { start: date(addDays(s.endDate, 1)) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {lib('cancel')}
          </Button>
          <Button disabled={!valid} loading={prepare.isPending} onClick={() => void submit()}>
            {t('renewal_create')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label={t('renewal_rent_label')}
          htmlFor={inputId}
          required
          error={!valid ? t('renewal_rent_invalid') : undefined}
          hint={
            overCap && s.cap.kind === 'dubai'
              ? t('renewal_rent_overCap', { max: money(s.cap.maxRentFils) })
              : undefined
          }
        >
          <Input
            id={inputId}
            inputMode="decimal"
            dir="ltr"
            value={text}
            aria-invalid={!valid}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </Field>
        {error ? <Toast kind="error">{error}</Toast> : null}
      </div>
    </Dialog>
  );
}
