import { useNavigate } from '@tanstack/react-router';
import QRCode from 'qrcode';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Button, Field, Input } from '@/ui/primitives';
import { Logo } from '@/ui/logo';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();

  useEffect(() => {
    if (auth.stage === 'authenticated') void navigate({ to: '/' });
  }, [auth.stage, navigate]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-primary">
          <Logo variant="full" height={96} title="Vamar Real Estate" />
          <p className="text-[13px] text-ink-soft">{t('login_subtitle')}</p>
        </div>
        <div className="card p-6">
          {auth.stage === 'pre-mfa' ? (
            auth.totpEnrolled ? (
              <TotpVerify />
            ) : (
              <TotpSetup />
            )
          ) : (
            <Credentials />
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setLang(lang === 'ar' ? 'en' : 'ar');
          }}
          className="mt-6 h-11 px-2 text-[13px] text-ink-soft hover:text-ink"
        >
          {t('language')}
        </button>
      </div>
    </div>
  );
}

function Credentials() {
  const auth = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('reason') === 'expired'
      ? t('session_expired')
      : null,
  );

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(email.trim(), password);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'email_unverified')
        setError(t('login_emailUnverified'));
      else if (err instanceof ApiRequestError && err.status === 403) setError(t('login_not_staff'));
      else if (err instanceof ApiRequestError && err.status === 429)
        setError(t('login_rateLimited'));
      else setError(t('login_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <h1 className="text-heading font-semibold">{t('login_title')}</h1>
      <Field label={t('email')} required>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          dir="ltr"
          required
        />
      </Field>
      <Field label={t('password')} required>
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          dir="ltr"
          required
        />
      </Field>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={busy} className="mt-2 w-full">
        {busy ? t('signingIn') : t('signIn')}
      </Button>
    </form>
  );
}

function TotpVerify({ onBack }: { onBack?: () => void }) {
  const auth = useAuth();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError(null);
    try {
      await auth.totpVerify(code);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === 'totp_locked'
          ? t('totp_locked')
          : t('totp_wrong'),
      );
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div>
        <h1 className="text-heading font-semibold">{t('totp_title')}</h1>
        <p className="mt-1 text-[15px] text-ink-soft">{t('totp_subtitle')}</p>
      </div>
      <p className="text-[13px] text-ink-soft">{t('totp_help')}</p>
      <Field label={t('totp_code')} required>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''));
          }}
          numeric
          className="text-center text-[24px] tracking-[0.3em]"
          autoFocus
        />
      </Field>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={busy} disabled={code.length !== 6} className="w-full">
        {t('totp_verify')}
      </Button>
      <details className="text-[13px] text-ink-soft">
        <summary className="cursor-pointer text-primary">{t('totp_noCode')}</summary>
        <p className="mt-1">{t('totp_noCode_body')}</p>
      </details>
      <Button
        variant="ghost"
        onClick={() => {
          if (onBack) onBack();
          else void auth.logout();
        }}
      >
        {t('back')}
      </Button>
    </form>
  );
}

function TotpSetup() {
  const auth = useAuth();
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void auth
      .totpSetup()
      .then(async (r) => {
        if (cancelled) return;
        setSecret(r.secret);
        setQr(
          await QRCode.toDataURL(r.otpauthUri, {
            margin: 1,
            width: 220,
            color: { dark: '#162842', light: '#ffffff' },
          }),
        );
      })
      .catch(() => {
        setError(t('error_generic'));
      });
    return () => {
      cancelled = true;
    };
  }, [auth, t]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-heading font-semibold">{t('totp_setup_title')}</h1>
        <p className="mt-1 text-[15px] text-ink-soft">{t('totp_setup_subtitle')}</p>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-center rounded-md border border-line bg-white p-3">
        {qr ? (
          <img src={qr} alt="QR" width={220} height={220} />
        ) : (
          <div className="skeleton size-[220px]" />
        )}
      </div>
      {secret ? (
        <div>
          <p className="text-[13px] text-ink-soft">{t('totp_manual')}</p>
          <code
            dir="ltr"
            className="mt-1 block select-all rounded-sm bg-sunken px-3 py-2 text-center text-[15px] tracking-widest"
          >
            {secret.replace(/(.{4})/g, '$1 ').trim()}
          </code>
        </div>
      ) : null}
      <TotpVerify />
    </div>
  );
}
