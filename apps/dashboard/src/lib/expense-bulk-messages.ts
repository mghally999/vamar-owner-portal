/* UI copy for bulk actions on expenses (the list and the drafts queue). Same keys in both. */
import { useCallback } from 'react';
import { useI18n } from './i18n';

const en = {
  expbulk_bar: 'Selected expenses',
  expbulk_selected: '{n} selected',
  expbulk_selectAll: 'Select all on this page',
  expbulk_selectRow: 'Select {label}',
  expbulk_clear: 'Clear selection',
  expbulk_tooMany: 'Select at most {max} expenses at a time.',

  expbulk_action_post: 'Post',
  expbulk_action_discard: 'Delete drafts',
  expbulk_action_show: 'Show to owners',
  expbulk_action_hide: 'Hide from owners',

  expbulk_title_post: 'Post selected drafts ({n})',
  expbulk_title_discard: 'Delete selected drafts ({n})',
  expbulk_title_show: 'Show selected expenses to owners ({n})',
  expbulk_title_hide: 'Hide selected expenses from owners ({n})',

  expbulk_rules_post:
    'Each draft is posted exactly as if posted on its own: split between the owners on its invoice date, and the owners get the usual alert for a large expense. If any draft cannot be posted, nothing is posted.',
  expbulk_rules_discard:
    'Drafts made from a recurring rule are kept as discarded, so the rule does not make them again; other drafts are deleted. If any cannot be deleted, nothing is deleted.',
  expbulk_rules_show:
    'Owners will see these posted expenses in the app, and they count in the owners’ totals. Amounts and shares do not change. If any cannot be changed, nothing is changed.',
  expbulk_rules_hide:
    'Owners will no longer see these posted expenses, and they no longer count in the owners’ totals. Amounts and shares do not change. If any cannot be changed, nothing is changed.',

  expbulk_note: 'Note',
  expbulk_note_hint: 'Optional. Kept in the audit log.',

  expbulk_done_post: 'Expenses posted: {n}.',
  expbulk_done_discard: 'Drafts deleted: {n}.',
  expbulk_done_show: 'Expenses shown to owners: {n}.',
  expbulk_done_hide: 'Expenses hidden from owners: {n}.',

  expbulk_rejected_title: 'Nothing was changed. These expenses cannot take this action:',
  expbulk_reject_not_found: 'No longer exists',
  expbulk_reject_not_draft: 'Is {status}; only drafts can be posted or deleted',
  expbulk_reject_not_posted: 'Is {status}; only posted expenses can be shown or hidden',
  expbulk_reject_approval_required:
    'Waiting for the owners’ approval, or an owner rejected it. An admin can override it on the expense page.',
  expbulk_reject_cannot_allocate: 'Cannot be split between the owners on its invoice date',
  expbulk_reject_refused: 'Cannot take this action',
  expbulk_deselect: 'Deselect these and go back',
};

export type ExpenseBulkMessageKey = keyof typeof en;

const ar: Record<ExpenseBulkMessageKey, string> = {
  expbulk_bar: 'المصروفات المختارة',
  expbulk_selected: 'تم اختيار {n}',
  expbulk_selectAll: 'اختيار الكل في هذه الصفحة',
  expbulk_selectRow: 'اختيار {label}',
  expbulk_clear: 'إلغاء الاختيار',
  expbulk_tooMany: 'اختر {max} مصروفاً كحد أقصى في المرة الواحدة.',

  expbulk_action_post: 'ترحيل',
  expbulk_action_discard: 'حذف المسودات',
  expbulk_action_show: 'إظهار للملاك',
  expbulk_action_hide: 'إخفاء عن الملاك',

  expbulk_title_post: 'ترحيل المسودات المختارة ({n})',
  expbulk_title_discard: 'حذف المسودات المختارة ({n})',
  expbulk_title_show: 'إظهار المصروفات المختارة للملاك ({n})',
  expbulk_title_hide: 'إخفاء المصروفات المختارة عن الملاك ({n})',

  expbulk_rules_post:
    'تُرحَّل كل مسودة كما لو رُحّلت وحدها: تُوزَّع على الملاك حسب الملكية في تاريخ الفاتورة، ويصل الملاك التنبيه المعتاد للمصروف الكبير. إذا تعذّر ترحيل أي مسودة فلن يُرحَّل شيء.',
  expbulk_rules_discard:
    'المسودات الناتجة عن قاعدة متكررة تُحفظ كمسودات مستبعدة حتى لا تُنشئها القاعدة مرة أخرى، وتُحذف بقية المسودات. إذا تعذّر حذف أي منها فلن يُحذف شيء.',
  expbulk_rules_show:
    'سيرى الملاك هذه المصروفات المرحَّلة في التطبيق، وتُحسب في مجاميعهم. لا تتغيّر المبالغ ولا الحصص. إذا تعذّر تغيير أي منها فلن يتغيّر شيء.',
  expbulk_rules_hide:
    'لن يرى الملاك هذه المصروفات المرحَّلة، ولن تُحسب في مجاميعهم. لا تتغيّر المبالغ ولا الحصص. إذا تعذّر تغيير أي منها فلن يتغيّر شيء.',

  expbulk_note: 'ملاحظة',
  expbulk_note_hint: 'اختيارية. تُحفظ في سجل التدقيق.',

  expbulk_done_post: 'المصروفات المرحَّلة: {n}.',
  expbulk_done_discard: 'المسودات المحذوفة: {n}.',
  expbulk_done_show: 'المصروفات الظاهرة للملاك: {n}.',
  expbulk_done_hide: 'المصروفات المخفية عن الملاك: {n}.',

  expbulk_rejected_title: 'لم يتغيّر شيء. لا يمكن تطبيق هذا الإجراء على هذه المصروفات:',
  expbulk_reject_not_found: 'لم يعد موجوداً',
  expbulk_reject_not_draft: 'حالته {status}، والترحيل والحذف للمسودات فقط',
  expbulk_reject_not_posted: 'حالته {status}، والإظهار والإخفاء للمصروفات المرحَّلة فقط',
  expbulk_reject_approval_required:
    'بانتظار موافقة الملاك، أو رفضه أحدهم. يمكن للمدير تجاوز الموافقة من صفحة المصروف.',
  expbulk_reject_cannot_allocate: 'لا يمكن توزيعه على الملاك في تاريخ الفاتورة',
  expbulk_reject_refused: 'لا يمكن تطبيق هذا الإجراء عليه',
  expbulk_deselect: 'إلغاء اختيار هذه المصروفات والعودة',
};

export const expenseBulkMessages = { ar, en };

/** The lib i18n helpers plus `tb` over the bulk dictionary (lib keys stay on `t`). */
export function useExpenseBulkI18n() {
  const i18n = useI18n();
  const dict = expenseBulkMessages[i18n.lang];
  const tb = useCallback(
    (key: ExpenseBulkMessageKey, vars?: Record<string, string | number>) => {
      let s: string = dict[key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [dict],
  );
  return { ...i18n, tb };
}
