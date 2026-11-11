/**
 * Copy for messages with Vamar, Arabic first, Western digits. Its own dictionary so the feature
 * does not touch the shared messages file; `vars` work as in useI18n().t.
 */
import { useCallback } from 'react';
import { formatDate, todayInDubai, type Lang } from '@vamar/shared';
import { useI18n } from './i18n';

const ar = {
  messages_title: 'الرسائل',
  message_thread: 'المحادثة',
  message_new_title: 'رسالة جديدة',
  messages_new: 'رسالة جديدة',
  messages_empty: 'لا توجد رسائل بعد.',
  messages_empty_body: 'اسأل فريق فامار عن أي شيء يخص عقاراتك، وسيصلك إشعار عند الرد.',
  messages_unread: '{n} جديدة',
  message_you: 'أنت',
  message_vamar: 'فامار',
  message_subject: 'الموضوع',
  message_body: 'رسالتك',
  message_placeholder: 'اكتب رسالتك لفريق فامار',
  message_reply: 'ردك',
  message_send: 'إرسال',
  message_count: '{n}/{max}',
  message_about: 'بخصوص: {label}',
  message_closed: 'أغلق فريق فامار هذه المحادثة. إن أرسلت رسالة جديدة تُفتح مرة أخرى.',
  message_error: 'تعذّر إرسال الرسالة. حاول مرة أخرى.',
  message_rate_limited: 'أرسلت رسائل كثيرة خلال ساعة. حاول مرة أخرى بعد قليل.',
  message_too_long: 'الرسالة أطول من {max} حرف.',
  message_need_text: 'اكتب رسالة أو أرفق ملفاً.',
  message_need_subject: 'الموضوع مطلوب.',
  message_open_file: 'فتح الملف',
  message_file_only: 'ملف مرفق',
  message_attach: 'إرفاق صورة أو ملف PDF',
  message_remove_file: 'إزالة {name}',
  message_file_too_big: 'الملف أكبر من 10 ميغابايت.',
  message_file_type: 'يمكن إرفاق الصور وملفات PDF فقط.',
  ask_vamar: 'اسأل فامار عن هذا',
  settings_messages: 'الرسائل مع فامار',
};

const en: Record<keyof typeof ar, string> = {
  messages_title: 'Messages',
  message_thread: 'Conversation',
  message_new_title: 'New message',
  messages_new: 'New message',
  messages_empty: 'No messages yet.',
  messages_empty_body:
    "Ask the Vamar team anything about your properties; you'll get a notification when they reply.",
  messages_unread: '{n} new',
  message_you: 'You',
  message_vamar: 'Vamar',
  message_subject: 'Subject',
  message_body: 'Your message',
  message_placeholder: 'Write your message to the Vamar team',
  message_reply: 'Your reply',
  message_send: 'Send',
  message_count: '{n}/{max}',
  message_about: 'About: {label}',
  message_closed: 'The Vamar team closed this conversation. Sending a new message opens it again.',
  message_error: 'Your message could not be sent. Please try again.',
  message_rate_limited:
    "You've sent a lot of messages in the last hour. Please try again a little later.",
  message_too_long: 'The message is longer than {max} characters.',
  message_need_text: 'Write a message or attach a file.',
  message_need_subject: 'A subject is required.',
  message_open_file: 'Open file',
  message_file_only: 'Attachment',
  message_attach: 'Attach a photo or PDF',
  message_remove_file: 'Remove {name}',
  message_file_too_big: 'The file is larger than 10 MB.',
  message_file_type: 'Only photos and PDF files can be attached.',
  ask_vamar: 'Ask Vamar about this',
  settings_messages: 'Messages with Vamar',
};

export type MessageTextKey = keyof typeof ar;
export const messageTexts: Record<Lang, Record<MessageTextKey, string>> = { ar, en };

/** Plain lookup for places outside a component tree that already know the language. */
export function messageText(
  lang: Lang,
  key: MessageTextKey,
  vars?: Record<string, string | number>,
): string {
  let s = messageTexts[lang][key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/**
 * When a message was written, in Dubai time with Western digits: "7 Oct 2026 · 14:05". Dubai has
 * no daylight saving, so the clock is UTC plus four hours whatever the phone's own time zone.
 */
export function messageTime(iso: string, lang: Lang): string {
  const at = new Date(iso);
  const dubai = new Date(at.getTime() + 4 * 60 * 60 * 1000);
  const hh = String(dubai.getUTCHours()).padStart(2, '0');
  const mm = String(dubai.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(todayInDubai(at), lang)} · ${hh}:${mm}`;
}

export function useMessageText() {
  const { lang } = useI18n();
  return useCallback(
    (key: MessageTextKey, vars?: Record<string, string | number>) => messageText(lang, key, vars),
    [lang],
  );
}
