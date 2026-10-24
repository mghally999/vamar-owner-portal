import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from '.';
import { Icon } from './icon';

/**
 * Screen header from the design (Home frame 25:171): the theme's header colour (slate in Default,
 * white in White), rounded bottom, title at the start. Tab screens show settings at the end; stack
 * screens (cheque, unit, dispute, settings) pass `onBack` and show a back button before the title.
 */
export function ScreenHeader({
  title,
  onBack,
  showSettings = !onBack,
}: {
  title: string;
  onBack?: (() => void) | undefined;
  showSettings?: boolean;
}) {
  const t = useTheme();
  const { t: tr, isRTL } = useI18n();
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
        paddingHorizontal: onBack ? 12 : 24,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('back')}
            onPress={onBack}
            hitSlop={10}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="chevronPrev" color={t.colors.onHeader} flip={!isRTL} />
          </Pressable>
        ) : null}
        <Text
          accessibilityRole="header"
          variant="title"
          weight="semibold"
          color="onHeader"
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
      {showSettings ? (
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
      ) : null}
    </View>
  );
}
