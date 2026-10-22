import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Tabs } from 'expo-router';
import { useTheme } from '@/lib/theme';
import { Text } from '.';
import { Icon, type IconName } from './icon';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICON_FOR: Record<string, IconName> = {
  index: 'home',
  cheques: 'cheques',
  properties: 'properties',
  disputes: 'disputes',
};

/** Floating pill tab bar from the design; the active tab is a filled rounded button. */
export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 12),
        backgroundColor: t.colors.bg,
      }}
    >
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          gap: 4,
          padding: 12,
          borderRadius: t.radius.lg,
          backgroundColor: t.colors.tabBar,
          borderWidth: t.name === 'white' && t.scheme === 'light' ? 0.8 : 0,
          borderColor: t.colors.border,
        }}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key]?.options;
          const label = typeof options?.title === 'string' ? options.title : route.name;
          const fg = focused ? t.colors.onTabActive : t.colors.tabInk;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={{
                flex: 1,
                alignItems: 'center',
                gap: 4,
                paddingVertical: 10,
                borderRadius: t.radius.sm,
                backgroundColor: focused ? t.colors.tabActive : 'transparent',
              }}
            >
              <Icon name={ICON_FOR[route.name] ?? 'home'} color={fg} />
              <Text
                variant="caption"
                weight={focused ? 'medium' : 'regular'}
                numberOfLines={1}
                style={{ color: fg, lineHeight: 14, paddingEnd: 0 }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
