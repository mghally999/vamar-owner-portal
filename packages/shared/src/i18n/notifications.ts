/**
 * Push notification copy in Arabic and English. Western digits in both. The owner's
 * preferred language picks the variant. Kept here so the API and the tests share one source.
 */
import { formatDate, formatMonth, type Lang, type PlainDate } from '../dates.js';
import { formatAmount } from '../money.js';
import type { NotificationType } from '../alerts.js';
import { budgetPercent, type BudgetThreshold } from '../budgets.js';
import { BUDGET_TOTAL_LABEL } from './labels.js';

export interface NotificationCopy {
  title: string;
  body: string;
}

export interface ChequeDueSoonParams {
  type: 'cheque_due_soon';
  amountFils: number;
  dueDate: PlainDate;
  unitLabel: string;
}

export interface ChequeBouncedParams {
  type: 'cheque_bounced';
  amountFils: number;
  unitLabel: string;
}

export interface ContractEndingParams {
  type: 'contract_ending_60' | 'contract_ending_30';
  unitLabel: string;
  endDate: PlainDate;
}

export interface NewDeviceLoginParams {
  type: 'new_device_login';
  deviceLabel: string;
}

/** Sent on the 1st for the month that just ended. */
export interface MonthlySummaryParams {
  type: 'monthly_summary';
  /** First day of the month summarised. */
  month: PlainDate;
  collectedFils: number;
  expensesFils: number;
  netFils: number;
}

export interface HearingSoonParams {
  type: 'hearing_soon';
  caseNo: string;
  chequeNos: string[];
  hearingDate: PlainDate;
  unitLabel: string;
}

export interface WorkOrderDoneParams {
  type: 'work_order_done';
  title: string;
  unitLabel: string;
  costFils: number | null;
}

export interface LargeExpenseParams {
  type: 'large_expense';
  reason: string;
  totalFils: number;
  placeLabel: string;
}

/** A large repair waits for this owner's yes or no. */
export interface RepairApprovalNeededParams {
  type: 'repair_approval_needed';
  /** The job title, or the expense's reason. */
  title: string;
  placeLabel: string;
  totalFils: number;
  /** This owner's part of the total. */
  shareFils: number;
}

/** A building budget line reached 80 % or 100 % of the year's amount. */
export interface BudgetThresholdParams {
  type: 'budget_threshold';
  threshold: BudgetThreshold;
  year: number;
  buildingName: string;
  /** The category's name, or null for the building's total. */
  categoryName: string | null;
  actualFils: number;
  budgetFils: number;
}

/** Staff answered one of the owner's message threads. */
export interface MessageReplyParams {
  type: 'message_reply';
  /** The thread's subject, as the owner sees it in the app. */
  subject: string;
}

export type NotificationParams =
  | ChequeDueSoonParams
  | ChequeBouncedParams
  | ContractEndingParams
  | NewDeviceLoginParams
  | MonthlySummaryParams
  | HearingSoonParams
  | WorkOrderDoneParams
  | LargeExpenseParams
  | RepairApprovalNeededParams
  | BudgetThresholdParams
  | MessageReplyParams;

export function notificationCopy(params: NotificationParams, lang: Lang): NotificationCopy {
  switch (params.type) {
    case 'cheque_due_soon': {
      const amount = formatAmount(params.amountFils, lang);
      const date = formatDate(params.dueDate, lang);
      return lang === 'ar'
        ? {
            title: 'شيك مستحق بعد 3 أيام',
            body: `شيك بقيمة ${amount} للوحدة ${params.unitLabel} مستحق بتاريخ ${date}.`,
          }
        : {
            title: 'Cheque due in 3 days',
            body: `A cheque of ${amount} for ${params.unitLabel} is due on ${date}.`,
          };
    }
    case 'cheque_bounced': {
      const amount = formatAmount(params.amountFils, lang);
      return lang === 'ar'
        ? {
            title: 'شيك مرتجع',
            body: `ارتجع شيك بقيمة ${amount} للوحدة ${params.unitLabel}. سيتواصل معك فريق فامار.`,
          }
        : {
            title: 'Cheque bounced',
            body: `A cheque of ${amount} for ${params.unitLabel} has bounced. The Vamar team will contact you.`,
          };
    }
    case 'contract_ending_60':
    case 'contract_ending_30': {
      const days = params.type === 'contract_ending_60' ? 60 : 30;
      const date = formatDate(params.endDate, lang);
      return lang === 'ar'
        ? {
            title: `عقد ينتهي بعد ${days} يوماً`,
            body: `عقد الوحدة ${params.unitLabel} ينتهي بتاريخ ${date}.`,
          }
        : {
            title: `Contract ends in ${days} days`,
            body: `The contract for ${params.unitLabel} ends on ${date}.`,
          };
    }
    case 'new_device_login':
      return lang === 'ar'
        ? {
            title: 'تسجيل دخول من جهاز جديد',
            body: `تم تسجيل الدخول إلى حسابك من ${params.deviceLabel}. إن لم يكن هذا أنت، راجع الأجهزة في الإعدادات.`,
          }
        : {
            title: 'New device sign-in',
            body: `Your account was signed in from ${params.deviceLabel}. If this was not you, review devices in Settings.`,
          };
    case 'monthly_summary': {
      const month = formatMonth(params.month, lang);
      const collected = formatAmount(params.collectedFils, lang);
      const expenses = formatAmount(params.expensesFils, lang);
      const net = formatAmount(params.netFils, lang);
      return lang === 'ar'
        ? {
            title: `ملخص ${month}`,
            body: `المحصّل ${collected}، المصروفات ${expenses}، الصافي ${net}. التفاصيل في التطبيق.`,
          }
        : {
            title: `${month} summary`,
            body: `Collected ${collected}, expenses ${expenses}, net ${net}. Details in the app.`,
          };
    }
    case 'hearing_soon': {
      const date = formatDate(params.hearingDate, lang);
      const cheques = params.chequeNos.join(lang === 'ar' ? '، ' : ', ');
      const withCheques = params.chequeNos.length > 0;
      return lang === 'ar'
        ? {
            title: 'جلسة بعد 3 أيام',
            body: `القضية ${params.caseNo}${withCheques ? ` (شيك رقم ${cheques})` : ''} للوحدة ${params.unitLabel}: الجلسة بتاريخ ${date}.`,
          }
        : {
            title: 'Hearing in 3 days',
            body: `Case ${params.caseNo}${withCheques ? ` (cheque ${cheques})` : ''} for ${params.unitLabel}: hearing on ${date}.`,
          };
    }
    case 'work_order_done': {
      const cost = params.costFils === null ? null : formatAmount(params.costFils, lang);
      return lang === 'ar'
        ? {
            title: 'تم إنجاز أعمال الصيانة',
            body: `${params.title} في ${params.unitLabel} تم إنجازها${cost ? ` بتكلفة ${cost}` : ''}.`,
          }
        : {
            title: 'Maintenance completed',
            body: `${params.title} at ${params.unitLabel} is done${cost ? ` at a cost of ${cost}` : ''}.`,
          };
    }
    case 'large_expense': {
      const total = formatAmount(params.totalFils, lang);
      return lang === 'ar'
        ? {
            title: 'مصروف كبير',
            body: `تم تسجيل مصروف بقيمة ${total} على ${params.placeLabel}: ${params.reason}. الفاتورة في التطبيق.`,
          }
        : {
            title: 'Large expense recorded',
            body: `An expense of ${total} was recorded for ${params.placeLabel}: ${params.reason}. The invoice is in the app.`,
          };
    }
    case 'repair_approval_needed': {
      const total = formatAmount(params.totalFils, lang);
      const share = formatAmount(params.shareFils, lang);
      return lang === 'ar'
        ? {
            title: 'مطلوب موافقتك',
            body: `${params.title} في ${params.placeLabel} بتكلفة تقديرية ${total} (حصتك ${share}). افتح التطبيق للموافقة أو الرفض.`,
          }
        : {
            title: 'Approval needed',
            body: `${params.title} at ${params.placeLabel}, estimated at ${total} (your share ${share}). Open the app to approve or reject.`,
          };
    }
    case 'budget_threshold': {
      const actual = formatAmount(params.actualFils, lang);
      const budget = formatAmount(params.budgetFils, lang);
      const pct = budgetPercent(params.actualFils, params.budgetFils);
      const year = String(params.year);
      const line = params.categoryName ?? BUDGET_TOTAL_LABEL[lang];
      if (lang === 'ar') {
        return params.threshold === 100
          ? {
              title: 'نفدت الميزانية',
              body: `${line} في ${params.buildingName}: صُرف ${actual} مقابل ميزانية ${year} البالغة ${budget} (${pct}%).`,
            }
          : {
              title: 'استُخدم 80% من الميزانية',
              body: `${line} في ${params.buildingName}: صُرف ${actual} من ميزانية ${year} البالغة ${budget} (${pct}%).`,
            };
      }
      return params.threshold === 100
        ? {
            title: 'Budget used up',
            body: `${line} at ${params.buildingName}: ${actual} spent against the ${year} budget of ${budget} (${pct}%).`,
          }
        : {
            title: '80% of a budget used',
            body: `${line} at ${params.buildingName}: ${actual} spent of the ${year} budget of ${budget} (${pct}%).`,
          };
    }
    // The answer itself stays in the app: a lock screen is no place for a reply about money.
    case 'message_reply':
      return lang === 'ar'
        ? {
            title: 'رد جديد من فامار',
            body: `بخصوص «${params.subject}». افتح التطبيق لقراءة الرد.`,
          }
        : {
            title: 'New reply from Vamar',
            body: `About "${params.subject}". Open the app to read it.`,
          };
  }
}

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, Record<Lang, string>> = {
  cheque_due_soon: { ar: 'تذكير بشيك', en: 'Cheque reminder' },
  cheque_bounced: { ar: 'شيك مرتجع', en: 'Bounced cheque' },
  contract_ending_60: { ar: 'عقد ينتهي بعد 60 يوماً', en: 'Contract ending in 60 days' },
  contract_ending_30: { ar: 'عقد ينتهي بعد 30 يوماً', en: 'Contract ending in 30 days' },
  new_device_login: { ar: 'جهاز جديد', en: 'New device' },
  monthly_summary: { ar: 'ملخص شهري', en: 'Monthly summary' },
  hearing_soon: { ar: 'تذكير بجلسة', en: 'Hearing reminder' },
  work_order_done: { ar: 'صيانة منجزة', en: 'Maintenance done' },
  large_expense: { ar: 'مصروف كبير', en: 'Large expense' },
  repair_approval_needed: { ar: 'طلب موافقة', en: 'Approval request' },
  budget_threshold: { ar: 'تنبيه الميزانية', en: 'Budget alert' },
  message_reply: { ar: 'رد على رسالة', en: 'Message reply' },
};
