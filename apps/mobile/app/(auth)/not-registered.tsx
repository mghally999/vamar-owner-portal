import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/lib/i18n';
import { Button, Text } from '@/ui';
import { Logo } from '@/ui/logo';
import { useTheme } from '@/lib/theme';

const VAMAR_PHONE = '+971505589967';

/** Polite dead end for unknown numbers (invite only) and disabled accounts. */
export default function NotRegisteredScreen() {
  const { t: tr } = useI18n();
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { disabled } = useLocalSearchParams<{ disabled?: string }>();
  const isDisabled = disabled === '1';

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top + 48,
        paddingHorizontal: 16,
        paddingBottom: insets.bottom + 16,
        gap: 24,
      }}
    >
      <Logo variant="mark" width={40} color={t.scheme === 'dark' ? '#c4c6be' : '#25323a'} />
      <View style={{ gap: 8 }}>
        <Text variant="title" weight="semibold">
          {isDisabled ? tr('disabled_title') : tr('notreg_title')}
        </Text>
        <Text color="soft">{isDisabled ? tr('disabled_body') : tr('notreg_body')}</Text>
      </View>
      <View style={{ gap: 8 }}>
        <Button
          title={tr('notreg_call')}
          onPress={() => void Linking.openURL(`tel:${VAMAR_PHONE}`)}
        />
        <Button
          title={tr('notreg_back')}
          variant="secondary"
          onPress={() => {
            router.replace('/(auth)');
          }}
        />
      </View>
    </View>
  );
}
