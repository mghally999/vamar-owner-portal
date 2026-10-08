import * as Application from 'expo-application';
import { useState } from 'react';
import { Linking, ScrollView, Switch, View } from 'react-native';
import { API_BASE } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useDevices, useRequestDeletion, useRevokeOtherDevices, useSetLang } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { Button, Card, Row, SectionTitle, Separator, Text, layout } from '@/ui';

export default function SettingsScreen() {
  const t = useTheme();
  const { t: tr, lang, switchLang } = useI18n();
  const auth = useAuth();
  const devices = useDevices();
  const revoke = useRevokeOtherDevices();
  const del = useRequestDeletion();
  const setLang = useSetLang();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <ScrollView contentContainerStyle={layout.screen}>
      <View style={{ paddingVertical: 8, gap: 2 }}>
        <Text variant="title" weight="semibold">
          {auth.owner ? (lang === 'ar' ? auth.owner.nameAr : auth.owner.nameEn) : tr('settings')}
        </Text>
      </View>

      <Card style={{ paddingHorizontal: 16 }}>
        <Row style={{ justifyContent: 'space-between', minHeight: 56 }}>
          <Text>{tr('settings_language')}</Text>
          <Row style={{ gap: 8 }}>
            {(['ar', 'en'] as const).map((l) => (
              <Button
                key={l}
                title={l === 'ar' ? 'العربية' : 'English'}
                variant={lang === l ? 'primary' : 'secondary'}
                onPress={() => {
                  if (lang === l) return;
                  setLang.mutate(l);
                  void switchLang(l);
                }}
                style={{ minHeight: 40, paddingHorizontal: 12 }}
              />
            ))}
          </Row>
        </Row>
        <Separator />
        <Row style={{ justifyContent: 'space-between', minHeight: 56 }}>
          <Text>{tr('settings_biometrics')}</Text>
          <Switch
            value={auth.biometricsEnabled}
            disabled={!auth.biometricsAvailable}
            onValueChange={(v) => void auth.setBiometrics(v)}
            trackColor={{ true: t.colors.primary }}
          />
        </Row>
      </Card>

      <View>
        <SectionTitle>{tr('settings_devices')}</SectionTitle>
        <Card style={{ paddingHorizontal: 16 }}>
          {(devices.data ?? [])
            .filter((d) => !d.revokedAt)
            .map((d, i) => (
              <View key={d.id}>
                {i > 0 ? <Separator /> : null}
                <Row style={{ justifyContent: 'space-between', minHeight: 52 }}>
                  <Text>
                    {d.model || d.platform}
                    {d.current ? (
                      <Text variant="caption" color="soft">
                        {'  '}
                        {tr('this_device')}
                      </Text>
                    ) : null}
                  </Text>
                  <Text variant="caption" color="faint" tnum>
                    {d.lastSeen.slice(0, 10)}
                  </Text>
                </Row>
              </View>
            ))}
          <Separator />
          <View style={{ paddingVertical: 12 }}>
            <Button
              title={tr('settings_signOutOthers')}
              variant="secondary"
              onPress={() => {
                revoke.mutate();
              }}
              loading={revoke.isPending}
            />
          </View>
        </Card>
      </View>

      <Card style={{ paddingHorizontal: 16 }}>
        <View style={{ paddingVertical: 12, gap: 8 }}>
          <Button
            title={tr('settings_privacy')}
            variant="ghost"
            onPress={() => void Linking.openURL(`${API_BASE}/privacy`)}
          />
          <Button
            title={tr('settings_signOut')}
            variant="secondary"
            onPress={() => void auth.signOut()}
          />
        </View>
      </Card>

      <Card style={{ padding: 16, gap: 8, borderColor: t.colors.danger }}>
        <Text weight="medium">{tr('settings_delete')}</Text>
        <Text variant="secondary" color="soft">
          {tr('settings_delete_body')}
        </Text>
        {confirmDelete ? (
          <Row style={{ gap: 8 }}>
            <Button
              title={tr('settings_delete_confirm')}
              variant="danger"
              loading={del.isPending}
              onPress={() => {
                void del.mutateAsync('').then(() => auth.signOut());
              }}
              style={{ flex: 1 }}
            />
            <Button
              title={tr('cancel')}
              variant="ghost"
              onPress={() => {
                setConfirmDelete(false);
              }}
            />
          </Row>
        ) : (
          <Button
            title={tr('settings_delete')}
            variant="danger"
            onPress={() => {
              setConfirmDelete(true);
            }}
          />
        )}
      </Card>

      <Text variant="caption" color="faint" style={{ textAlign: 'center' }}>
        {tr('settings_about')} ·{' '}
        {tr('settings_version', { v: Application.nativeApplicationVersion ?? '0.1.0' })}
      </Text>
    </ScrollView>
  );
}
