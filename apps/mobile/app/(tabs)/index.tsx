import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { todayInDubai, type PlainDate } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useHome } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import {
  Button,
  Card,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  ProgressBar,
  Row,
  SectionTitle,
  Separator,
  Skeleton,
  StatusChip,
  Text,
  layout,
} from '@/ui';
import { MonthSwitcher } from '@/ui/month-switcher';

/**
 * Owner home. Hierarchy: month switcher, hero (this month's expected total with cleared /
 * pending / bounced as one quiet line), next cheque, occupancy with vacant units, disputes.
 */
export default function HomeScreen() {
  const t = useTheme();
  const { t: tr, pick } = useI18n();
  const auth = useAuth();
  const [monthStart, setMonthStart] = useState<PlainDate>(
    `${todayInDubai().slice(0, 7)}-01` as PlainDate,
  );
  const q = useHome(monthStart.slice(0, 7));
  const d = q.data;

  return (
    <ScrollView
      contentContainerStyle={layout.screen}
      refreshControl={
        <RefreshControl
          refreshing={q.isRefetching}
          onRefresh={() => void q.refetch()}
          tintColor={t.colors.primary}
        />
      }
    >
      <MonthSwitcher value={monthStart} onChange={setMonthStart} />

      {q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <>
          {/* Hero */}
          <View style={{ gap: 4, paddingVertical: 8 }}>
            <Text variant="caption" weight="medium" color="soft">
              {tr('home_expected')}
            </Text>
            {d ? (
              d.expectedFils === 0 ? (
                <Text variant="hero" weight="semibold" color="primary">
                  —
                </Text>
              ) : (
                <Money fils={d.expectedFils} variant="hero" weight="semibold" color="primary" />
              )
            ) : (
              <Skeleton width={220} height={40} />
            )}
            {d ? (
              <Row style={{ gap: 14, flexWrap: 'wrap' }}>
                <Text variant="secondary" color="soft">
                  {tr('home_cleared')}{' '}
                  <Money fils={d.clearedFils} variant="secondary" weight="medium" />
                </Text>
                <Text variant="secondary" color="soft">
                  {tr('home_pending')}{' '}
                  <Money fils={d.pendingFils} variant="secondary" weight="medium" />
                </Text>
                <Text variant="secondary" color="soft">
                  {tr('home_bounced')}{' '}
                  <Text
                    variant="secondary"
                    weight="medium"
                    tnum
                    color={d.bouncedCount > 0 ? 'danger' : 'ink'}
                  >
                    {d.bouncedCount}
                  </Text>
                </Text>
              </Row>
            ) : (
              <Skeleton width={280} height={16} />
            )}
            {d ? (
              <Text variant="caption" color="faint" tnum>
                {tr('home_nextMonth', { amount: '' })}
                <Money fils={d.nextMonthFils} variant="caption" weight="regular" color="faint" />
              </Text>
            ) : null}
          </View>

          {d?.expectedFils === 0 && !d.nextCheque ? (
            <EmptyState title={tr('home_empty_title')} body={tr('home_empty_body')} />
          ) : null}

          {/* Next cheque */}
          <View>
            <SectionTitle>{tr('home_next')}</SectionTitle>
            {!d ? (
              <Skeleton height={96} radius={12} />
            ) : d.nextCheque ? (
              <Link href={{ pathname: '/cheque/[id]', params: { id: d.nextCheque.id } }} asChild>
                <Pressable accessibilityRole="button">
                  <Card style={{ padding: 16, gap: 8 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <DateText date={d.nextCheque.dueDate} variant="body" color="ink" />
                      <StatusChip status={d.nextCheque.status} />
                    </Row>
                    <Money fils={d.nextCheque.amountFils} variant="title" weight="semibold" />
                    <Text variant="secondary" color="soft">
                      {pick(d.nextCheque.buildingNameAr, d.nextCheque.buildingNameEn)}{' '}
                      {d.nextCheque.unitNo} · {d.nextCheque.tenantName}
                    </Text>
                  </Card>
                </Pressable>
              </Link>
            ) : (
              <EmptyState title={tr('home_next_empty')} />
            )}
          </View>

          {/* Occupancy */}
          <View>
            {!d ? (
              <Skeleton height={72} radius={12} />
            ) : (
              <Card style={{ padding: 16, gap: 10 }}>
                <Text weight="medium" tnum>
                  {tr('home_occupancy', {
                    occupied: d.occupancy.occupied,
                    total: d.occupancy.total,
                  })}
                </Text>
                <ProgressBar pct={d.occupancy.pct} />
                {d.vacantUnits.length > 0 ? (
                  <View style={{ gap: 0, marginTop: 4 }}>
                    <Text
                      variant="caption"
                      weight="medium"
                      color="soft"
                      style={{ marginBottom: 4 }}
                    >
                      {tr('home_vacant')}
                    </Text>
                    {d.vacantUnits.map((u, i) => (
                      <View key={u.unitId}>
                        {i > 0 ? <Separator /> : null}
                        <Link href={{ pathname: '/unit/[id]', params: { id: u.unitId } }} asChild>
                          <Pressable
                            accessibilityRole="button"
                            style={{ minHeight: 44, justifyContent: 'center' }}
                          >
                            <Row style={{ justifyContent: 'space-between' }}>
                              <Text variant="secondary">
                                {pick(u.buildingNameAr, u.buildingNameEn)} {u.unitNo}
                              </Text>
                              <Text variant="caption" color="soft" tnum>
                                {u.vacantSince
                                  ? tr('unit_vacantSince', { date: '' })
                                  : tr('unit_neverRented')}
                                {u.vacantSince ? (
                                  <DateText date={u.vacantSince} variant="caption" />
                                ) : null}
                              </Text>
                            </Row>
                          </Pressable>
                        </Link>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            )}
          </View>

          {/* Disputes */}
          {d ? (
            <Link href="/(tabs)/disputes" asChild>
              <Pressable accessibilityRole="button">
                <Card
                  style={{
                    padding: 16,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text weight="medium">
                    {d.openDisputes === 0
                      ? tr('home_disputes_none')
                      : d.openDisputes === 1
                        ? tr('home_disputes_one')
                        : tr('home_disputes', { n: d.openDisputes })}
                  </Text>
                  <Text color="soft">›</Text>
                </Card>
              </Pressable>
            </Link>
          ) : null}

          {auth.justSignedIn && auth.biometricsAvailable && !auth.biometricsEnabled ? (
            <Card style={{ padding: 16, gap: 10, borderColor: t.colors.primary }}>
              <Text weight="medium">{tr('bio_title')}</Text>
              <Text variant="secondary" color="soft">
                {tr('bio_body')}
              </Text>
              <Row style={{ gap: 8 }}>
                <Button
                  title={tr('bio_enable')}
                  onPress={() => {
                    void auth.setBiometrics(true).then(() => {
                      auth.clearJustSignedIn();
                    });
                  }}
                  style={{ flex: 1 }}
                />
                <Button
                  title={tr('bio_later')}
                  variant="ghost"
                  onPress={() => {
                    auth.clearJustSignedIn();
                  }}
                />
              </Row>
            </Card>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
