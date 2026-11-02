/** New expense: the form creates a draft and opens it so staff can attach the invoice and post. */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCreateExpense } from '@/lib/queries-v2';
import { ExpenseForm } from '@/ui/expense-form';
import { Button, PageHeader } from '@/ui/primitives';
import { Page } from '@/ui/shell';

export function ExpenseNewPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- routes carry no search schema
  const search = useSearch({ strict: false }) as { workOrderId?: string };
  const create = useCreateExpense();
  const [error, setError] = useState<string | null>(null);
  return (
    <Page>
      <PageHeader title={t('expenses_new')} />
      <ExpenseForm
        workOrderId={search.workOrderId}
        submitLabel={t('contract_saveDraft')}
        busy={create.isPending}
        error={error}
        onSubmit={(values) => {
          setError(null);
          create
            .mutateAsync(values)
            .then((r) => navigate({ to: '/expenses/$expenseId', params: { expenseId: r.id } }))
            .catch((e: unknown) => {
              setError(e instanceof ApiRequestError ? e.message : t('error_generic'));
            });
        }}
        extraActions={
          <Button variant="secondary" onClick={() => void navigate({ to: '/expenses' })}>
            {t('cancel')}
          </Button>
        }
      />
    </Page>
  );
}
