import { getLocales } from 'expo-localization';
import * as Updates from 'expo-updates';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { I18nManager } from 'react-native';
import {
  formatAmount,
  formatDate,
  formatMonth,
  formatNumber,
  type Lang,
  type PlainDate,
} from '@vamar/shared';
import { messages, type MessageKey } from './messages';
import { getItem, setItem } from './storage';

interface I18n {
  lang: Lang;
  isRTL: boolean;
  ready: boolean;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  money: (fils: number | null | undefined) => string;
  num: (fils: number) => string;
  date: (d: string | null | undefined) => string;
  month: (d: string) => string;
  pick: (ar: string, en: string) => string;
  /** Switch language: persists, flips RTL, and reloads the app (RN needs a restart for RTL). */
  switchLang: (l: Lang) => Promise<void>;
}

const Ctx = createContext<I18n | null>(null);

function deviceDefault(): Lang {
  const first = getLocales().at(0);
  return first?.languageCode === 'en' ? 'en' : 'ar';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('ar');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const saved = await getItem('lang');
      const l: Lang = saved === 'en' || saved === 'ar' ? saved : deviceDefault();
      setLang(l);
      const rtl = l === 'ar';
      if (I18nManager.isRTL !== rtl) {
        // React Native applies the layout direction on the next launch, so the very first
        // start in Arabic flips the flag and reloads once instead of showing an LTR screen.
        I18nManager.allowRTL(rtl);
        I18nManager.forceRTL(rtl);
        try {
          await Updates.reloadAsync();
          return;
        } catch {
          // Reload unavailable (plain dev client): continue with the current direction.
        }
      }
      setReady(true);
    })();
  }, []);

  const switchLang = useCallback(async (l: Lang) => {
    await setItem('lang', l);
    const rtl = l === 'ar';
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
    setLang(l);
    try {
      await Updates.reloadAsync();
    } catch {
      // In a dev client reloadAsync may be unavailable; the new direction applies on next launch.
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = messages[lang];
    return {
      lang,
      isRTL: lang === 'ar',
      ready,
      t: (key, vars) => {
        let s = dict[key];
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
        return s;
      },
      money: (fils) => (fils === null || fils === undefined ? '—' : formatAmount(fils, lang)),
      num: (fils) => formatNumber(fils, lang),
      date: (d) => (d ? formatDate(d as PlainDate, lang) : '—'),
      month: (d) => formatMonth(d as PlainDate, lang),
      pick: (ar, en) => (lang === 'ar' ? ar : en),
      switchLang,
    };
  }, [lang, ready, switchLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside LangProvider');
  return v;
}
