import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { phoneE164Schema } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { fonts, useTheme } from '@/lib/theme';
import { Button, Text } from '@/ui';
import { Logo } from '@/ui/logo';

/** Phone entry: +971 by default; the number is normalised to E.164 before Firebase. */
export default function PhoneScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [local, setLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = normalise(local);
  // UAE mobiles: 9 digits after +971, starting with 5 (a leading 0 is dropped by normalise).
  const valid = phoneE164Schema.safeParse(e164).success && /^\+9715\d{8}$/.test(e164);

  async function submit() {
    if (!valid) {
      setError(tr('phone_invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.sendCode(e164);
      router.push({ pathname: '/(auth)/otp', params: { phone: e164 } });
    } catch {
      setError(tr('phone_sendFailed'));
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
      <View style={{ alignItems: 'flex-start', gap: 16 }}>
        <Logo variant="full" width={140} color={t.scheme === 'dark' ? '#c4c6be' : '#25323a'} />
        <View style={{ gap: 4 }}>
          <Text variant="title" weight="semibold">
            {tr('phone_title')}
          </Text>
          <Text variant="secondary" color="soft">
            {tr('phone_subtitle')}
          </Text>
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="caption" weight="medium" color="soft">
          {tr('phone_label')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, direction: 'ltr' }}>
          <View
            style={{
              height: 52,
              paddingHorizontal: 14,
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: t.colors.borderStrong,
              borderRadius: t.radius.md,
              backgroundColor: t.colors.bgElevated,
            }}
          >
            <Text weight="medium" tnum>
              +971
            </Text>
          </View>
          <TextInput
            accessibilityLabel={tr('phone_label')}
            value={local}
            onChangeText={(v) => {
              setLocal(v.replace(/[^\d+]/g, ''));
            }}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            placeholder="50 123 4567"
            placeholderTextColor={t.colors.inkFaint}
            autoFocus
            onSubmitEditing={() => void submit()}
            style={{
              flex: 1,
              height: 52,
              paddingHorizontal: 14,
              borderWidth: 1,
              borderColor: error ? t.colors.danger : t.colors.borderStrong,
              borderRadius: t.radius.md,
              backgroundColor: t.colors.bgElevated,
              color: t.colors.ink,
              fontFamily: fonts.regular,
              fontSize: 17,
              fontVariant: ['tabular-nums'],
              textAlign: 'left',
            }}
          />
        </View>
        {error ? (
          <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>

      <Button
        title={tr('phone_continue')}
        onPress={() => void submit()}
        loading={busy}
        disabled={!valid}
      />
    </KeyboardAvoidingView>
  );
}

function normalise(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (input.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('971')) return `+${digits}`;
  if (digits.startsWith('0')) return `+971${digits.slice(1)}`;
  return `+971${digits}`;
}
