/**
 * Pieces of the message screens: a message bubble (the owner's on one side, Vamar's on the
 * other), the writing box with its counter and send button, and where a thread's linked item
 * opens. Message text is always rendered as plain text.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import {
  MAX_MESSAGE_LENGTH,
  MESSAGE_LINK_LABEL,
  normalizeMessageText,
  textLength,
  type MessageLinkType,
} from '@vamar/shared';
import { API_BASE, authHeaders } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  MAX_MESSAGE_FILE_BYTES,
  sendErrorKey,
  type MessageLink,
  type PickedFile,
  type ThreadMessage,
} from '@/lib/message-queries';
import { messageTime, useMessageText, type MessageTextKey } from '@/lib/message-text';
import { fonts, useTheme } from '@/lib/theme';
import { FilePickButton } from './file-pick';
import { Button, Row, Text } from './index';

const LINK_PATH: Record<MessageLinkType, string> = {
  unit: '/unit/[id]',
  cheque: '/cheque/[id]',
  expense: '/expense/[id]',
  work_order: '/work-order/[id]',
  dispute: '/dispute/[id]',
};

/** Where tapping a thread's linked item goes. */
export function linkHref(link: MessageLink) {
  return { pathname: LINK_PATH[link.type], params: { id: link.id } };
}

/** "Cheque 849342 · Al Noor Tower 801" in the owner's language. */
export function useLinkLabel() {
  const { lang, pick } = useI18n();
  return (link: MessageLink) =>
    `${MESSAGE_LINK_LABEL[link.type][lang]} ${pick(link.labelAr, link.labelEn)}`.trim();
}

export function MessageBubble({ message }: { message: ThreadMessage }) {
  const t = useTheme();
  const tm = useMessageText();
  const { lang } = useI18n();
  const mine = message.senderType === 'owner';
  const fileUrl = (id: string) => `${API_BASE}/api/owner/attachments/${id}`;
  return (
    <View
      testID={`message-${message.id}`}
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '88%',
        gap: 4,
        padding: 12,
        borderRadius: t.radius.lg,
        backgroundColor: mine ? t.colors.primary : t.colors.bgElevated,
        borderWidth: 1,
        borderColor: mine ? t.colors.primary : t.colors.border,
      }}
    >
      <Text variant="caption" weight="medium" color={mine ? 'onPrimary' : 'soft'}>
        {tm(mine ? 'message_you' : 'message_vamar')}
      </Text>
      {message.body ? (
        <Text color={mine ? 'onPrimary' : 'ink'} selectable style={{ writingDirection: 'auto' }}>
          {message.body}
        </Text>
      ) : null}
      {message.files.map((f) =>
        // Photos show in the bubble with the session's token (expo-image sends the headers);
        // a PDF opens outside the app, as an expense invoice does.
        f.mime.startsWith('image/') ? (
          <Image
            key={f.id}
            source={{ uri: fileUrl(f.id), headers: authHeaders() }}
            cachePolicy="memory-disk"
            accessibilityLabel={f.fileName}
            style={{ width: 220, maxWidth: '100%', aspectRatio: 4 / 3, borderRadius: t.radius.md }}
            contentFit="cover"
            placeholder={null}
            transition={150}
          />
        ) : (
          <Button
            key={f.id}
            title={`${tm('message_open_file')} · ${f.fileName || 'PDF'}`}
            variant="secondary"
            onPress={() => void Linking.openURL(fileUrl(f.id))}
          />
        ),
      )}
      <Text variant="caption" color={mine ? 'onPrimary' : 'faint'} tnum>
        {messageTime(message.createdAt, lang)}
      </Text>
    </View>
  );
}

/**
 * The writing box. Checks what the API would refuse (nothing to send, over 4,000 characters, a
 * file of the wrong type or size) before sending, and keeps the text when sending fails.
 */
export function MessageComposer({
  label,
  sending,
  onSend,
  beforeSend,
}: {
  label: string;
  sending: boolean;
  onSend: (text: string, file: PickedFile | null) => Promise<unknown>;
  /** Another check of the screen's own (the new thread's subject). */
  beforeSend?: () => MessageTextKey | null;
}) {
  const t = useTheme();
  const tm = useMessageText();
  const [text, setText] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const length = textLength(text);
  const over = length > MAX_MESSAGE_LENGTH;

  async function send() {
    const clean = normalizeMessageText(text);
    const problem =
      beforeSend?.() ??
      (over ? 'message_too_long' : clean === '' && !file ? 'message_need_text' : null);
    if (problem) {
      setError(tm(problem, { max: MAX_MESSAGE_LENGTH }));
      return;
    }
    setError(null);
    try {
      await onSend(clean, file);
      setText('');
      setFile(null);
    } catch (e) {
      setError(tm(sendErrorKey(e)));
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        accessibilityLabel={label}
        value={text}
        onChangeText={setText}
        multiline
        placeholder={tm('message_placeholder')}
        placeholderTextColor={t.colors.inkFaint}
        style={{
          minHeight: 96,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: over ? t.colors.danger : t.colors.borderStrong,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.bgElevated,
          color: t.colors.ink,
          fontFamily: fonts.regular,
          fontSize: 15,
          textAlignVertical: 'top',
          writingDirection: 'auto',
        }}
      />
      <Row style={{ justifyContent: 'space-between', gap: 8 }}>
        <Text variant="caption" color={over ? 'danger' : 'faint'} tnum>
          {tm('message_count', { n: length, max: MAX_MESSAGE_LENGTH })}
        </Text>
        {file ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tm('message_remove_file', { name: file.name })}
            onPress={() => {
              setFile(null);
            }}
            style={{ flexShrink: 1, minHeight: 44, justifyContent: 'center' }}
          >
            <Text variant="caption" color="primary" numberOfLines={1}>
              {file.name} ✕
            </Text>
          </Pressable>
        ) : null}
      </Row>
      {error ? (
        <Text variant="secondary" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {/* Nothing on the phone build (see file-pick.tsx); the web app offers a file. */}
      {!file ? (
        <FilePickButton
          label={tm('message_attach')}
          disabled={sending}
          onPick={(f) => {
            const ok = f.mime.startsWith('image/') || f.mime === 'application/pdf';
            const problem =
              f.size > MAX_MESSAGE_FILE_BYTES
                ? 'message_file_too_big'
                : ok
                  ? null
                  : 'message_file_type';
            setError(problem ? tm(problem) : null);
            if (!problem) setFile(f);
          }}
        />
      ) : null}
      <Button title={tm('message_send')} loading={sending} onPress={() => void send()} />
    </View>
  );
}
