/**
 * Copy for the building budget card, Arabic first, Western digits. Its own dictionary so the
 * feature does not touch the shared messages file; `vars` work as in useI18n().t.
 */
import { useCallback } from 'react';
import { BUDGET_LEVEL_LABEL, BUDGET_TOTAL_LABEL, type BudgetLevel, type Lang } from '@vamar/shared';
import { useI18n } from './i18n';

const ar = {
  budget_title: 'ميزانية {year}',
  budget_spent: 'صُرف {actual} من {budget}',
  budget_forecast: 'المتوقع مع التكاليف الثابتة المتبقية: {forecast} ({pct}%)',
  budget_note: 'أرقام المبنى كاملة كما تديرها فامار، لا حصتك.',
};

const en: Record<keyof typeof ar, string> = {
  budget_title: '{year} budget',
  budget_spent: '{actual} spent of {budget}',
  budget_forecast: 'Expected with the fixed costs still due: {forecast} ({pct}%)',
  budget_note: "The building's full figures as Vamar manages them, not your share.",
};

export type BudgetMessageKey = keyof typeof ar;
export const budgetMessages: Record<Lang, Record<BudgetMessageKey, string>> = { ar, en };

export function useBudgetText() {
  const { lang } = useI18n();
  const t = useCallback(
    (key: BudgetMessageKey, vars?: Record<string, string | number>) => {
      let s = budgetMessages[lang][key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );
  const levelLabel = useCallback((l: BudgetLevel) => BUDGET_LEVEL_LABEL[l][lang], [lang]);
  return { t, levelLabel, totalLabel: BUDGET_TOTAL_LABEL[lang] };
}
