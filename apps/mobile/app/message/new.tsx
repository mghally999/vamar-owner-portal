import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import {
  defaultThreadSubject,
  MAX_THREAD_SUBJECT_LENGTH,
  MESSAGE_LINK_TYPES,
  normalizeSubject,
  type MessageLinkType,
} from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useCreateThread } from '@/lib/message-queries';
import { useMessageText } from '@/lib/message-text';
import { fonts, useTheme } from '@/lib/theme';
import { Text, layout } from '@/ui';
import { MessageComposer } from '@/ui/message-parts';

function isLinkType(v: string | undefined): v is MessageLinkType {
  return (MESSAGE_LINK_TYPES as readonly string[]).includes(v ?? '');
}

/**
 * A new message to Vamar. Opened from Messages (no link) or from "Ask Vamar about this" on an
 * item, which passes the item and its label so the subject starts filled in; the owner may
 * change it.
 */
export default function NewThreadScreen() {
  const params = useLocalSearchParams<{ linkType?: string; linkId?: string; label?: string }>();
  const router = useRouter();
  const t = useTheme();
  const tm = useMessageText();
  const { lang } = useI18n();
  const linkType = isLinkType(params.linkType) && params.linkId ? params.linkType : undefined;
  // Follows the language until the owner types their own, so it is never left in the other one.
  const [typed, setSubject] = useState<string | null>(null);
  const subject =
    typed ?? (linkType && params.label ? defaultThreadSubject(linkType, params.label, lang) : '');
  const create = useCreateThread();

  return (
    <ScrollView contentContainerStyle={layout.screen} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 8 }}>
        <Text variant="secondary" weight="medium">
          {tm('message_subject')}
        </Text>
        <TextInput
          accessibilityLabel={tm('message_subject')}
          value={subject}
          onChangeText={setSubject}
          maxLength={MAX_THREAD_SUBJECT_LENGTH}
          placeholderTextColor={t.colors.inkFaint}
          style={{
            minHeight: 48,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderColor: t.colors.borderStrong,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.bgElevated,
            color: t.colors.ink,
            fontFamily: fonts.regular,
            fontSize: 15,
            writingDirection: 'auto',
          }}
        />
      </View>
      <MessageComposer
        label={tm('message_body')}
        sending={create.isPending}
        beforeSend={() => (normalizeSubject(subject) === '' ? 'message_need_subject' : null)}
        onSend={async (text, file) => {
          const detail = await create.mutateAsync({
            subject: normalizeSubject(subject),
            body: text,
            linkType,
            linkId: linkType ? params.linkId : undefined,
            file,
          });
          router.replace({ pathname: '/message/[id]', params: { id: detail.id } });
        }}
      />
    </ScrollView>
  );
}
