import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { OfflineBanner } from '@/ui/offline-banner';
import { ScreenHeader } from '@/ui/screen-header';
import { FloatingTabBar } from '@/ui/tab-bar';

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          header: ({ options }) => (
            <View>
              <ScreenHeader title={typeof options.title === 'string' ? options.title : ''} />
              <OfflineBanner />
            </View>
          ),
          sceneStyle: { backgroundColor: t.colors.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: tr('tab_home') }} />
        <Tabs.Screen name="cheques" options={{ title: tr('tab_cheques') }} />
        <Tabs.Screen name="properties" options={{ title: tr('tab_properties') }} />
        <Tabs.Screen name="disputes" options={{ title: tr('tab_disputes') }} />
      </Tabs>
    </View>
  );
}
