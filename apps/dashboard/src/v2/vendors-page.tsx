import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  SkeletonRows,
  Textarea,
  Toast,
} from '@/ui/primitives';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';
import { useV2 } from './messages';
import { useSaveVendor, useVendors } from './queries';
import type { Vendor } from './types';

/** Suppliers of the expenses; a TRN means 5 % VAT is proposed on their invoices. */
export function VendorsPage() {
  const { t } = useV2();
  const auth = useAuth();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const debounced = useDebounced(search.trim(), 300);
  const q = useVendors({ search: debounced || undefined, includeInactive: showInactive });
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = auth.hasRole('editor');

  return (
    <Page>
      <PageHeader
        title={t('vendors_title')}
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus className="size-4" aria-hidden /> {t('vendors_new')}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          placeholder={t('search')}
          aria-label={t('search')}
          className="w-64"
        />
        <Checkbox
          label={t('vendors_showInactive')}
          checked={showInactive}
          onChange={(e) => {
            setShowInactive(e.target.checked);
          }}
        />
      </div>
      {q.isPending ? (
        <SkeletonRows cols={4} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title={t('vendors_empty')} />
      ) : (
        <Card className="overflow-x-auto">
          <ResponsiveTable className="w-full min-w-[720px] text-[15px]">
            <thead>
              <tr className="row-line text-[13px] text-ink-soft">
                <th className="px-4 py-2 text-start font-medium">{t('vendors_name')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('vendors_phone')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('vendors_email')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('vendors_trn')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {q.data.map((v) => (
                <tr key={v.id} className="row-line last:border-b-0">
                  <td className="px-4 py-3 font-medium">{v.name}</td>
                  <td className="px-4 py-3 tnum" dir="ltr">
                    {v.phone ?? '—'}
                  </td>
                  <td className="px-4 py-3" dir="ltr">
                    {v.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 tnum" dir="ltr">
                    {v.trn ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={v.active ? 'text-status-cleared' : 'text-ink-faint'}>
                      {v.active ? t('active') : t('inactive')}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-end">
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(v);
                        }}
                      >
                        {t('edit')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
        </Card>
      )}
      {editing ? (
        <VendorDialog
          vendor={editing === 'new' ? null : editing}
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

function VendorDialog({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: Vendor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useV2();
  const save = useSaveVendor();
  const [name, setName] = useState(vendor?.name ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [trn, setTrn] = useState(vendor?.trn ?? '');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [active, setActive] = useState(vendor?.active ?? true);
  const trnOk = trn.trim() === '' || /^\d{15}$/.test(trn.trim());
  const valid = name.trim() !== '' && trnOk;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={vendor ? t('edit') : t('vendors_new')}
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
                  ...(vendor ? { id: vendor.id } : {}),
                  name: name.trim(),
                  phone: phone.trim() || null,
                  email: email.trim() || null,
                  trn: trn.trim() || null,
                  notes: notes.trim(),
                  active,
                })
                .then(onSaved)
            }
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t('vendors_name')} required>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </Field>
        </div>
        <Field label={t('vendors_phone')}>
          <Input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
            numeric
            inputMode="tel"
            placeholder="+9714..."
          />
        </Field>
        <Field label={t('vendors_email')}>
          <Input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            type="email"
            dir="ltr"
          />
        </Field>
        <Field
          label={t('vendors_trn')}
          hint={t('vendors_trn_hint')}
          error={trnOk ? undefined : t('vendors_trn_hint')}
        >
          <Input
            value={trn}
            onChange={(e) => {
              setTrn(e.target.value);
            }}
            numeric
            inputMode="numeric"
            invalid={!trnOk}
          />
        </Field>
        <div className="flex items-end">
          <Checkbox
            label={t('active')}
            checked={active}
            onChange={(e) => {
              setActive(e.target.checked);
            }}
          />
        </div>
        <div className="sm:col-span-2">
          <Field label={t('vendors_notes')}>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              rows={2}
            />
          </Field>
        </div>
        {save.isError ? (
          <p className="text-[13px] text-danger sm:col-span-2">{t('error_generic')}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
