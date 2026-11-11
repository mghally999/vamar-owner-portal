/**
 * Building budgets on the dashboard: each line's budget against what was posted this year (the
 * building's totals, not owner shares), year to date against the budget for the days elapsed,
 * and actual plus the fixed costs the recurring rules will still bring. Shown on the building
 * page (where admins set the lines) and on /budgets for every building, which the Today panel
 * links to.
 */
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { parseAmountInput, todayInDubai, type BudgetLevel } from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCategories } from '@/lib/queries-v2';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  cx,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  Skeleton,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { useBudgetText } from './budgets-messages';
import {
  useBudgetReport,
  useCreateBudget,
  useDeleteBudget,
  useUpdateBudget,
  type BudgetLineRow,
  type BuildingBudget,
} from './budgets-queries';

const FILL: Record<BudgetLevel, string> = {
  ok: 'bg-primary',
  near: 'bg-warning',
  over: 'bg-danger',
};
const TEXT: Record<BudgetLevel, string> = {
  ok: 'text-ink-soft',
  near: 'text-warning',
  over: 'text-danger',
};

function currentYear(): number {
  return Number(todayInDubai().slice(0, 4));
}

/** Last year, this year and the next two: budgets are set ahead, and last year is looked back on. */
function yearOptions(selected: number): number[] {
  const y = currentYear();
  return [...new Set([y - 1, y, y + 1, y + 2, selected])].sort((a, b) => a - b);
}

function YearSelect({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  const { t } = useBudgetText();
  return (
    <Select
      value={String(year)}
      onChange={(e) => {
        onChange(Number(e.target.value));
      }}
      aria-label={t('budgets_year')}
      className="w-32"
    >
      {yearOptions(year).map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </Select>
  );
}

/**
 * One line: its name and level, a bar where the solid part is what was spent and the lighter
 * part the fixed costs still due (both capped at the budget), then year to date and forecast.
 */
export function BudgetLineView({ line, actions }: { line: BudgetLineRow; actions?: ReactNode }) {
  const { t, money, pick, levelLabel, totalLabel } = useBudgetText();
  const name =
    line.nameAr !== null && line.nameEn !== null ? pick(line.nameAr, line.nameEn) : totalLabel;
  const spent = Math.min(line.percent, 100);
  const projected = Math.max(0, Math.min(line.forecastPercent, 100) - spent);
  return (
    <li className="flex flex-col gap-1.5 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span
          className={cx('text-[15px] break-words', line.categoryId === null && 'font-semibold')}
        >
          {name}
        </span>
        <span className="flex items-center gap-2">
          <span className={cx('tnum text-[15px] font-semibold', TEXT[line.level])}>
            {line.percent}%
          </span>
          {line.level !== 'ok' ? (
            <span className={cx('text-[13px]', TEXT[line.level])}>{levelLabel(line.level)}</span>
          ) : null}
          {actions}
        </span>
      </div>
      <span
        className="flex h-2 w-full overflow-hidden rounded-full bg-track"
        role="img"
        aria-label={`${name}: ${String(line.percent)}%`}
      >
        <span className={cx('block h-full', FILL[line.level])} style={{ width: `${spent}%` }} />
        <span
          className={cx('block h-full opacity-40', FILL[line.forecastLevel])}
          style={{ width: `${projected}%` }}
        />
      </span>
      <span className="tnum text-[13px] text-ink-soft">
        {t('budgets_spent', { actual: money(line.actualFils), budget: money(line.budgetFils) })}
      </span>
      <span className="tnum text-[13px] text-ink-soft">
        {t('budgets_toDate', {
          actual: money(line.actualToDateFils),
          budget: money(line.budgetToDateFils),
          pct: line.toDatePercent,
        })}
      </span>
      <span
        className={cx(
          'tnum text-[13px]',
          line.forecastLevel === 'over' ? 'text-danger' : 'text-ink-soft',
        )}
      >
        {t('budgets_forecast', {
          projected: money(line.projectedFils),
          forecast: money(line.forecastFils),
          pct: line.forecastPercent,
        })}
        {line.forecastLevel === 'over' && line.level !== 'over'
          ? ` · ${t('budgets_forecastOver')}`
          : ''}
      </span>
    </li>
  );
}

function BudgetLinesCard({
  building,
  onEdit,
  onDelete,
}: {
  building: BuildingBudget;
  onEdit?: ((line: BudgetLineRow) => void) | undefined;
  onDelete?: ((line: BudgetLineRow) => void) | undefined;
}) {
  const { t, pick, totalLabel } = useBudgetText();
  return (
    <Card>
      <ul>
        {building.lines.map((line) => {
          const name =
            line.nameAr !== null && line.nameEn !== null
              ? pick(line.nameAr, line.nameEn)
              : totalLabel;
          return (
            <BudgetLineView
              key={line.budgetId}
              line={line}
              actions={
                onEdit && onDelete ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('budgets_edit', { name })}
                      onClick={() => {
                        onEdit(line);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('budgets_delete', { name })}
                      onClick={() => {
                        onDelete(line);
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </>
                ) : undefined
              }
            />
          );
        })}
      </ul>
    </Card>
  );
}

/** The budget section of the building page; admins add, change and remove lines here. */
export function BuildingBudgetSection({ buildingId }: { buildingId: string }) {
  const { t } = useBudgetText();
  const auth = useAuth();
  const [year, setYear] = useState(currentYear);
  const q = useBudgetReport(year, buildingId);
  const del = useDeleteBudget();
  const [editing, setEditing] = useState<BudgetLineRow | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = auth.hasRole('admin');
  const building = q.data?.buildings[0];

  return (
    <section aria-labelledby="budget-title">
      <SectionTitle
        aside={
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <YearSelect year={year} onChange={setYear} />
            <Link
              to="/budgets"
              search={{ year } as never}
              className="text-[15px] text-primary underline-offset-2 hover:underline"
            >
              {t('budgets_all')}
            </Link>
            {canEdit ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing('new');
                }}
              >
                <Plus className="size-4" aria-hidden /> {t('budgets_add')}
              </Button>
            ) : null}
          </span>
        }
      >
        <span id="budget-title">{t('budgets_section')}</span>
      </SectionTitle>
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !building || building.lines.length === 0 ? (
        <EmptyState title={t('budgets_emptyBuilding', { year })} />
      ) : (
        <>
          <BudgetLinesCard
            building={building}
            onEdit={canEdit ? setEditing : undefined}
            onDelete={
              canEdit
                ? (line) => {
                    if (window.confirm(t('budgets_deleteConfirm')))
                      del.mutate(line.budgetId, {
                        onSuccess: () => {
                          setNotice(t('budgets_deleted'));
                        },
                      });
                  }
                : undefined
            }
          />
          <p className="mt-2 text-[13px] text-ink-faint">{t('budgets_legend')}</p>
        </>
      )}
      {editing ? (
        <BudgetDialog
          buildingId={buildingId}
          year={year}
          line={editing === 'new' ? null : editing}
          taken={building?.lines.map((l) => l.categoryId) ?? []}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            setNotice(t('budgets_saved'));
          }}
        />
      ) : null}
    </section>
  );
}

function BudgetDialog({
  buildingId,
  year,
  line,
  taken,
  onClose,
  onSaved,
}: {
  buildingId: string;
  year: number;
  line: BudgetLineRow | null;
  /** Categories (null: the total) that already have a line this year. */
  taken: (string | null)[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, pick, num } = useBudgetText();
  const categories = useCategories();
  const create = useCreateBudget();
  const update = useUpdateBudget();
  const free = (categories.data ?? []).filter((c) => c.active && !taken.includes(c.id));
  const [categoryId, setCategoryId] = useState<string>(
    line ? (line.categoryId ?? '') : taken.includes(null) ? (free[0]?.id ?? '') : '',
  );
  const [amount, setAmount] = useState(line ? num(line.budgetFils) : '');
  const amountFils = parseAmountInput(amount);
  const valid =
    amountFils !== null && amountFils > 0 && (line !== null || !taken.includes(categoryId || null));
  const saving = create.isPending || update.isPending;
  const err = create.error ?? update.error;
  const save = () => {
    if (amountFils === null) return;
    const done = line
      ? update.mutateAsync({ id: line.budgetId, amountFils })
      : create.mutateAsync({ buildingId, year, categoryId: categoryId || null, amountFils });
    void done.then(onSaved).catch(() => undefined);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={line ? t('budgets_editTitle') : t('budgets_addTitle')}
      description={String(year)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('budgets_cancel')}
          </Button>
          <Button disabled={!valid} loading={saving} onClick={save}>
            {t('budgets_save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('budgets_category')} required>
          <Select
            value={categoryId}
            disabled={line !== null}
            onChange={(e) => {
              setCategoryId(e.target.value);
            }}
          >
            {line !== null || !taken.includes(null) ? (
              <option value="">{t('budgets_categoryTotal')}</option>
            ) : null}
            {(line ? (categories.data ?? []) : free).map((c) => (
              <option key={c.id} value={c.id}>
                {pick(c.nameAr, c.nameEn)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('budgets_amount')} hint={t('budgets_amount_hint')} required>
          <Input
            value={amount}
            inputMode="decimal"
            dir="ltr"
            className="tnum"
            onChange={(e) => {
              setAmount(e.target.value);
            }}
          />
        </Field>
        {err ? (
          <p className="text-[13px] text-danger" role="alert">
            {err instanceof ApiRequestError && err.status === 409
              ? t('budgets_exists')
              : t('budgets_error')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** /budgets?year=: every building with a budget that year, each linking to its building page. */
export function BudgetsPage() {
  const { t, pick } = useBudgetText();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- routes carry no search schema
  const url = useSearch({ strict: false }) as { year?: unknown };
  const fromUrl = Number(url.year);
  const year =
    Number.isInteger(fromUrl) && fromUrl >= 2020 && fromUrl <= 2100 ? fromUrl : currentYear();
  const navigate = useNavigate();
  const q = useBudgetReport(year);
  return (
    <Page>
      <PageHeader
        title={t('budgets_title')}
        subtitle={t('budgets_subtitle')}
        actions={
          <YearSelect
            year={year}
            onChange={(y) => {
              void navigate({ to: '.', replace: true, search: { year: y } } as never);
            }}
          />
        }
      />
      {q.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.buildings.length === 0 ? (
        <EmptyState title={t('budgets_empty')} />
      ) : (
        <div className="flex flex-col gap-6">
          {q.data.buildings.map((b) => (
            <section key={b.buildingId} aria-label={pick(b.nameAr, b.nameEn)}>
              <SectionTitle>
                <Link
                  to="/buildings/$buildingId"
                  params={{ buildingId: b.buildingId }}
                  className="hover:underline"
                >
                  {pick(b.nameAr, b.nameEn)}
                </Link>
              </SectionTitle>
              <BudgetLinesCard building={b} />
            </section>
          ))}
          <p className="text-[13px] text-ink-faint">{t('budgets_legend')}</p>
        </div>
      )}
    </Page>
  );
}
