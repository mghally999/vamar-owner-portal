import { Plus } from 'lucide-react';
import { useState } from 'react';
import { EXPENSE_KINDS, EXPENSE_KIND_LABEL, type ExpenseKind } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  Checkbox,
  ErrorState,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  SkeletonRows,
  Toast,
} from '@/ui/primitives';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';
import { useV2 } from './messages';
import { useCategories, useSaveCategory } from './queries';
import type { ExpenseCategory } from './types';

/** Fixed and variable expense categories; admins add, rename, reorder and deactivate them. */
export function CategoriesPage() {
  const { t, lang } = useV2();
  const auth = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const q = useCategories(showInactive);
  const save = useSaveCategory();
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = auth.hasRole('admin');

  return (
    <Page>
      <PageHeader
        title={t('categories_title')}
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus className="size-4" aria-hidden /> {t('categories_new')}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      <Checkbox
        label={t('categories_showInactive')}
        checked={showInactive}
        onChange={(e) => {
          setShowInactive(e.target.checked);
        }}
      />
      {q.isPending ? (
        <SkeletonRows cols={3} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        EXPENSE_KINDS.map((kind) => (
          <section key={kind}>
            <SectionTitle>{EXPENSE_KIND_LABEL[kind][lang]}</SectionTitle>
            <Card className="overflow-x-auto">
              <ResponsiveTable className="w-full min-w-[520px] text-[15px]">
                <thead>
                  <tr className="row-line text-[13px] text-ink-soft">
                    <th className="px-4 py-2 text-start font-medium">{t('categories_nameAr')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('categories_nameEn')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('categories_sort')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {q.data
                    .filter((c) => c.kind === kind)
                    .map((c) => (
                      <tr key={c.id} className="row-line last:border-b-0">
                        <td className="px-4 py-3" dir="rtl">
                          {c.nameAr}
                        </td>
                        <td className="px-4 py-3" dir="ltr">
                          {c.nameEn}
                        </td>
                        <td className="px-4 py-3 tnum">{c.sort}</td>
                        <td className="px-4 py-3">
                          <span className={c.active ? 'text-status-cleared' : 'text-ink-faint'}>
                            {c.active ? t('active') : t('inactive')}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-end whitespace-nowrap">
                          {canEdit ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditing(c);
                                }}
                              >
                                {t('edit')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void save
                                    .mutateAsync({ id: c.id, active: !c.active })
                                    .then(() => {
                                      setNotice(t('saved'));
                                    })
                                }
                              >
                                {c.active ? t('categories_deactivate') : t('categories_activate')}
                              </Button>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </ResponsiveTable>
            </Card>
          </section>
        ))
      )}
      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            setNotice(t('saved'));
          }}
        />
      ) : null}
    </Page>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: ExpenseCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useV2();
  const save = useSaveCategory();
  const [nameAr, setNameAr] = useState(category?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(category?.nameEn ?? '');
  const [kind, setKind] = useState<ExpenseKind>(category?.kind ?? 'variable');
  const [sort, setSort] = useState(String(category?.sort ?? 0));
  const valid = nameAr.trim() !== '' && nameEn.trim() !== '' && /^\d+$/.test(sort);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={category ? t('edit') : t('categories_new')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={!valid}
            loading={save.isPending}
            onClick={() =>
              void save
                .mutateAsync({
                  ...(category ? { id: category.id } : {}),
                  nameAr: nameAr.trim(),
                  nameEn: nameEn.trim(),
                  kind,
                  sort: Number(sort),
                })
                .then(onSaved)
            }
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('categories_nameAr')} required>
          <Input
            value={nameAr}
            onChange={(e) => {
              setNameAr(e.target.value);
            }}
            dir="rtl"
          />
        </Field>
        <Field label={t('categories_nameEn')} required>
          <Input
            value={nameEn}
            onChange={(e) => {
              setNameEn(e.target.value);
            }}
            dir="ltr"
          />
        </Field>
        <Field label={t('categories_kind')} required>
          <Select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ExpenseKind);
            }}
            disabled={category !== null}
          >
            {EXPENSE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EXPENSE_KIND_LABEL[k][lang]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('categories_sort')} required>
          <Input
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
            }}
            numeric
            inputMode="numeric"
            className="w-32"
          />
        </Field>
        {save.isError ? <p className="text-[13px] text-danger">{t('error_generic')}</p> : null}
      </div>
    </Dialog>
  );
}
