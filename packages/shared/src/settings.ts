/**
 * Application settings (v2) the admin can change from the dashboard. Stored as one row per key
 * in `app_settings`; these are the defaults and the parser both apps use.
 */
import { DEFAULT_LARGE_EXPENSE_ALERT_FILS } from './expenses.js';
import { DEFAULT_WEEK_START, isWeekStart, type WeekStart } from './periods.js';

export interface AppSettings {
  /** First day of the week on every calendar and "this week" preset. */
  weekStart: WeekStart;
  /** Show the Hijri date next to the Gregorian one. */
  hijriDisplay: boolean;
  /** Label net amounts "before Vamar's management fee" (commission itself is never shown). */
  showBeforeFeeLabel: boolean;
  /** A posted expense at or above this sends the owners a push notification. */
  largeExpenseAlertFils: number;
  /** Owners may open the invoice image or PDF of an expense they can see. */
  ownersSeeInvoiceFiles: boolean;
}

export const APP_SETTING_DEFAULTS: AppSettings = {
  weekStart: DEFAULT_WEEK_START,
  hijriDisplay: false,
  showBeforeFeeLabel: true,
  largeExpenseAlertFils: DEFAULT_LARGE_EXPENSE_ALERT_FILS,
  ownersSeeInvoiceFiles: true,
};

/** Database keys (snake_case) for each setting. */
export const APP_SETTING_KEYS: Record<keyof AppSettings, string> = {
  weekStart: 'week_start',
  hijriDisplay: 'hijri_display',
  showBeforeFeeLabel: 'show_before_fee_label',
  largeExpenseAlertFils: 'large_expense_alert_fils',
  ownersSeeInvoiceFiles: 'owners_see_invoice_files',
};

/** The subset owners receive with their profile. */
export const OWNER_VISIBLE_SETTINGS = [
  'weekStart',
  'hijriDisplay',
  'showBeforeFeeLabel',
  'ownersSeeInvoiceFiles',
] as const satisfies readonly (keyof AppSettings)[];
export type OwnerVisibleSettings = Pick<AppSettings, (typeof OWNER_VISIBLE_SETTINGS)[number]>;

/** Rows from the table (unknown values are ignored; missing keys take the default). */
export function parseAppSettings(rows: readonly { key: string; value: unknown }[]): AppSettings {
  const out: AppSettings = { ...APP_SETTING_DEFAULTS };
  for (const row of rows) {
    const v = row.value;
    switch (row.key) {
      case 'week_start':
        if (isWeekStart(v)) out.weekStart = v;
        break;
      case 'hijri_display':
        if (typeof v === 'boolean') out.hijriDisplay = v;
        break;
      case 'show_before_fee_label':
        if (typeof v === 'boolean') out.showBeforeFeeLabel = v;
        break;
      case 'large_expense_alert_fils':
        if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)
          out.largeExpenseAlertFils = v;
        break;
      case 'owners_see_invoice_files':
        if (typeof v === 'boolean') out.ownersSeeInvoiceFiles = v;
        break;
      default:
        break;
    }
  }
  return out;
}

export function ownerVisibleSettings(s: AppSettings): OwnerVisibleSettings {
  return {
    weekStart: s.weekStart,
    hijriDisplay: s.hijriDisplay,
    showBeforeFeeLabel: s.showBeforeFeeLabel,
    ownersSeeInvoiceFiles: s.ownersSeeInvoiceFiles,
  };
}
