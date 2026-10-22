import { useNetInfo } from '@react-native-community/netinfo';
import { View } from 'react-native';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from '@/ui';

/**
 * Shown above the tabs while the phone has no connection. Lists keep showing what was fetched
 * last, so the owner knows the numbers may be a little old instead of seeing an error.
 */
export function OfflineBanner() {
  const net = useNetInfo();
  const t = useTheme();
  const { t: tr } = useI18n();
  if (net.isConnected !== false) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: t.colors.bgSunken,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
        paddingHorizontal: 16,
        paddingVertical: 8,
      }}
    >
      <Text variant="caption" color="soft">
        {tr('offline_banner')}
      </Text>
    </View>
  );
}
