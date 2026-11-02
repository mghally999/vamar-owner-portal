import { Pressable, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { Text } from '.';

/** A segmented control (List | Calendar, Month | 6 months | Year, Year | Month | Week | Agenda). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        padding: 4,
        gap: 2,
        borderRadius: t.radius.md,
        backgroundColor: t.colors.bgSunken,
        borderWidth: 0.8,
        borderColor: t.colors.border,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              onChange(o.value);
            }}
            style={{
              flex: 1,
              minHeight: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: t.radius.sm,
              backgroundColor: active ? t.colors.bgElevated : 'transparent',
              borderWidth: active ? 0.8 : 0,
              borderColor: t.colors.border,
            }}
          >
            <Text
              variant="caption"
              weight={active ? 'medium' : 'regular'}
              numberOfLines={1}
              style={{ paddingEnd: 0 }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
