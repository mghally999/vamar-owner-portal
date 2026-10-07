/**
 * Labels for enum values shown in both apps. UI screen strings live in each app's own
 * message files; only labels for shared domain enums live here so they never drift.
 */
import type { Lang } from '../dates.js';
import type { ChequeStatus } from '../cheques.js';
import type { ContractStatus } from '../occupancy.js';
import type { DisputeStatus, DisputeType, UnitType } from '../schemas/enums.js';

type Labels<K extends string> = Record<K, Record<Lang, string>>;

export const CHEQUE_STATUS_LABEL: Labels<ChequeStatus> = {
  upcoming: { ar: 'قادم', en: 'Upcoming' },
  deposited: { ar: 'مودَع', en: 'Deposited' },
  cleared: { ar: 'تم الصرف', en: 'Cleared' },
  bounced: { ar: 'مرتجع', en: 'Bounced' },
  replaced: { ar: 'مستبدَل', en: 'Replaced' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
};

export const CONTRACT_STATUS_LABEL: Labels<ContractStatus> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  active: { ar: 'ساري', en: 'Active' },
  expired: { ar: 'منتهي', en: 'Expired' },
  terminated: { ar: 'مُنهى', en: 'Terminated' },
  renewed: { ar: 'مُجدَّد', en: 'Renewed' },
};

export const UNIT_TYPE_LABEL: Labels<UnitType> = {
  apartment: { ar: 'شقة', en: 'Apartment' },
  villa: { ar: 'فيلا', en: 'Villa' },
  shop: { ar: 'محل', en: 'Shop' },
  office: { ar: 'مكتب', en: 'Office' },
  warehouse: { ar: 'مستودع', en: 'Warehouse' },
  other: { ar: 'أخرى', en: 'Other' },
};

export const DISPUTE_TYPE_LABEL: Labels<DisputeType> = {
  rent_arrears: { ar: 'متأخرات إيجار', en: 'Rent arrears' },
  bounced_cheque: { ar: 'شيك مرتجع', en: 'Bounced cheque' },
  eviction: { ar: 'إخلاء', en: 'Eviction' },
  damages: { ar: 'أضرار', en: 'Damages' },
  other: { ar: 'أخرى', en: 'Other' },
};

export const DISPUTE_STATUS_LABEL: Labels<DisputeStatus> = {
  open: { ar: 'مفتوحة', en: 'Open' },
  in_progress: { ar: 'قيد المتابعة', en: 'In progress' },
  hearing_scheduled: { ar: 'جلسة محددة', en: 'Hearing scheduled' },
  judgment_issued: { ar: 'صدر الحكم', en: 'Judgment issued' },
  closed: { ar: 'مغلقة', en: 'Closed' },
};

export const VACANT_LABEL: Record<Lang, { since: (date: string) => string; never: string }> = {
  ar: { since: (date) => `شاغرة منذ ${date}`, never: 'لم تُؤجَّر بعد' },
  en: { since: (date) => `Vacant since ${date}`, never: 'Never rented' },
};

export function label<K extends string>(table: Labels<K>, key: K, lang: Lang): string {
  return table[key][lang];
}
