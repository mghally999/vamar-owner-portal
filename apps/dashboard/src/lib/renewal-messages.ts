/* UI copy for renewal suggestions and reminders. Arabic first in use; same keys in both. */
import { useCallback } from 'react';
import type { Emirate } from '@vamar/shared';
import { useI18n } from './i18n';

const en = {
  renewal_title: 'Renewal suggestion',
  renewal_dueToday: 'Renewal due today',
  renewal_dueTomorrow: 'Renewal due tomorrow',
  renewal_dueInTwo: 'Renewal due in 2 days',
  renewal_dueInFew: 'Renewal due in {n} days',
  renewal_dueInMany: 'Renewal due in {n} days',
  renewal_current: 'Current rent',
  renewal_suggested: 'Suggested rent',
  renewal_suggested_hint: 'Pre-filled when you prepare the renewal; you can change it.',

  renewal_market_title: 'Market reference',
  renewal_market_source: 'Based on Vamar’s recent contracts. Not an official rent index.',
  renewal_scope_building:
    'Similar units in the same building, contracts started in the last 12 months.',
  renewal_scope_area: 'Similar units in the same area, contracts started in the last 12 months.',
  renewal_scope_emirate:
    'Similar units in the same emirate, contracts started in the last 12 months.',
  renewal_median: 'Median per sq ft a year',
  renewal_range: 'Range per sq ft a year',
  renewal_reference: 'Reference for this unit ({size} sq ft)',
  renewal_comparables: 'Contracts used ({n})',
  renewal_comparablesFound: 'Contracts found ({n})',
  renewal_col_unit: 'Unit',
  renewal_col_start: 'Start date',
  renewal_col_rent: 'Annual rent',
  renewal_col_perSqft: 'Per sq ft',
  renewal_notEnough:
    'Not enough data: {n} similar contracts started in the last 12 months, at least {min} are needed.',
  renewal_noSize:
    'This unit has no size in sq ft, so it cannot be compared. Add the size on the unit page.',

  renewal_cap_title: 'Dubai rent increase cap',
  renewal_cap_below:
    'The current rent is {gap}% below the reference, so the allowed increase is {pct}%.',
  renewal_cap_notBelow: 'The current rent is at or above the reference, so no increase is allowed.',
  renewal_cap_max: 'Maximum new rent',
  renewal_cap_rule:
    'Decree No. 43 of 2013, by how far the rent is below the reference: up to 10%, no increase; 11–20%, up to 5%; 21–30%, up to 10%; 31–40%, up to 15%; more than 40%, up to 20%.',
  renewal_cap_noReference:
    'Without a market reference the Dubai cap cannot be worked out here. Check the RERA rental index before agreeing an increase.',
  renewal_checkRules: 'Check the emirate’s rent rules',
  renewal_checkRules_body:
    'No cap is worked out for {emirate}. The suggested rent stays at the current rent.',
  renewal_emirate_unknown: 'this building (its area names no emirate)',
  emirate_dubai: 'Dubai',
  emirate_sharjah: 'Sharjah',
  emirate_abu_dhabi: 'Abu Dhabi',
  emirate_ajman: 'Ajman',
  emirate_umm_al_quwain: 'Umm Al Quwain',
  emirate_ras_al_khaimah: 'Ras Al Khaimah',
  emirate_fujairah: 'Fujairah',

  renewal_prepare: 'Prepare renewal',
  renewal_openDraft: 'Open renewal draft',
  renewal_alreadyRenewed: 'This contract already has a renewal.',
  renewal_dialog_body:
    'Creates a draft from {start} with the same tenant and number of cheques. Check the rent before you create it.',
  renewal_rent_label: 'New annual rent (AED)',
  renewal_rent_invalid: 'Enter an amount in AED.',
  renewal_rent_overCap: 'Above the Dubai cap of {max}.',
  renewal_create: 'Create draft',
  renewal_unavailable: 'The renewal suggestion could not be loaded.',
  renewal_seeAll: 'All contracts due for renewal',
};

export type RenewalMessageKey = keyof typeof en;

const ar: Record<RenewalMessageKey, string> = {
  renewal_title: 'اقتراح التجديد',
  renewal_dueToday: 'التجديد مستحق اليوم',
  renewal_dueTomorrow: 'التجديد مستحق غداً',
  renewal_dueInTwo: 'التجديد مستحق خلال يومين',
  renewal_dueInFew: 'التجديد مستحق خلال {n} أيام',
  renewal_dueInMany: 'التجديد مستحق خلال {n} يوماً',
  renewal_current: 'الإيجار الحالي',
  renewal_suggested: 'الإيجار المقترح',
  renewal_suggested_hint: 'يُعبّأ تلقائياً عند تحضير التجديد، ويمكنك تغييره.',

  renewal_market_title: 'مرجع السوق',
  renewal_market_source: 'مبني على عقود فامار الأخيرة، وليس مؤشراً رسمياً للإيجارات.',
  renewal_scope_building: 'وحدات مشابهة في المبنى نفسه، عقود بدأت خلال آخر 12 شهراً.',
  renewal_scope_area: 'وحدات مشابهة في المنطقة نفسها، عقود بدأت خلال آخر 12 شهراً.',
  renewal_scope_emirate: 'وحدات مشابهة في الإمارة نفسها، عقود بدأت خلال آخر 12 شهراً.',
  renewal_median: 'الوسيط للقدم المربع سنوياً',
  renewal_range: 'النطاق للقدم المربع سنوياً',
  renewal_reference: 'المرجع لهذه الوحدة ({size} قدم مربع)',
  renewal_comparables: 'العقود المستخدمة ({n})',
  renewal_comparablesFound: 'العقود التي وُجدت ({n})',
  renewal_col_unit: 'الوحدة',
  renewal_col_start: 'تاريخ البداية',
  renewal_col_rent: 'الإيجار السنوي',
  renewal_col_perSqft: 'للقدم المربع',
  renewal_notEnough:
    'البيانات غير كافية: عدد العقود المشابهة التي بدأت خلال آخر 12 شهراً {n}، والمطلوب {min} على الأقل.',
  renewal_noSize:
    'لا توجد مساحة بالقدم المربع لهذه الوحدة، فلا يمكن المقارنة. أضف المساحة من صفحة الوحدة.',

  renewal_cap_title: 'سقف زيادة الإيجار في دبي',
  renewal_cap_below: 'الإيجار الحالي أقل من المرجع بنسبة {gap}%، لذا الزيادة المسموحة {pct}%.',
  renewal_cap_notBelow: 'الإيجار الحالي يساوي المرجع أو يزيد عليه، لذا لا تُسمح بأي زيادة.',
  renewal_cap_max: 'الحد الأقصى للإيجار الجديد',
  renewal_cap_rule:
    'المرسوم رقم 43 لسنة 2013، بحسب الفرق بين الإيجار والمرجع: حتى 10% لا زيادة؛ من 11% إلى 20% زيادة حتى 5%؛ من 21% إلى 30% زيادة حتى 10%؛ من 31% إلى 40% زيادة حتى 15%؛ أكثر من 40% زيادة حتى 20%.',
  renewal_cap_noReference:
    'لا يمكن حساب سقف دبي هنا دون مرجع للسوق. راجع مؤشر الإيجارات لدى مؤسسة التنظيم العقاري (ريرا) قبل الاتفاق على أي زيادة.',
  renewal_checkRules: 'راجع قواعد الإيجار في الإمارة',
  renewal_checkRules_body:
    'لا يُحسب سقف للزيادة في {emirate}، ويبقى الإيجار المقترح هو الإيجار الحالي.',
  renewal_emirate_unknown: 'هذا المبنى (منطقته لا تذكر الإمارة)',
  emirate_dubai: 'دبي',
  emirate_sharjah: 'الشارقة',
  emirate_abu_dhabi: 'أبوظبي',
  emirate_ajman: 'عجمان',
  emirate_umm_al_quwain: 'أم القيوين',
  emirate_ras_al_khaimah: 'رأس الخيمة',
  emirate_fujairah: 'الفجيرة',

  renewal_prepare: 'تحضير التجديد',
  renewal_openDraft: 'فتح مسودة التجديد',
  renewal_alreadyRenewed: 'لهذا العقد تجديد بالفعل.',
  renewal_dialog_body:
    'يُنشئ مسودة تبدأ في {start} بالمستأجر نفسه وعدد الشيكات نفسه. تحقق من الإيجار قبل الإنشاء.',
  renewal_rent_label: 'الإيجار السنوي الجديد (درهم)',
  renewal_rent_invalid: 'أدخل مبلغاً بالدرهم.',
  renewal_rent_overCap: 'أعلى من سقف دبي البالغ {max}.',
  renewal_create: 'إنشاء المسودة',
  renewal_unavailable: 'تعذر تحميل اقتراح التجديد.',
  renewal_seeAll: 'كل العقود المستحقة للتجديد',
};

export const renewalMessages = { ar, en };

/** The lib i18n helpers plus `t` over the renewal dictionary (lib keys stay on `lib`). */
export function useRenewalI18n() {
  const i18n = useI18n();
  const dict = renewalMessages[i18n.lang];
  const t = useCallback(
    (key: RenewalMessageKey, vars?: Record<string, string | number>) => {
      let s: string = dict[key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [dict],
  );
  /** "Renewal due in N days", with the Arabic forms for 1, 2, 3–10 and 11 or more. */
  const dueLabel = useCallback(
    (n: number) => {
      if (n <= 0) return t('renewal_dueToday');
      if (n === 1) return t('renewal_dueTomorrow');
      if (n === 2) return t('renewal_dueInTwo');
      return t(n <= 10 ? 'renewal_dueInFew' : 'renewal_dueInMany', { n });
    },
    [t],
  );
  const emirateName = useCallback(
    (e: Emirate | null) => (e ? t(`emirate_${e}`) : t('renewal_emirate_unknown')),
    [t],
  );
  return { ...i18n, t, lib: i18n.t, dueLabel, emirateName };
}
