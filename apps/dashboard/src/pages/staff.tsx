import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useStaff, useStaffMutations } from '@/lib/queries';
import type { StaffRow } from '@/lib/types';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

/** Roles the client uses: Admin and Data entry (the `editor` role). `viewer` exists in the API but is hidden here. */
const UI_ROLES = [
  { value: 'admin', ar: 'مدير', en: 'Admin' },
  { value: 'editor', ar: 'إدخال بيانات', en: 'Data entry' },
] as const;

export function roleLabel(role: StaffRow['role'], lang: 'ar' | 'en'): string {
  const r = UI_ROLES.find((x) => x.value === role);
  return r ? r[lang] : role;
}

export function StaffPage() {
  const { t, lang, dateTime } = useI18n();
  const auth = useAuth();
  const q = useStaff();
  const m = useStaffMutations();
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<StaffRow | null>(null);
  const rows = (q.data ?? []).filter((s) => s.role !== 'viewer');

  return (
    <Page>
      <PageHeader
        title={t('staff_title')}
        actions={
          <Button
            onClick={() => {
              setInviting(true);
            }}
          >
            <Plus className="size-4" aria-hidden /> {t('staff_invite')}
          </Button>
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {q.isPending ? (
        <SkeletonRows cols={4} rows={3} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty_generic')} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[15px]">
            <thead>
              <tr className="row-line text-[13px] text-ink-soft">
                <th className="px-4 py-2 text-start font-medium">{t('staff_name')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('email')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('staff_role')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('staff_totp')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const self = s.id === auth.user?.id;
                return (
                  <tr key={s.id} className="row-line last:border-b-0">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3" dir="ltr">
                      {s.email}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={s.role}
                        disabled={self}
                        aria-label={`${t('staff_role')}: ${s.name}`}
                        onChange={(e) => {
                          m.update.mutate({ id: s.id, patch: { role: e.target.value } });
                        }}
                        className="h-10 w-44"
                      >
                        {UI_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r[lang]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      <span className="block">
                        {s.totpEnabled ? t('staff_totp_on') : t('staff_totp_off')}
                      </span>
                      <label className="mt-1 flex items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          checked={s.totpRequired}
                          disabled={self}
                          onChange={(e) => {
                            m.update.mutate({
                              id: s.id,
                              patch: { totpRequired: e.target.checked },
                            });
                          }}
                        />
                        {t('staff_totpRequired')}:{' '}
                        {s.totpRequired ? t('staff_totpRequired_on') : t('staff_totpRequired_off')}
                      </label>
                    </td>
                    <td className="px-4 py-3">
                      <span className={s.active ? 'text-status-cleared' : 'text-ink-soft'}>
                        {s.active ? t('staff_active') : t('staff_inactive')}
                      </span>
                      <span className="block text-[13px] text-ink-faint tnum">
                        {dateTime(s.createdAt)}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setResetFor(s);
                          }}
                        >
                          {t('staff_resetTotp')}
                        </Button>
                        {!self ? (
                          <Button
                            size="sm"
                            variant={s.active ? 'danger' : 'secondary'}
                            onClick={() => {
                              m.update.mutate({ id: s.id, patch: { active: !s.active } });
                            }}
                          >
                            {s.active ? t('staff_deactivate') : t('staff_activate')}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        onDone={() => {
          setInviting(false);
          setNotice(t('staff_invited'));
        }}
      />
      <Dialog
        open={resetFor !== null}
        onOpenChange={(o) => {
          if (!o) setResetFor(null);
        }}
        title={t('staff_resetTotp')}
        description={t('staff_resetTotp_body')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setResetFor(null);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              loading={m.resetTotp.isPending}
              onClick={() => {
                if (resetFor)
                  void m.resetTotp.mutateAsync(resetFor.id).then(() => {
                    setResetFor(null);
                  });
              }}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p className="text-[15px]">{resetFor?.name}</p>
      </Dialog>
    </Page>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const m = useStaffMutations();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'editor'>('editor');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('staff_invite')}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={!email.includes('@') || name.trim().length === 0}
            loading={m.invite.isPending}
            onClick={() => {
              void m.invite
                .mutateAsync({ email: email.trim(), name: name.trim(), role })
                .then(() => {
                  setEmail('');
                  setName('');
                  onDone();
                });
            }}
          >
            {t('staff_invite')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('staff_name')} required>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <Field label={t('email')} required>
          <Input
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </Field>
        <Field label={t('staff_role')} required>
          <Select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as 'admin' | 'editor');
            }}
          >
            {UI_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r[lang]}
              </option>
            ))}
          </Select>
        </Field>
        {m.invite.isError ? <p className="text-[13px] text-danger">{t('error_conflict')}</p> : null}
      </div>
    </Dialog>
  );
}
