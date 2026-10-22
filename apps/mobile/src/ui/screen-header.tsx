import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from '.';
import { Icon } from './icon';

/** Tab screen header from the design: title at the start, settings at the end, rounded bottom. */
export function ScreenHeader({ title }: { title: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: t.colors.header,
        borderBottomWidth: 0.8,
        borderColor: t.colors.headerBorder,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        paddingTop: insets.top + 14,
        paddingBottom: 20,
        paddingHorizontal: 24,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text
        accessibilityRole="header"
        variant="title"
        weight="semibold"
        color="onHeader"
        numberOfLines={1}
      >
        {title}
      </Text>
      <Link href="/settings" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('settings')}
          hitSlop={10}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="settings" color={t.colors.onHeader} />
        </Pressable>
      </Link>
    </View>
  );
}
