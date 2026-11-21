import * as Application from 'expo-application';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Switch, View } from 'react-native';
import { todayInDubai } from '@/lib/shared';
import { API_BASE, request } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dubaiDay } from '@/lib/dubai-day';
import { useI18n } from '@/lib/i18n';
import { useThreads } from '@/lib/message-queries';
import { useMessageText } from '@/lib/message-text';
import { lastPushState, notificationsEnabled, setNotifications, type PushState } from '@/lib/push';
import { useDevices, useRequestDeletion, useRevokeOtherDevices, useSetLang } from '@/lib/queries';
import { periodLabel, shareStatement } from '@/lib/statement';
import { THEME_NAMES } from '@vamar/tokens';
import { useTheme, useThemeChoice } from '@/lib/theme';
import type { ChequeItem, Page } from '@/lib/types';
import {
  Button,
  Card,
  ErrorState,
  Row,
  SectionTitle,
  Separator,
  Skeleton,
  Text,
  layout,
} from '@/ui';
import { YearStatementPicker } from '@/ui/year-statement';

export default function SettingsScreen() {
  const t = useTheme();
  const themeChoice = useThemeChoice();
  const { t: tr, lang, switchLang, date } = useI18n();
  const auth = useAuth();
  const devices = useDevices();
  const revoke = useRevokeOtherDevices();
  const del = useRequestDeletion();
  const setLang = useSetLang();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notify, setNotify] = useState(true);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [busyStatement, setBusyStatement] = useState(false);
  const [statementError, setStatementError] = useState(false);
  const tm = useMessageText();
  const threads = useThreads();
  const unreadThreads = threads.data?.unreadThreads ?? 0;

  useEffect(() => {
    void notificationsEnabled().then(setNotify);
    void lastPushState().then(setPushState);
  }, []);

  /** This month's cheques; the yearly statement has its own picker below. */
  async function monthStatement() {
    setBusyStatement(true);
    setStatementError(false);
    try {
      const today = todayInDubai();
      const page = await request<Page<ChequeItem>>(
        `/api/owner/cheques?month=${today.slice(0, 7)}&limit=100`,
      );
      const ownerName = auth.owner ? (lang === 'ar' ? auth.owner.nameAr : auth.owner.nameEn) : '';
      await shareStatement({
        ownerName,
        periodLabel: periodLabel('month', today, lang),
        cheques: page.items,
        lang,
        generatedOn: today,
      });
    } catch {
      setStatementError(true);
    } finally {
      setBusyStatement(false);
    }
  }

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
          <Text>{tr('settings_theme')}</Text>
          <Row style={{ gap: 8 }}>
            {THEME_NAMES.map((name) => (
              <Button
                key={name}
                title={tr(name === 'default' ? 'theme_default' : 'theme_white')}
                variant={themeChoice.name === name ? 'primary' : 'secondary'}
                accessibilityState={{ selected: themeChoice.name === name }}
                onPress={() => {
                  void themeChoice.setName(name);
                }}
                style={{ minHeight: 40, paddingHorizontal: 12 }}
              />
            ))}
          </Row>
        </Row>
        <Separator />
        <Row style={{ justifyContent: 'space-between', minHeight: 56 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text>{tr('settings_notifications')}</Text>
            {pushState === 'unsupported' || (notify && pushState && pushState !== 'registered') ? (
              <Text variant="caption" color="soft">
                {tr(`settings_push_${pushState}`)}
              </Text>
            ) : null}
          </View>
          <Switch
            accessibilityLabel={tr('settings_notifications')}
            value={notify}
            // The web app has no push channel; the line above says so.
            disabled={pushState === 'unsupported'}
            onValueChange={(v) => {
              setNotify(v);
              void setNotifications(v).then(setPushState);
            }}
            trackColor={{ true: t.colors.primary, false: t.colors.borderStrong }}
            thumbColor={t.colors.bgElevated}
          />
        </Row>
        <Separator />
        <Row style={{ justifyContent: 'space-between', minHeight: 56 }}>
          <Text>{tr('settings_biometrics')}</Text>
          <Switch
            accessibilityLabel={tr('settings_biometrics')}
            value={auth.biometricsEnabled}
            disabled={!auth.biometricsAvailable}
            onValueChange={(v) => void auth.setBiometrics(v)}
            trackColor={{ true: t.colors.primary, false: t.colors.borderStrong }}
            thumbColor={t.colors.bgElevated}
          />
        </Row>
      </Card>

      <Card style={{ paddingHorizontal: 16 }}>
        <Link href="/messages" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unreadThreads > 0
                ? `${tm('settings_messages')}, ${tm('messages_unread', { n: unreadThreads })}`
                : tm('settings_messages')
            }
          >
            <Row style={{ justifyContent: 'space-between', minHeight: 56, gap: 12 }}>
              <Text>{tm('settings_messages')}</Text>
              {unreadThreads > 0 ? (
                <View
                  style={{
                    backgroundColor: t.colors.primary,
                    borderRadius: t.radius.full,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                  }}
                >
                  <Text variant="caption" weight="medium" color="onPrimary" tnum>
                    {tm('messages_unread', { n: unreadThreads })}
                  </Text>
                </View>
              ) : null}
            </Row>
          </Pressable>
        </Link>
      </Card>

      <View>
        <SectionTitle>{tr('settings_statement')}</SectionTitle>
        <Card style={{ padding: 16, gap: 8 }}>
          <Button
            title={tr('settings_statement_month')}
            variant="secondary"
            loading={busyStatement}
            onPress={() => void monthStatement()}
          />
          {statementError ? (
            <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
              {tr('error_generic')}
            </Text>
          ) : null}
          <Separator />
          <Text weight="medium" style={{ paddingTop: 4 }}>
            {tr('yearStatement_title')}
          </Text>
          <YearStatementPicker />
        </Card>
      </View>

      <View>
        <SectionTitle>{tr('settings_devices')}</SectionTitle>
        {devices.isError ? (
          <ErrorState onRetry={() => void devices.refetch()} />
        ) : (
          <Card style={{ paddingHorizontal: 16 }}>
            {devices.isPending ? (
              <View style={{ paddingVertical: 12, gap: 12 }}>
                <Skeleton height={20} />
                <Skeleton height={20} width="60%" />
              </View>
            ) : null}
            {(devices.data ?? [])
              .filter((d) => !d.revokedAt)
              .map((d, i) => (
                <View key={d.id}>
                  {i > 0 ? <Separator /> : null}
                  <Row style={{ justifyContent: 'space-between', minHeight: 56, gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1}>{d.model || d.platform}</Text>
                      {d.current ? (
                        <Text variant="caption" color="soft">
                          {tr('this_device')}
                        </Text>
                      ) : null}
                    </View>
                    <Text variant="caption" color="faint" tnum>
                      {date(dubaiDay(d.lastSeen))}
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
              {revoke.isError ? (
                <Text
                  variant="caption"
                  color="danger"
                  accessibilityLiveRegion="polite"
                  style={{ paddingTop: 8 }}
                >
                  {tr('settings_signOutOthers_failed')}
                </Text>
              ) : null}
            </View>
          </Card>
        )}
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
                del.mutate('', { onSuccess: () => void auth.signOut() });
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
        ) : null}
        {confirmDelete && del.isError ? (
          <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
            {tr('error_generic')}
          </Text>
        ) : null}
        {confirmDelete ? null : (
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
