/**
 * A row of filter chips that scrolls sideways (properties, statuses, categories): the chosen one
 * filled, every chip a button that says whether it is selected.
 */
import type { ReactNode } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme';
import { Text } from './index';

export function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        justifyContent: 'center',
        backgroundColor: active ? t.colors.primary : t.colors.bgElevated,
        borderWidth: 1,
        borderColor: active ? t.colors.primary : t.colors.border,
      }}
    >
      <Text
        variant="caption"
        weight="medium"
        style={{ color: active ? t.colors.onPrimary : t.colors.ink }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function FilterChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
    >
      {children}
    </ScrollView>
  );
}
