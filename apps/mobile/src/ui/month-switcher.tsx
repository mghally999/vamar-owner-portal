import { Pressable, View } from 'react-native';
import { addMonthsClamped, type PlainDate } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from '.';
import { Icon } from './icon';

/**
 * Month switcher from the design: a bordered pill, the month in the middle, a 38 px chevron
 * button at each end. `value` is the first day of the month.
 */
export function MonthSwitcher({
  value,
  onChange,
}: {
  value: PlainDate;
  onChange: (next: PlainDate) => void;
}) {
  const t = useTheme();
  const { month, isRTL, t: tr } = useI18n();
  const button = (dir: -1 | 1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr(dir < 0 ? 'month_prev' : 'month_next')}
      onPress={() => {
        onChange(addMonthsClamped(value, dir));
      }}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.colors.bgSunken : 'transparent',
      })}
    >
      {/* Both design chevrons point right: mirror the one that must point left. */}
      <Icon
        name={dir < 0 ? 'chevronPrev' : 'chevronNext'}
        color={t.colors.ink}
        flip={isRTL ? dir > 0 : dir < 0}
      />
    </Pressable>
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 52,
        padding: 6,
        borderRadius: t.radius.md,
        borderWidth: 0.8,
        borderColor: t.colors.border,
        backgroundColor: t.colors.bgElevated,
      }}
    >
      {button(-1)}
      <Text variant="body" weight="medium" tnum>
        {month(value)}
      </Text>
      {button(1)}
    </View>
  );
}
