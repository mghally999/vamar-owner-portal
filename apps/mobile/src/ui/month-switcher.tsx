import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { addMonthsClamped, type PlainDate } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from '.';

/** Month switcher; `value` is the first day of the month. Arrows flip with RTL automatically. */
export function MonthSwitcher({
  value,
  onChange,
}: {
  value: PlainDate;
  onChange: (next: PlainDate) => void;
}) {
  const t = useTheme();
  const { month, isRTL } = useI18n();
  const prevIcon = isRTL ? 'chevron-forward' : 'chevron-back';
  const nextIcon = isRTL ? 'chevron-back' : 'chevron-forward';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 48,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="previous month"
        onPress={() => {
          onChange(addMonthsClamped(value, -1));
        }}
        hitSlop={8}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name={prevIcon} size={22} color={t.colors.ink} />
      </Pressable>
      <Text variant="heading" weight="semibold" tnum>
        {month(value)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="next month"
        onPress={() => {
          onChange(addMonthsClamped(value, 1));
        }}
        hitSlop={8}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name={nextIcon} size={22} color={t.colors.ink} />
      </Pressable>
    </View>
  );
}
