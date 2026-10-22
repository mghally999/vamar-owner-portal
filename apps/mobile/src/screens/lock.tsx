import { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Button, Text } from '@/ui';
import { Logo } from '@/ui/logo';

/** Full-screen biometric gate shown on open and after 5 minutes in the background. */
export function LockScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void auth.unlock();
  }, [auth]);

  return (
    <View
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: '#25323a',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
        gap: 24,
      }}
    >
      <Logo variant="full" width={160} color="#c4c6be" />
      <Text variant="heading" weight="medium" style={{ color: '#ebe6dd' }}>
        {t('bio_locked')}
      </Text>
      <Button
        title={t('bio_unlock')}
        variant="secondary"
        onPress={() => void auth.unlock()}
        style={{ minWidth: 200 }}
      />
      <Button title={t('settings_signOut')} variant="ghost" onPress={() => void auth.signOut()} />
    </View>
  );
}
