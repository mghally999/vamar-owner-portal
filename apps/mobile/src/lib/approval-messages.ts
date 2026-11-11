/**
 * Copy for owner approval of large repairs, Arabic first, Western digits. Its own dictionary so
 * the feature does not touch the shared messages file; `vars` work as in useI18n().t.
 */
import { useCallback } from 'react';
import type { Lang } from '@vamar/shared';
import { useI18n } from './i18n';

const ar = {
  approvals_title: 'طلبات الموافقة',
  approval_detail: 'طلب موافقة',
  approvals_empty: 'لا توجد طلبات موافقة.',
  approvals_banner: 'بانتظار موافقتك ({count})',
  approvals_banner_body: 'أعمال صيانة كبيرة تحتاج ردك قبل البدء.',
  approval_card_title: 'مطلوب موافقتك',
  approval_card_open: 'عرض الطلب',
  approval_estimate: 'التكلفة التقديرية',
  approval_share: 'حصتك',
  approval_vendor: 'المقاول',
  approval_reason: 'السبب',
  approval_asked: 'تاريخ الطلب',
  approval_photos: 'الصور والعرض',
  approval_no_photos: 'لا توجد صور.',
  approval_deadline: 'إن لم ترد قبل {date} تُعتبر موافقاً.',
  approval_note: 'ملاحظة (اختيارية)',
  approval_note_placeholder: 'اكتب ملاحظة لفريق فامار',
  approval_approve: 'موافقة',
  approval_reject: 'رفض',
  approval_reject_confirm: 'تأكيد الرفض',
  approval_reject_hint: 'لن يبدأ العمل قبل مراجعة فريق فامار لرفضك.',
  approval_cancel: 'إلغاء',
  approval_your_answer: 'ردك',
  approval_your_note: 'ملاحظتك',
  approval_answered_on: 'تاريخ الرد',
  approval_not_waiting: 'لم يعد هذا العمل بانتظار ردك.',
  approval_error: 'تعذّر إرسال ردك. حاول مرة أخرى.',
  approval_kind_expense: 'مصروف',
  approval_kind_work_order: 'صيانة',
};

const en: Record<keyof typeof ar, string> = {
  approvals_title: 'Approval requests',
  approval_detail: 'Approval request',
  approvals_empty: 'No approval requests.',
  approvals_banner: 'Awaiting your approval ({count})',
  approvals_banner_body: 'Large repairs need your answer before work starts.',
  approval_card_title: 'Your approval is needed',
  approval_card_open: 'Open the request',
  approval_estimate: 'Estimated cost',
  approval_share: 'Your share',
  approval_vendor: 'Contractor',
  approval_reason: 'Reason',
  approval_asked: 'Requested on',
  approval_photos: 'Photos and quote',
  approval_no_photos: 'No photos.',
  approval_deadline: "If you don't answer by {date} it counts as approved.",
  approval_note: 'Note (optional)',
  approval_note_placeholder: 'Write a note for the Vamar team',
  approval_approve: 'Approve',
  approval_reject: 'Reject',
  approval_reject_confirm: 'Confirm rejection',
  approval_reject_hint: 'Work will not start until the Vamar team has reviewed your rejection.',
  approval_cancel: 'Cancel',
  approval_your_answer: 'Your answer',
  approval_your_note: 'Your note',
  approval_answered_on: 'Answered on',
  approval_not_waiting: 'This job no longer needs your answer.',
  approval_error: 'Your answer could not be sent. Please try again.',
  approval_kind_expense: 'Expense',
  approval_kind_work_order: 'Maintenance',
};

export type ApprovalMessageKey = keyof typeof ar;
export const approvalMessages: Record<Lang, Record<ApprovalMessageKey, string>> = { ar, en };

/** Plain lookup for places outside a component tree that already know the language. */
export function approvalText(
  lang: Lang,
  key: ApprovalMessageKey,
  vars?: Record<string, string | number>,
): string {
  let s = approvalMessages[lang][key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function useApprovalText() {
  const { lang } = useI18n();
  return useCallback(
    (key: ApprovalMessageKey, vars?: Record<string, string | number>) =>
      approvalText(lang, key, vars),
    [lang],
  );
}
