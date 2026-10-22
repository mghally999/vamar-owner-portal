import { Ionicons } from '@expo/vector-icons';
import { Link, Tabs } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/lib/i18n';
import { fonts, useTheme } from '@/lib/theme';
import { OfflineBanner } from '@/ui/offline-banner';

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: t.colors.bg },
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 20, color: t.colors.ink },
          headerTitleAlign: 'left',
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('settings')}
                hitSlop={8}
                style={{ paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' }}
              >
                <Ionicons name="settings-outline" size={22} color={t.colors.ink} />
              </Pressable>
            </Link>
          ),
          tabBarActiveTintColor: t.colors.primary,
          tabBarInactiveTintColor: t.colors.inkSoft,
          tabBarStyle: {
            backgroundColor: t.colors.bgElevated,
            borderTopColor: t.colors.border,
            // Edge-to-edge on Android 15+: a fixed height must include the gesture bar inset.
            height: 58 + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom,
          },
          tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
          sceneStyle: { backgroundColor: t.colors.bg },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: tr('tab_home'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="cheques"
          options={{
            title: tr('tab_cheques'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="receipt-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="properties"
          options={{
            title: tr('tab_properties'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="business-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="disputes"
          options={{
            title: tr('tab_disputes'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="scale-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
