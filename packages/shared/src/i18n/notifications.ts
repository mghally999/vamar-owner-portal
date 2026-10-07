/**
 * Push notification copy in Arabic and English. Western digits in both. The owner's
 * preferred language picks the variant. Kept here so the API and the tests share one source.
 */
import { formatDate, type Lang, type PlainDate } from '../dates.js';
import { formatAmount } from '../money.js';
import type { NotificationType } from '../alerts.js';

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

export type NotificationParams =
  ChequeDueSoonParams | ChequeBouncedParams | ContractEndingParams | NewDeviceLoginParams;

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
  }
}

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, Record<Lang, string>> = {
  cheque_due_soon: { ar: 'تذكير بشيك', en: 'Cheque reminder' },
  cheque_bounced: { ar: 'شيك مرتجع', en: 'Bounced cheque' },
  contract_ending_60: { ar: 'عقد ينتهي بعد 60 يوماً', en: 'Contract ending in 60 days' },
  contract_ending_30: { ar: 'عقد ينتهي بعد 30 يوماً', en: 'Contract ending in 30 days' },
  new_device_login: { ar: 'جهاز جديد', en: 'New device' },
};
