/**
 * An image the API serves behind the owner's session (cheque scans, invoice photos, job photos).
 * expo-image sends the Bearer header and caches the picture by address. The access token lasts
 * minutes, so a screen opened from the cache or left open can ask with an expired one and get
 * 401: the first failure refreshes the session once and loads the picture again.
 */
import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { useState } from 'react';
import type { StyleProp } from 'react-native';
import { authHeaders, refreshSession } from '@/lib/api';

export function AuthImage({
  uri,
  style,
  contentFit = 'cover',
  accessibilityLabel,
}: {
  uri: string;
  style: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  accessibilityLabel?: string | undefined;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <Image
      // A new key mounts a new image, which reads the fresh token below.
      key={attempt}
      source={{ uri, headers: authHeaders() }}
      cachePolicy="memory-disk"
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      style={style}
      contentFit={contentFit}
      placeholder={null}
      transition={150}
      onError={() => {
        if (attempt > 0) return;
        void refreshSession().then((r) => {
          if (r.ok) setAttempt(1);
        });
      }}
    />
  );
}
