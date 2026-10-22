import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import type { UpdateState } from '@/lib/version';
import { Button, Text } from '@/ui';
import { Logo } from '@/ui/logo';

/** Blocking screen when the installed app is older than the minimum the API still supports. */
export function UpdateRequired({ state }: { state: Extract<UpdateState, { kind: 'required' }> }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityViewIsModal
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: t.colors.hero,
        paddingTop: insets.top + 48,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
        justifyContent: 'space-between',
      }}
    >
      <View style={{ gap: 16, alignItems: 'flex-start' }}>
        <Logo
          variant="mark"
          width={44}
          color={t.colors.onHero === '#ffffff' ? '#ffffff' : '#25323a'}
        />
        <Text variant="title" weight="semibold" color="onHero">
          {tr('update_required_title')}
        </Text>
        <Text color="onHeroSoft">
          {tr('update_required_body', {
            installed: state.installed,
            latest: state.info.latestVersion,
          })}
        </Text>
      </View>
      <Button
        title={tr('update_download')}
        variant="secondary"
        onPress={() => void Linking.openURL(state.info.downloadUrl)}
      />
    </View>
  );
}

/** Quiet banner on Home when a newer version exists; hidden for the session once dismissed. */
export function UpdateBanner({ state }: { state: Extract<UpdateState, { kind: 'available' }> }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <View
      style={{
        borderRadius: t.radius.md,
        borderWidth: 0.8,
        borderColor: t.colors.border,
        backgroundColor: t.colors.bgSunken,
        padding: 14,
        gap: 8,
      }}
    >
      <Text variant="secondary" weight="medium">
        {tr('update_available', { latest: state.info.latestVersion })}
      </Text>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(state.info.downloadUrl)}
          hitSlop={8}
        >
          <Text variant="secondary" weight="medium" style={{ textDecorationLine: 'underline' }}>
            {tr('update_download')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setHidden(true);
          }}
          hitSlop={8}
        >
          <Text variant="secondary" color="soft">
            {tr('update_later')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
