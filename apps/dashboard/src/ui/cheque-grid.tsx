/**
 * The editable cheque grid: dates generated from the contract, amounts / numbers / banks typed by
 * staff, live total vs annual rent. Pure presentation over a rows array; the parent owns state.
 */
import {
  formatNumber,
  parseAmountInput,
  suggestEqualAmounts,
  validateChequeGrid,
  type GridRow,
  type PlainDate,
} from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { Button, Input, Money, cx } from './primitives';

export interface GridRowDraft {
  seq: number;
  dueDate: PlainDate;
  amountText: string;
  chequeNo: string;
  bankName: string;
  /** Locked rows (already deposited/cleared) cannot be edited. */
  locked?: boolean;
}

export function toGridRows(rows: GridRowDraft[]): GridRow[] {
  return rows.map((r) => ({
    seq: r.seq,
    dueDate: r.dueDate,
    amountFils: r.amountText.trim() === '' ? null : parseAmountInput(r.amountText),
    chequeNo: r.chequeNo.trim() || null,
    bankName: r.bankName.trim() || null,
  }));
}

export function ChequeGrid({
  rows,
  annualRentFils,
  onChange,
  readOnly,
}: {
  rows: GridRowDraft[];
  annualRentFils: number;
  onChange: (rows: GridRowDraft[]) => void;
  readOnly?: boolean;
}) {
  const { t, lang } = useI18n();
  const gridRows = toGridRows(rows);
  const v = validateChequeGrid(gridRows, annualRentFils);
  const update = (i: number, patch: Partial<GridRowDraft>) => {
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const fillEqual = () => {
    const amounts = suggestEqualAmounts(annualRentFils, rows.length);
    onChange(
      rows.map((r, i) =>
        r.locked ? r : { ...r, amountText: formatNumber(amounts[i] ?? 0, 'en').replace(/,/g, '') },
      ),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-[15px]">
          <thead>
            <tr className="row-line text-[13px] text-ink-soft">
              <th className="w-10 px-3 py-2 text-start font-medium">{t('contract_grid_seq')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('dueDate')}</th>
              <th className="px-3 py-2 text-start font-medium">
                {t('amount')} ({t('aed')})
              </th>
              <th className="px-3 py-2 text-start font-medium">{t('contract_grid_chequeNo')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('contract_grid_bank')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const parsed = gridRows[i];
              const amountInvalid =
                r.amountText.trim() !== '' &&
                (parsed?.amountFils === null || parsed?.amountFils === 0);
              const dup = parsed?.chequeNo ? v.duplicateChequeNos.includes(parsed.chequeNo) : false;
              const disabled = Boolean(readOnly) || Boolean(r.locked);
              return (
                <tr key={r.seq} className="row-line last:border-b-0">
                  <td className="px-3 py-2 tnum text-ink-soft">{r.seq}</td>
                  <td className="px-3 py-2">
                    <Input
                      type="date"
                      value={r.dueDate}
                      onChange={(e) => {
                        update(i, { dueDate: e.target.value as PlainDate });
                      }}
                      numeric
                      disabled={disabled}
                      className="h-10 w-44"
                      aria-label={`${t('dueDate')} ${r.seq}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={r.amountText}
                      onChange={(e) => {
                        update(i, { amountText: e.target.value });
                      }}
                      numeric
                      inputMode="decimal"
                      placeholder="0"
                      invalid={amountInvalid}
                      disabled={disabled}
                      className="h-10 w-40"
                      aria-label={`${t('amount')} ${r.seq}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={r.chequeNo}
                      onChange={(e) => {
                        update(i, { chequeNo: e.target.value });
                      }}
                      numeric
                      invalid={dup}
                      disabled={disabled}
                      className="h-10 w-40"
                      aria-label={`${t('contract_grid_chequeNo')} ${r.seq}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={r.bankName}
                      onChange={(e) => {
                        update(i, { bankName: e.target.value });
                      }}
                      list="bank-names"
                      disabled={disabled}
                      className="h-10 min-w-44"
                      aria-label={`${t('contract_grid_bank')} ${r.seq}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="bank-names">
          {[
            'Emirates NBD',
            'ADCB',
            'FAB',
            'Mashreq',
            'Dubai Islamic Bank',
            'RAKBANK',
            'ADIB',
            'CBD',
            'Emirates Islamic',
            'HSBC',
            'Standard Chartered',
            'Citibank',
            'Sharjah Islamic Bank',
            'Ajman Bank',
            'NBF',
            'UAB',
            'Al Hilal',
            'Wio',
            'Liv',
          ].map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[15px]">
          <span className="text-ink-soft">{t('contract_grid_total')} </span>
          <Money fils={v.totalFils} strong />
          <span className="text-ink-soft"> {t('contract_grid_vsRent')} </span>
          <Money fils={annualRentFils} />
          <span
            className={cx(
              'ms-3 text-[13px]',
              v.matchesRent ? 'text-status-cleared' : 'text-status-deposited',
            )}
          >
            {v.matchesRent
              ? t('contract_grid_matches')
              : v.differenceFils < 0
                ? t('contract_grid_short', { diff: formatNumber(-v.differenceFils, lang) })
                : t('contract_grid_over', { diff: formatNumber(v.differenceFils, lang) })}
          </span>
          {v.missingSeqs.length ? (
            <span className="ms-3 text-[13px] text-ink-soft">
              {t('contract_grid_missing', { n: v.missingSeqs.length })}
            </span>
          ) : null}
        </div>
        {!readOnly ? (
          <Button variant="secondary" size="sm" onClick={fillEqual}>
            {t('contract_grid_fillEqual')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
