/**
 * Labels for enum values shown in both apps. UI screen strings live in each app's own
 * message files; only labels for shared domain enums live here so they never drift.
 */
import type { Lang } from '../dates.js';
import type { ChequeStatus } from '../cheques.js';
import type { ContractStatus } from '../occupancy.js';
import type { DisputeStatus, DisputeType, UnitType } from '../schemas/enums.js';
import type {
  AllocationMethod,
  ExpenseKind,
  ExpenseStatus,
  PaymentMethod,
  RecurringFrequency,
  UnitStatus,
  WorkOrderPriority,
  WorkOrderStatus,
} from '../expenses.js';
import type { CalendarEventType, CalendarItemKind } from '../calendar.js';

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

// v2: expenses, work orders, property status and the calendar -----------------------------------

export const EXPENSE_KIND_LABEL: Labels<ExpenseKind> = {
  fixed: { ar: 'ثابتة', en: 'Fixed' },
  variable: { ar: 'متغيرة', en: 'Variable' },
};

export const EXPENSE_STATUS_LABEL: Labels<ExpenseStatus> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  posted: { ar: 'مرحَّل', en: 'Posted' },
  void: { ar: 'ملغى', en: 'Void' },
};

export const PAYMENT_METHOD_LABEL: Labels<PaymentMethod> = {
  cash: { ar: 'نقداً', en: 'Cash' },
  cheque: { ar: 'شيك', en: 'Cheque' },
  transfer: { ar: 'تحويل', en: 'Transfer' },
  card: { ar: 'بطاقة', en: 'Card' },
};

export const ALLOCATION_METHOD_LABEL: Labels<AllocationMethod> = {
  by_area: { ar: 'حسب المساحة', en: 'By area' },
  equal_units: { ar: 'بالتساوي بين الوحدات', en: 'Equal per unit' },
  by_ownership: { ar: 'بالتساوي بين الملاك', en: 'Equal per owner' },
  single_unit: { ar: 'وحدة واحدة', en: 'Single unit' },
};

export const RECURRING_FREQUENCY_LABEL: Labels<RecurringFrequency> = {
  monthly: { ar: 'شهرياً', en: 'Monthly' },
  quarterly: { ar: 'كل 3 أشهر', en: 'Quarterly' },
  yearly: { ar: 'سنوياً', en: 'Yearly' },
};

export const WORK_ORDER_STATUS_LABEL: Labels<WorkOrderStatus> = {
  open: { ar: 'مفتوح', en: 'Open' },
  scheduled: { ar: 'مجدول', en: 'Scheduled' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In progress' },
  done: { ar: 'منجز', en: 'Done' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
};

export const WORK_ORDER_PRIORITY_LABEL: Labels<WorkOrderPriority> = {
  low: { ar: 'منخفضة', en: 'Low' },
  normal: { ar: 'عادية', en: 'Normal' },
  urgent: { ar: 'عاجلة', en: 'Urgent' },
};

export const UNIT_STATUS_LABEL: Labels<UnitStatus> = {
  occupied: { ar: 'مؤجَّرة', en: 'Occupied' },
  vacant_ready: { ar: 'شاغرة وجاهزة', en: 'Vacant, ready' },
  under_maintenance: { ar: 'تحت الصيانة', en: 'Under maintenance' },
  reserved: { ar: 'محجوزة', en: 'Reserved' },
  not_available: { ar: 'غير متاحة', en: 'Not available' },
};

export const CALENDAR_EVENT_TYPE_LABEL: Labels<CalendarEventType> = {
  inspection: { ar: 'معاينة', en: 'Inspection' },
  meeting: { ar: 'اجتماع', en: 'Meeting' },
  handover: { ar: 'تسليم', en: 'Handover' },
  reminder: { ar: 'تذكير', en: 'Reminder' },
  other: { ar: 'أخرى', en: 'Other' },
};

export const CALENDAR_ITEM_KIND_LABEL: Labels<CalendarItemKind> = {
  cheque_due: { ar: 'شيك مستحق', en: 'Cheque due' },
  contract_end: { ar: 'نهاية عقد', en: 'Contract end' },
  contract_renewal: { ar: 'تجديد عقد', en: 'Contract renewal' },
  hearing: { ar: 'جلسة', en: 'Hearing' },
  work_order: { ar: 'صيانة', en: 'Maintenance' },
  holiday: { ar: 'عطلة', en: 'Holiday' },
  event: { ar: 'موعد', en: 'Event' },
};

/** Net amounts carry this when the setting is on; Vamar's commission itself is never shown. */
export const NET_BEFORE_FEE_LABEL: Record<Lang, string> = {
  ar: 'قبل رسوم إدارة فامار',
  en: "Before Vamar's management fee",
};
