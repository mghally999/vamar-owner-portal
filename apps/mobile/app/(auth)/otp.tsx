import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountDisabledError, NotRegisteredError, useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { fonts, useTheme } from '@/lib/theme';
import { Button, Text } from '@/ui';

export default function OtpScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(value: string) {
    if (!/^\d{6}$/.test(value)) return;
    setBusy(true);
    setError(null);
    try {
      await auth.verifyCode(value);
    } catch (e) {
      if (e instanceof NotRegisteredError) router.replace('/(auth)/not-registered');
      else if (e instanceof AccountDisabledError)
        router.replace({ pathname: '/(auth)/not-registered', params: { disabled: '1' } });
      else {
        setError(tr('otp_wrong'));
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{
        flex: 1,
        paddingTop: insets.top + 48,
        paddingHorizontal: 16,
        paddingBottom: insets.bottom + 16,
        gap: 24,
      }}
    >
      <View style={{ gap: 4 }}>
        <Text variant="title" weight="semibold">
          {tr('otp_title')}
        </Text>
        <Text variant="secondary" color="soft">
          {tr('otp_subtitle', { phone })}
        </Text>
      </View>
      <TextInput
        accessibilityLabel={tr('otp_title')}
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void verify(digits);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus
        maxLength={6}
        placeholder="••••••"
        placeholderTextColor={t.colors.inkFaint}
        style={{
          height: 64,
          borderWidth: 1,
          borderColor: error ? t.colors.danger : t.colors.borderStrong,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.bgElevated,
          color: t.colors.ink,
          fontFamily: fonts.medium,
          fontSize: 28,
          letterSpacing: 12,
          textAlign: 'center',
          fontVariant: ['tabular-nums'],
          direction: 'ltr',
        }}
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button
        title={tr('otp_verify')}
        onPress={() => void verify(code)}
        loading={busy}
        disabled={code.length !== 6}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Button
          title={tr('otp_change')}
          variant="ghost"
          onPress={() => {
            router.back();
          }}
        />
        <Button
          title={tr('otp_resend')}
          variant="ghost"
          onPress={() => {
            if (phone) void auth.sendCode(phone);
          }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
