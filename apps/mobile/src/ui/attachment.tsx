/**
 * A stored file on a detail screen: a photo shown with the session (expo-image sends the header),
 * anything else (a PDF invoice or quote) as a button that downloads it with the session and opens
 * it. One place for expenses, maintenance jobs, repair approvals and messages.
 */
import type { ImageStyle } from 'expo-image';
import { useState } from 'react';
import { View, type StyleProp } from 'react-native';
import { attachmentUrl, openAttachment, type AttachmentFile } from '@/lib/attachments';
import { useI18n } from '@/lib/i18n';
import { AuthImage } from './auth-image';
import { Button, Text } from './index';

export function AttachmentImage({
  file,
  style,
  decorative = false,
}: {
  file: AttachmentFile;
  style: StyleProp<ImageStyle>;
  /** Inside a button that already says what it is: no second label for screen readers. */
  decorative?: boolean;
}) {
  return (
    <AuthImage
      uri={attachmentUrl(file.id)}
      style={style}
      accessibilityLabel={decorative ? undefined : file.fileName}
    />
  );
}

export function AttachmentButton({ file, title }: { file: AttachmentFile; title: string }) {
  const { t: tr } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Button
        title={title}
        variant="secondary"
        loading={busy}
        onPress={() => {
          setBusy(true);
          setFailed(false);
          // Called during the tap: the web app opens its tab here (see attachments.web.ts).
          openAttachment(file)
            .catch(() => {
              setFailed(true);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      />
      {failed ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {tr('file_open_failed')}
        </Text>
      ) : null}
    </View>
  );
}
