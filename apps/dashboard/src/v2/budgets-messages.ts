/* UI copy for building budgets (building page, the budgets page, Today). Arabic first. */
import { useCallback } from 'react';
import { BUDGET_LEVEL_LABEL, BUDGET_TOTAL_LABEL, type BudgetLevel } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';

const ar = {
  budgets_title: 'الميزانيات',
  budgets_subtitle:
    'ميزانية كل مبنى للسنة مقابل المصروفات المرحّلة (إجمالي المبنى، لا حصص الملاك) والتكاليف الثابتة المتبقية من القواعد المتكررة.',
  budgets_section: 'الميزانية',
  budgets_year: 'السنة',
  budgets_empty: 'لا توجد ميزانيات لهذه السنة.',
  budgets_emptyBuilding: 'لم تُحدَّد ميزانية لهذا المبنى في {year}.',
  budgets_all: 'كل الميزانيات',
  budgets_add: 'إضافة بند',
  budgets_addTitle: 'بند ميزانية جديد',
  budgets_editTitle: 'تعديل الميزانية',
  budgets_category: 'الفئة',
  budgets_categoryTotal: 'إجمالي المصروفات (كل الفئات)',
  budgets_amount: 'الميزانية السنوية (درهم)',
  budgets_amount_hint: 'تُنبَّه الإدارة والملاك عند بلوغ 80% و100% منها.',
  budgets_spent: 'صُرف {actual} من {budget}',
  budgets_toDate: 'منذ بداية السنة: {actual} مقابل {budget} المتوقع حتى اليوم ({pct}%)',
  budgets_forecast: 'مع التكاليف الثابتة المتبقية ({projected}): {forecast} ({pct}%)',
  budgets_forecastOver: 'المتوقع يتجاوز الميزانية',
  budgets_deleteConfirm: 'حذف هذا البند من الميزانية؟',
  budgets_delete: 'حذف {name}',
  budgets_edit: 'تعديل {name}',
  budgets_exists: 'لهذا المبنى بند بهذه الفئة في هذه السنة. عدّل المبلغ بدلاً من ذلك.',
  budgets_saved: 'تم حفظ الميزانية.',
  budgets_deleted: 'تم حذف البند.',
  budgets_error: 'تعذّر الحفظ. حاول مرة أخرى.',
  budgets_legend: 'الشريط: المصروف الفعلي، والجزء الفاتح التكاليف الثابتة المتبقية.',
  budgets_cancel: 'إلغاء',
  budgets_save: 'حفظ',
  today_budgets: 'بنود ميزانية تجاوزت 80%',
  today_budgets_over: 'منها {n} نفدت',
};

const en: Record<keyof typeof ar, string> = {
  budgets_title: 'Budgets',
  budgets_subtitle:
    "Each building's budget for the year against posted expenses (the building's totals, not owner shares) and the fixed costs still due from the recurring rules.",
  budgets_section: 'Budget',
  budgets_year: 'Year',
  budgets_empty: 'No budgets for this year.',
  budgets_emptyBuilding: 'No budget set for this building in {year}.',
  budgets_all: 'All budgets',
  budgets_add: 'Add line',
  budgets_addTitle: 'New budget line',
  budgets_editTitle: 'Change budget',
  budgets_category: 'Category',
  budgets_categoryTotal: 'All expenses (every category)',
  budgets_amount: 'Yearly budget (AED)',
  budgets_amount_hint: 'Staff and owners are alerted at 80% and at 100% of it.',
  budgets_spent: '{actual} spent of {budget}',
  budgets_toDate: 'Year to date: {actual} against {budget} expected by today ({pct}%)',
  budgets_forecast: 'With the fixed costs still due ({projected}): {forecast} ({pct}%)',
  budgets_forecastOver: 'Forecast over budget',
  budgets_deleteConfirm: 'Remove this budget line?',
  budgets_delete: 'Remove {name}',
  budgets_edit: 'Change {name}',
  budgets_exists: 'This building already has that line for the year. Change its amount instead.',
  budgets_saved: 'Budget saved.',
  budgets_deleted: 'Line removed.',
  budgets_error: 'Could not save. Please try again.',
  budgets_legend: 'Bar: actual spend; the lighter part is the fixed costs still due.',
  budgets_cancel: 'Cancel',
  budgets_save: 'Save',
  today_budgets: 'Budget lines past 80%',
  today_budgets_over: '{n} used up',
};

type Key = keyof typeof ar;
export const budgetMessages = { ar, en };
export type BudgetMessageKey = Key;

/** The lib i18n helpers plus `t` over the budget dictionary and the shared level labels. */
export function useBudgetText() {
  const i18n = useI18n();
  const dict = budgetMessages[i18n.lang];
  const t = useCallback(
    (key: Key, vars?: Record<string, string | number>) => {
      let s: string = dict[key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [dict],
  );
  const levelLabel = useCallback((l: BudgetLevel) => BUDGET_LEVEL_LABEL[l][i18n.lang], [i18n.lang]);
  return { ...i18n, t, levelLabel, totalLabel: BUDGET_TOTAL_LABEL[i18n.lang] };
}
