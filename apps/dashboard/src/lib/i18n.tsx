import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  formatAmount,
  formatDate,
  formatMonth,
  formatNumber,
  type Lang,
  type PlainDate,
} from '@vamar/shared';
import { messages, type MessageKey } from './messages';

interface I18n {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  money: (fils: number | null | undefined) => string;
  num: (fils: number) => string;
  date: (d: string | null | undefined) => string;
  month: (d: string) => string;
  dateTime: (iso: string | Date | null | undefined) => string;
  /** Pick the Arabic or English variant of a bilingual pair. */
  pick: (ar: string, en: string) => string;
}

const Ctx = createContext<I18n | null>(null);
const STORAGE_KEY = 'vamar.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    // private mode
  }
  return 'ar';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = messages[lang];
    const timeFmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', {
      timeZone: 'Asia/Dubai',
      hour: '2-digit',
      minute: '2-digit',
    });
    return {
      lang,
      dir,
      setLang,
      t: (key, vars) => {
        let s = dict[key];
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
        return s;
      },
      money: (fils) => (fils === null || fils === undefined ? '—' : formatAmount(fils, lang)),
      num: (fils) => formatNumber(fils, lang),
      date: (d) => (d ? formatDate(d as PlainDate, lang) : '—'),
      month: (d) => formatMonth(d as PlainDate, lang),
      dateTime: (iso) => {
        if (!iso) return '—';
        const d = typeof iso === 'string' ? new Date(iso) : iso;
        const day = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Dubai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(d) as PlainDate;
        return `${formatDate(day, lang)} ${timeFmt.format(d)}`;
      },
      pick: (ar, en) => (lang === 'ar' ? ar : en),
    };
  }, [lang, dir, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside LangProvider');
  return v;
}
