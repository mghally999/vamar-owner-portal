/**
 * Bank statement matching. Staff choose the bank's CSV (read in the browser with the same SheetJS
 * loader as the import page), map its columns once per bank, and the page proposes which cheques
 * cleared or bounced using the shared rules in @vamar/shared bank-statement.ts. Nothing changes
 * until staff tick the matches and confirm; the changes then go through the bulk status endpoint,
 * so the state machine, cheque events, audit rows and owner alerts are those of a manual change.
 */
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type * as Xlsx from 'xlsx';
import {
  addDays,
  bankCsvMappingSchema,
  detectHeaderRow,
  diffDays,
  matchStatement,
  parseStatement,
  planStatementApply,
  WEAK_MATCH_DAYS,
  type BankCsvMapping,
  type ParsedStatement,
  type StatementMatch,
} from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import {
  useBankCandidates,
  useBankMappings,
  useDeleteBankMapping,
  useSaveBankMapping,
  type BankCandidate,
} from '@/lib/bank-queries';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { bulkRejections, useBulkChequeStatus, type BulkRejection } from '@/lib/queries';
import { BounceReasonField, useRejectionText } from '@/ui/cheque-bulk';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  ChequeStatusChip,
  DateText,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Money,
  PageHeader,
  SectionTitle,
  Select,
  SkeletonRows,
  Toast,
} from '@/ui/primitives';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';

// SheetJS is ~400 KB; it is loaded only when a file is chosen, never in the main bundle.
let xlsx: typeof Xlsx | null = null;
const loadXlsx = async () => (xlsx ??= await import('xlsx'));

/** The file as a grid of text cells. `raw` keeps cheque numbers' leading zeros and dates as written. */
async function readGrid(file: File): Promise<string[][]> {
  const { read, utils } = await loadXlsx();
  const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
  const book = read(text, { type: 'string', raw: true });
  const sheet = book.Sheets[book.SheetNames[0] ?? ''];
  if (!sheet) return [];
  return utils
    .sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true })
    .map((row) =>
      row.map((c) =>
        typeof c === 'string'
          ? c
          : typeof c === 'number' || typeof c === 'boolean'
            ? String(c)
            : '',
      ),
    );
}

type DraftKey = Exclude<keyof BankCsvMapping, 'bank'>;
type Draft = { bank: string } & Record<DraftKey, string>;

const EMPTY_DRAFT: Draft = {
  bank: '',
  dateColumn: '',
  amountColumn: '',
  chequeNoColumn: '',
  descriptionColumn: '',
  signColumn: '',
  debitColumn: '',
};

const COLUMNS: { key: DraftKey; label: MessageKey; required: boolean }[] = [
  { key: 'dateColumn', label: 'bank_col_date', required: true },
  { key: 'amountColumn', label: 'bank_col_amount', required: true },
  { key: 'chequeNoColumn', label: 'bank_col_chequeNo', required: false },
  { key: 'descriptionColumn', label: 'bank_col_description', required: false },
  { key: 'signColumn', label: 'bank_col_sign', required: false },
  { key: 'debitColumn', label: 'bank_col_debit', required: false },
];

function toDraft(m: BankCsvMapping): Draft {
  return {
    bank: m.bank,
    dateColumn: m.dateColumn,
    amountColumn: m.amountColumn,
    chequeNoColumn: m.chequeNoColumn ?? '',
    descriptionColumn: m.descriptionColumn ?? '',
    signColumn: m.signColumn ?? '',
    debitColumn: m.debitColumn ?? '',
  };
}

function fromDraft(d: Draft) {
  return bankCsvMappingSchema.safeParse({
    bank: d.bank,
    dateColumn: d.dateColumn,
    amountColumn: d.amountColumn,
    chequeNoColumn: d.chequeNoColumn || null,
    descriptionColumn: d.descriptionColumn || null,
    signColumn: d.signColumn || null,
    debitColumn: d.debitColumn || null,
  });
}

const sameMapping = (a: BankCsvMapping, b: BankCsvMapping) =>
  JSON.stringify(toDraft(a)) === JSON.stringify(toDraft(b));

/** Deposited cheques can clear weeks after their due date; the server also returns all of them. */
const LOOKBACK_DAYS = 60;
const MAX_WINDOW_DAYS = 400;

function candidateWindow(parsed: ParsedStatement | null): { from: string; to: string } | null {
  if (!parsed?.lines.length) return null;
  const dates = parsed.lines.map((l) => l.date).sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return null;
  const to = addDays(last, WEAK_MATCH_DAYS);
  let from = addDays(first, -LOOKBACK_DAYS);
  if (diffDays(from, to) > MAX_WINDOW_DAYS) from = addDays(to, -MAX_WINDOW_DAYS);
  return { from, to };
}

const rowKey = (m: StatementMatch) => String(m.line.row);

export function BankStatementPage() {
  const { t } = useI18n();
  const mappings = useBankMappings();
  const save = useSaveBankMapping();
  const remove = useDeleteBankMapping();
  const [file, setFile] = useState<{ name: string; grid: string[][]; headerRow: number } | null>(
    null,
  );
  const [fileError, setFileError] = useState(false);
  const [savedBank, setSavedBank] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [usedBank, setUsedBank] = useState('');
  const [parseId, setParseId] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const header = useMemo(() => {
    if (!file) return [];
    const cells = (file.grid[file.headerRow] ?? []).map((c) => c.trim()).filter(Boolean);
    return [...new Set(cells)];
  }, [file]);

  const win = useMemo(() => candidateWindow(parsed), [parsed]);
  const candidates = useBankCandidates(win);
  const result = useMemo(
    () => (parsed && candidates.data ? matchStatement(parsed.lines, candidates.data) : null),
    [parsed, candidates.data],
  );
  const byId = useMemo(
    () => new Map((candidates.data ?? []).map((c) => [c.id, c])),
    [candidates.data],
  );
  async function onFile(f: File) {
    setFileError(false);
    setParsed(null);
    setNotice(null);
    try {
      const grid = await readGrid(f);
      const headerRow = detectHeaderRow(grid);
      if (grid.length <= headerRow + 1) throw new Error('empty');
      setFile({ name: f.name, grid, headerRow });
      // Pick the first saved bank whose columns are all in this file.
      const names = new Set((grid[headerRow] ?? []).map((c) => c.trim().toLowerCase()));
      const fits = (mappings.data ?? []).find((m) =>
        [
          m.dateColumn,
          m.amountColumn,
          m.chequeNoColumn,
          m.descriptionColumn,
          m.signColumn,
          m.debitColumn,
        ]
          .filter((c): c is string => c !== null)
          .every((c) => names.has(c.trim().toLowerCase())),
      );
      setSavedBank(fits?.bank ?? '');
      setDraft(fits ? toDraft(fits) : EMPTY_DRAFT);
    } catch {
      setFile(null);
      setFileError(true);
    }
  }

  const draftMapping = fromDraft(draft);

  async function findMatches() {
    if (!file || !draftMapping.success) return;
    setSaveError(null);
    const mapping = draftMapping.data;
    const existing = mappings.data?.find(
      (m) => m.bank.toLowerCase() === mapping.bank.toLowerCase(),
    );
    try {
      if (!existing || !sameMapping(existing, mapping)) await save.mutateAsync(mapping);
    } catch (e) {
      setSaveError(e instanceof ApiRequestError ? e.message : t('error_generic'));
      return;
    }
    setSavedBank(mapping.bank);
    setUsedBank(mapping.bank);
    setParsed(parseStatement(file.grid, mapping, file.headerRow));
    setParseId((n) => n + 1);
  }

  return (
    <Page>
      <PageHeader
        title={t('bank_title')}
        subtitle={t('bank_subtitle')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/cheques">{t('nav_cheques')}</Link>
          </Button>
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}

      <Card className="flex flex-col gap-4 p-4 sm:p-6">
        <Field label={t('bank_file')} required hint={t('bank_file_hint')}>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-[15px] file:me-3 file:h-11 file:rounded-md file:border file:border-line-strong file:bg-elevated file:px-4 file:text-ink"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </Field>
        {fileError ? (
          <p className="text-[13px] text-danger" role="alert">
            {t('bank_file_error')}
          </p>
        ) : null}
        {file ? (
          <p className="text-[13px] text-ink-soft">
            {t('bank_rows', { n: file.grid.length - file.headerRow - 1, file: file.name })}
          </p>
        ) : null}
      </Card>

      {file ? (
        <Card className="flex flex-col gap-4 p-4 sm:p-6">
          <SectionTitle>{t('bank_mapping')}</SectionTitle>
          <p className="-mt-2 text-[13px] text-ink-soft">{t('bank_mapping_hint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('bank_saved')}>
              <Select
                value={savedBank}
                onChange={(e) => {
                  const bank = e.target.value;
                  setSavedBank(bank);
                  const m = mappings.data?.find((x) => x.bank === bank);
                  setDraft(m ? toDraft(m) : EMPTY_DRAFT);
                }}
              >
                <option value="">{t('bank_new')}</option>
                {mappings.data?.map((m) => (
                  <option key={m.bank} value={m.bank}>
                    {m.bank}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('bank_name')} required>
              <Input
                value={draft.bank}
                maxLength={80}
                onChange={(e) => {
                  setDraft({ ...draft, bank: e.target.value });
                }}
              />
            </Field>
            {COLUMNS.map((col) => (
              <Field key={col.key} label={t(col.label)} required={col.required}>
                <Select
                  value={draft[col.key]}
                  onChange={(e) => {
                    setDraft({ ...draft, [col.key]: e.target.value });
                  }}
                >
                  <option value="">{col.required ? '—' : t('bank_col_none')}</option>
                  {header.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                  {draft[col.key] && !header.includes(draft[col.key]) ? (
                    <option value={draft[col.key]}>{draft[col.key]}</option>
                  ) : null}
                </Select>
              </Field>
            ))}
          </div>
          {saveError ? (
            <p className="text-[13px] text-danger" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void findMatches()}
              disabled={!draftMapping.success}
              loading={save.isPending}
            >
              {t('bank_find')}
            </Button>
            {savedBank ? (
              <Button
                variant="ghost"
                loading={remove.isPending}
                onClick={() => {
                  void remove.mutateAsync(savedBank).then(() => {
                    setSavedBank('');
                  });
                }}
              >
                {t('bank_delete_mapping')}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {parsed ? (
        parsed.missingColumns.length ? (
          <Toast kind="error">
            {t('bank_missing_columns', { cols: parsed.missingColumns.join(', ') })}
          </Toast>
        ) : candidates.isPending && win ? (
          <div aria-label={t('bank_loading')}>
            <SkeletonRows cols={5} rows={4} />
          </div>
        ) : candidates.isError ? (
          <ErrorState onRetry={() => void candidates.refetch()} />
        ) : (
          // A new statement or a fresh cheque list starts a fresh selection.
          <Results
            key={`${String(parseId)}-${String(candidates.dataUpdatedAt)}`}
            parsed={parsed}
            matches={result?.matches ?? []}
            unmatched={result?.unmatched ?? []}
            byId={byId}
            bank={usedBank}
            onApplied={(n) => {
              setNotice(t('bank_applied', { n }));
            }}
          />
        )
      ) : null}
    </Page>
  );
}

function Results({
  parsed,
  matches,
  unmatched,
  byId,
  bank,
  onApplied,
}: {
  parsed: ParsedStatement;
  matches: StatementMatch[];
  unmatched: { line: StatementMatch['line']; reason: 'debit' | 'no_match' | 'already_matched' }[];
  byId: Map<string, BankCandidate>;
  bank: string;
  onApplied: (updated: number) => void;
}) {
  const { t, pick } = useI18n();
  // Strong matches start ticked, weak ones wait for a person to look; staff still confirm.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(matches.filter((m) => m.strength === 'strong').map(rowKey)),
  );
  const [confirming, setConfirming] = useState(false);
  const chosen = matches.filter((m) => selected.has(rowKey(m)));
  const count = chosen.length;
  const strongCount = matches.filter((m) => m.strength === 'strong').length;
  const allTicked = matches.length > 0 && count === matches.length;
  const onToggle = (key: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };
  const onToggleAll = () => {
    setSelected(allTicked ? new Set() : new Set(matches.map(rowKey)));
  };
  return (
    <section className="flex flex-col gap-4" aria-label={t('bank_matches')}>
      <p className="text-[15px] text-ink-soft" aria-live="polite">
        {t('bank_summary', {
          lines: parsed.lines.length,
          strong: strongCount,
          weak: matches.length - strongCount,
          skipped: parsed.skipped.length,
        })}
      </p>
      {parsed.skipped.length ? (
        <p className="text-[13px] text-ink-faint">
          {t('bank_skipped', {
            rows:
              parsed.skipped
                .slice(0, 20)
                .map((s) => s.row)
                .join(', ') + (parsed.skipped.length > 20 ? ' …' : ''),
          })}
        </p>
      ) : null}

      {matches.length === 0 ? (
        <EmptyState title={t('bank_no_matches')} />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <SectionTitle>{t('bank_matches')}</SectionTitle>
            <Button
              onClick={() => {
                setConfirming(true);
              }}
              disabled={count === 0}
            >
              {t('bank_apply', { n: count })}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <ResponsiveTable className="w-full min-w-[860px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  <th className="w-12 px-3 py-2">
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      checked={allTicked}
                      onChange={onToggleAll}
                      aria-label={t('all')}
                    />
                  </th>
                  <th className="px-4 py-2 text-start font-medium">{t('bank_th_match')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('bank_th_line')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('amount')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('bank_th_cheque')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('bank_th_action')}</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => {
                  const c = byId.get(m.chequeId);
                  const key = rowKey(m);
                  return (
                    <tr key={key} className="row-line align-top last:border-b-0">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          className="size-5 accent-primary"
                          checked={selected.has(key)}
                          onChange={() => {
                            onToggle(key);
                          }}
                          aria-label={t('bank_row', { n: m.line.row })}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="min-w-0 text-start">
                          <span
                            className={`inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium ${m.strength === 'strong' ? 'bg-status-cleared-bg text-status-cleared' : 'bg-status-deposited-bg text-status-deposited'}`}
                          >
                            {t(m.strength === 'strong' ? 'bank_strong' : 'bank_weak')}
                          </span>
                          <span className="mt-1 block text-[13px] text-ink-soft">
                            {m.strength === 'strong'
                              ? t('bank_strong_hint')
                              : t('bank_weak_hint', { days: WEAK_MATCH_DAYS })}
                          </span>
                          {m.dayGap > 0 ? (
                            <span className="block text-[13px] text-ink-faint">
                              {t('bank_gap', { n: m.dayGap })}
                            </span>
                          ) : null}
                          {m.alternatives > 0 ? (
                            <span className="block text-[13px] text-danger">
                              {t('bank_alternatives', { n: m.alternatives })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="min-w-0 text-start">
                          <DateText date={m.line.date} />
                          <span className="block text-[13px] text-ink-soft">
                            {t('bank_row', { n: m.line.row })}
                            {m.line.chequeNo ? (
                              <>
                                {' · '}
                                <span className="tnum" dir="ltr">
                                  {m.line.chequeNo}
                                </span>
                              </>
                            ) : null}
                          </span>
                          {m.line.description ? (
                            <span className="block max-w-72 text-[13px] break-words text-ink-faint">
                              {m.line.description}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <Money fils={m.line.amountFils} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="min-w-0 text-start">
                          {c ? (
                            <>
                              <span className="tnum font-medium" dir="ltr">
                                {c.chequeNo ?? '—'}
                              </span>
                              <span className="block text-[13px] text-ink-soft">
                                {pick(c.buildingNameAr, c.buildingNameEn)} · {c.unitNo} ·{' '}
                                {c.tenantName}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
                                <DateText date={c.dueDate} />
                                <ChequeStatusChip status={c.status} />
                              </span>
                              {c.status === 'upcoming' ? (
                                <span className="block text-[13px] text-ink-faint">
                                  {t('bank_deposit_first')}
                                </span>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ChequeStatusChip status={m.action} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </ResponsiveTable>
          </div>
        </Card>
      )}

      {unmatched.length ? (
        <details className="card px-4 py-3">
          <summary className="min-h-11 cursor-pointer py-2 text-[15px] font-medium">
            {t('bank_unmatched', { n: unmatched.length })}
          </summary>
          <ul className="flex flex-col text-[15px]">
            {unmatched.map((u) => (
              <li
                key={u.line.row}
                className="row-line flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 last:border-b-0"
              >
                <span>
                  <span className="text-ink-soft">{t('bank_row', { n: u.line.row })}</span>
                  {' · '}
                  <DateText date={u.line.date} />
                  {u.line.description ? (
                    <span className="block text-[13px] break-words text-ink-faint">
                      {u.line.description}
                    </span>
                  ) : null}
                </span>
                <span className="text-end">
                  <Money fils={u.line.amountFils} />
                  <span className="block text-[13px] text-ink-soft">
                    {t(`bank_unmatched_${u.reason}` as MessageKey)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {confirming ? (
        <ApplyDialog
          matches={chosen}
          byId={byId}
          bank={bank}
          onClose={() => {
            setConfirming(false);
          }}
          onDone={(n) => {
            setConfirming(false);
            onApplied(n);
          }}
        />
      ) : null}
    </section>
  );
}

function ApplyDialog({
  matches,
  byId,
  bank,
  onClose,
  onDone,
}: {
  matches: StatementMatch[];
  byId: Map<string, BankCandidate>;
  bank: string;
  onClose: () => void;
  onDone: (updated: number) => void;
}) {
  const { t } = useI18n();
  const bulk = useBulkChequeStatus();
  const rejectionText = useRejectionText();
  const [reason, setReason] = useState(() => t('bounce_reason_returned'));
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [stopped, setStopped] = useState<{
    rejected: BulkRejection[];
    status: 'deposited' | 'cleared' | 'bounced';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleared = matches.filter((m) => m.action === 'cleared').length;
  const bounced = matches.length - cleared;
  const deposits = matches.filter((m) => byId.get(m.chequeId)?.status === 'upcoming').length;
  const steps = planStatementApply(
    matches.map((m) => ({ chequeId: m.chequeId, action: m.action, date: m.line.date })),
    (id) => byId.get(id)?.status,
  );
  const canApply = bounced === 0 || reason.trim().length > 0;

  async function apply() {
    setError(null);
    for (const [i, step] of steps.entries()) {
      setProgress({ i: i + 1, n: steps.length });
      try {
        await bulk.mutateAsync({
          ids: step.ids,
          status: step.status,
          date: step.date,
          reason: step.status === 'bounced' ? reason.trim() : undefined,
          note: t('bank_note', { bank }),
        });
      } catch (e) {
        setProgress(null);
        const rejected = bulkRejections(e);
        if (rejected) setStopped({ rejected, status: step.status });
        else setError(e instanceof ApiRequestError ? e.message : t('error_generic'));
        return;
      }
    }
    onDone(new Set(matches.map((m) => m.chequeId)).size);
  }

  const labelOf = (id: string) => byId.get(id)?.chequeNo ?? id;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !progress) onClose();
      }}
      title={t('bank_confirm_title')}
      footer={
        stopped ? (
          <Button onClick={onClose}>{t('close')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={Boolean(progress)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void apply()} disabled={!canApply} loading={Boolean(progress)}>
              {t('confirm')}
            </Button>
          </>
        )
      }
    >
      {stopped ? (
        <div>
          <p className="mb-2 text-[15px] font-medium text-danger" role="alert">
            {t('bank_apply_stopped')}
          </p>
          <ul className="flex flex-col text-[15px]">
            {stopped.rejected.map((r) => (
              <li
                key={r.id}
                className="row-line flex flex-wrap justify-between gap-x-3 gap-y-1 py-2 last:border-b-0"
              >
                <span className="tnum" dir="ltr">
                  {r.chequeNo ?? labelOf(r.id)}
                </span>
                <span className="text-ink-soft">{rejectionText(r, stopped.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-[15px]">
          <p>{t('bank_confirm_body', { cleared, bounced })}</p>
          {deposits ? <p>{t('bank_confirm_deposit', { n: deposits })}</p> : null}
          {bounced ? (
            <>
              <p className="text-ink-soft">{t('bank_confirm_notify')}</p>
              <BounceReasonField value={reason} onChange={setReason} />
            </>
          ) : null}
          {progress ? (
            <p className="text-ink-soft" aria-live="polite">
              {t('bank_applying', progress)}
            </p>
          ) : null}
          {error ? (
            <p className="text-[13px] text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
