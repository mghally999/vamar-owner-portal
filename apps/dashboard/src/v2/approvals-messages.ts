/* UI copy for owner approval of large repairs (work orders, expenses, settings, Today). Arabic first. */
import { useCallback } from 'react';
import { APPROVAL_STATE_LABEL, REPAIR_APPROVAL_STATUS_LABEL } from '@vamar/shared';
import type { ApprovalState, RepairApprovalStatus } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';

const ar = {
  approvals_title: 'موافقة الملاك',
  approvals_linkedJob: 'ردود الملاك على أمر الصيانة المرتبط بهذا المصروف.',
  approvals_askedAbout: 'طُلبت الموافقة على {amount}',
  approvals_owner: 'المالك',
  approvals_share: 'الحصة',
  approvals_status: 'الحالة',
  approvals_note: 'ملاحظة المالك',
  approvals_asked: 'تاريخ الطلب',
  approvals_answered: 'تاريخ الرد',
  approvals_deadline: 'يُعدّ موافقة إن لم يرد حتى {date}',
  approvals_overridden: 'تجاوز {name} الموافقة: {reason}',
  approvals_overriddenNoName: 'تم تجاوز الموافقة: {reason}',
  approvals_override: 'تجاوز الموافقة',
  approvals_override_title: 'تجاوز موافقة الملاك',
  approvals_override_desc:
    'يُسمح ببدء العمل أو ترحيل المصروف رغم عدم موافقة كل الملاك. يبقى رد كل مالك كما هو، ويُحفظ السبب في سجل التدقيق.',
  approvals_override_reason: 'السبب',
  approvals_override_hint: '3 أحرف على الأقل؛ يُحفظ في سجل التدقيق.',
  approvals_override_done: 'تم تجاوز الموافقة.',
  approvals_required:
    'لم يوافق الملاك على هذا العمل بعد. انتظر ردودهم أو اطلب من المدير تجاوز الموافقة مع ذكر السبب.',
  approvals_estimate: 'التكلفة التقديرية (درهم)',
  approvals_estimate_hint: 'عند {amount} أو أكثر يُطلب من الملاك الموافقة قبل بدء العمل.',
  approvals_filter: 'بانتظار موافقة الملاك',
  approvals_cancel: 'إلغاء',
  settings_threshold: 'حد موافقة الملاك على الإصلاحات (درهم)',
  settings_threshold_hint:
    'أمر صيانة بتكلفة تقديرية أو مصروف متغير بهذه القيمة أو أكثر يحتاج موافقة الملاك قبل التنفيذ.',
  settings_silence: 'الموافقة عند عدم الرد بعد (أيام)',
  settings_silence_hint: 'من لا يرد خلال هذه المدة يُعدّ موافقاً. 0 يوقف ذلك.',
  today_approvals: 'بانتظار موافقة الملاك',
  today_approvals_expenses: 'منها {n} مصروف',
  today_approvals_rejected: '{n} مرفوض',
  today_approvals_silent: '{n} موافقة بعدم الرد خلال 7 أيام',
};

type Key = keyof typeof ar;

const en: Record<Key, string> = {
  approvals_title: 'Owner approval',
  approvals_linkedJob: 'The owners’ answers on the work order this expense pays for.',
  approvals_askedAbout: 'Asked to approve {amount}',
  approvals_owner: 'Owner',
  approvals_share: 'Share',
  approvals_status: 'Status',
  approvals_note: 'Owner’s note',
  approvals_asked: 'Asked on',
  approvals_answered: 'Answered on',
  approvals_deadline: 'Counts as approved if no answer by {date}',
  approvals_overridden: 'Overridden by {name}: {reason}',
  approvals_overriddenNoName: 'Overridden: {reason}',
  approvals_override: 'Override approval',
  approvals_override_title: 'Override owner approval',
  approvals_override_desc:
    'Lets the work start or the expense be posted without every owner’s approval. Each owner’s answer stays as it is; the reason is kept in the audit log.',
  approvals_override_reason: 'Reason',
  approvals_override_hint: 'At least 3 characters; kept in the audit log.',
  approvals_override_done: 'Approval overridden.',
  approvals_required:
    'The owners have not approved this job yet. Wait for their answers, or ask an admin to override with a reason.',
  approvals_estimate: 'Estimate (AED)',
  approvals_estimate_hint:
    'At {amount} or more the owners are asked to approve before work starts.',
  approvals_filter: 'Awaiting owner approval',
  approvals_cancel: 'Cancel',
  settings_threshold: 'Owner approval threshold for repairs (AED)',
  settings_threshold_hint:
    'A work order estimate or variable expense at or above this needs the owners’ approval first.',
  settings_silence: 'Silent approval after (days)',
  settings_silence_hint:
    'Owners who do not answer within this many days count as approved. 0 turns this off.',
  today_approvals: 'Awaiting owner approval',
  today_approvals_expenses: '{n} of them expenses',
  today_approvals_rejected: '{n} rejected',
  today_approvals_silent: '{n} approved by silence in 7 days',
};

export const approvalMessages = { ar, en };
export type ApprovalMessageKey = Key;

/** The lib i18n helpers plus `t` over the approval dictionary and the shared status labels. */
export function useApprovalText() {
  const i18n = useI18n();
  const dict = approvalMessages[i18n.lang];
  const t = useCallback(
    (key: Key, vars?: Record<string, string | number>) => {
      let s: string = dict[key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [dict],
  );
  const statusLabel = useCallback(
    (s: RepairApprovalStatus) => REPAIR_APPROVAL_STATUS_LABEL[s][i18n.lang],
    [i18n.lang],
  );
  const stateLabel = useCallback(
    (s: ApprovalState) => APPROVAL_STATE_LABEL[s][i18n.lang],
    [i18n.lang],
  );
  return { ...i18n, t, lib: i18n.t, statusLabel, stateLabel };
}
