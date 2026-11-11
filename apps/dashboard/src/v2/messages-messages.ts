/* UI copy for owner messages (the inbox, a thread, the header link, Today). Arabic first. */
import { useCallback } from 'react';
import {
  MESSAGE_LINK_LABEL,
  MESSAGE_THREAD_STATUS_LABEL,
  type MessageLinkType,
  type MessageThreadStatus,
} from '@vamar/shared';
import { useI18n } from '@/lib/i18n';

const ar = {
  messages_title: 'رسائل الملاك',
  messages_subtitle: 'أسئلة الملاك من التطبيق. يصل المالكَ إشعار عند كل رد.',
  messages_status: 'الحالة',
  messages_status_all: 'الكل',
  messages_waiting: 'بانتظار الرد فقط',
  messages_mine: 'المسندة إليّ فقط',
  messages_building: 'المبنى',
  messages_building_all: 'كل المباني',
  messages_empty: 'لا توجد رسائل بهذه الشروط.',
  messages_more: 'عرض المزيد',
  messages_unread: '{n} غير مقروءة',
  messages_waitingBadge: 'بانتظار الرد',
  messages_assignedTo: 'مسندة إلى {name}',
  messages_vamarPrefix: 'فامار: ',
  messages_fileOnly: 'ملف مرفق',
  messages_back: 'كل الرسائل',
  messages_owner: 'المالك',
  messages_about: 'بخصوص',
  messages_vamar: 'فامار',
  messages_reply: 'الرد',
  messages_replyLabel: 'ردك على المالك',
  messages_count: '{n} / {max}',
  messages_send: 'إرسال',
  messages_attach: 'إرفاق صورة أو ملف PDF',
  messages_removeFile: 'إزالة {name}',
  messages_needText: 'اكتب رداً أو أرفق ملفاً.',
  messages_tooLong: 'الرد أطول من {max} حرف.',
  messages_sendError: 'تعذّر الإرسال. حاول مرة أخرى.',
  messages_sent: 'تم إرسال الرد.',
  messages_close: 'إغلاق المحادثة',
  messages_reopen: 'إعادة فتح المحادثة',
  messages_closedNote: 'أُغلقت في {date}. تُفتح من جديد إذا كتب المالك.',
  messages_assign: 'مسندة إلى',
  messages_assignNone: 'لا أحد',
  messages_actionError: 'تعذّر الحفظ. حاول مرة أخرى.',
  messages_readOnly: 'يمكنك قراءة الرسائل فقط؛ الرد لفريق الإدخال والمدير.',
  messages_files: 'المرفقات',
  messages_header: 'رسائل الملاك',
  messages_headerUnread: 'رسائل الملاك، {n} غير مقروءة',
  messages_notFound: 'لم يتم العثور على هذه المحادثة.',
  today_messages: 'رسائل ملاك بلا رد',
  today_messages_oldest: 'أقدمها ينتظر منذ {date}',
};

const en: Record<keyof typeof ar, string> = {
  messages_title: 'Owner messages',
  messages_subtitle: 'Questions owners send from the app. The owner gets a push with every answer.',
  messages_status: 'Status',
  messages_status_all: 'All',
  messages_waiting: 'Waiting for an answer only',
  messages_mine: 'Assigned to me only',
  messages_building: 'Building',
  messages_building_all: 'All buildings',
  messages_empty: 'No messages match these filters.',
  messages_more: 'Show more',
  messages_unread: '{n} unread',
  messages_waitingBadge: 'Waiting for an answer',
  messages_assignedTo: 'Assigned to {name}',
  messages_vamarPrefix: 'Vamar: ',
  messages_fileOnly: 'File attached',
  messages_back: 'All messages',
  messages_owner: 'Owner',
  messages_about: 'About',
  messages_vamar: 'Vamar',
  messages_reply: 'Reply',
  messages_replyLabel: 'Your answer to the owner',
  messages_count: '{n} / {max}',
  messages_send: 'Send',
  messages_attach: 'Attach a photo or PDF',
  messages_removeFile: 'Remove {name}',
  messages_needText: 'Write an answer or attach a file.',
  messages_tooLong: 'The answer is longer than {max} characters.',
  messages_sendError: 'Could not send. Please try again.',
  messages_sent: 'Answer sent.',
  messages_close: 'Close thread',
  messages_reopen: 'Reopen thread',
  messages_closedNote: 'Closed on {date}. It opens again if the owner writes.',
  messages_assign: 'Assigned to',
  messages_assignNone: 'Nobody',
  messages_actionError: 'Could not save. Please try again.',
  messages_readOnly: 'You can read messages; data entry and admins answer them.',
  messages_files: 'Files',
  messages_header: 'Owner messages',
  messages_headerUnread: 'Owner messages, {n} unread',
  messages_notFound: 'This thread was not found.',
  today_messages: 'Unanswered owner messages',
  today_messages_oldest: 'Oldest waiting since {date}',
};

type Key = keyof typeof ar;
export const messageMessages = { ar, en };
export type MessageTextKey = Key;

/** The lib i18n helpers plus `t` over the messages dictionary and the shared labels. */
export function useMessageText() {
  const i18n = useI18n();
  const dict = messageMessages[i18n.lang];
  const t = useCallback(
    (key: Key, vars?: Record<string, string | number>) => {
      let s: string = dict[key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [dict],
  );
  const statusLabel = useCallback(
    (s: MessageThreadStatus) => MESSAGE_THREAD_STATUS_LABEL[s][i18n.lang],
    [i18n.lang],
  );
  const linkLabel = useCallback(
    (type: MessageLinkType) => MESSAGE_LINK_LABEL[type][i18n.lang],
    [i18n.lang],
  );
  return { ...i18n, t, statusLabel, linkLabel };
}
