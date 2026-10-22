import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { todayInDubai, type PlainDate } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useHome } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import {
  Amount,
  Button,
  Card,
  Chip,
  DateText,
  EmptyState,
  ErrorState,
  ProgressBar,
  Row,
  Separator,
  Skeleton,
  Text,
  layout,
} from '@/ui';
import { Icon } from '@/ui/icon';
import { MonthSwitcher } from '@/ui/month-switcher';
import { UpdateBanner } from '@/screens/update';
import { useUpdateState } from '@/lib/version';

/**
 * Owner home, as designed (Figma "Vamar" Page 2, frame "test"): month switcher; the month's money
 * card (expected total, then paid / pending / bounced tiles, then next month); the next cheque;
 * occupancy with the vacant units; open disputes.
 */
export default function HomeScreen() {
  const t = useTheme();
  const { t: tr, pick, isRTL } = useI18n();
  const auth = useAuth();
  const [monthStart, setMonthStart] = useState<PlainDate>(
    `${todayInDubai().slice(0, 7)}-01` as PlainDate,
  );
  const q = useHome(monthStart.slice(0, 7));
  const update = useUpdateState();
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
      {update.kind === 'available' ? <UpdateBanner state={update} /> : null}
      <MonthSwitcher value={monthStart} onChange={setMonthStart} />

      {q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <>
          {/* The month's money */}
          <View
            style={{
              backgroundColor: t.colors.hero,
              borderColor: t.colors.heroBorder,
              borderWidth: 0.8,
              borderRadius: t.radius.lg,
              padding: 16,
            }}
          >
            <Text variant="secondary" weight="medium" color="onHeroSoft">
              {tr('home_expected')}
            </Text>
            <View style={{ paddingVertical: 12 }}>
              {d ? (
                <Amount fils={d.expectedFils} size="hero" color="onHero" />
              ) : (
                <Skeleton width={200} height={46} />
              )}
            </View>
            <Row style={{ gap: 4 }}>
              {(
                [
                  ['home_cleared', d?.clearedFils],
                  ['home_pending', d?.pendingFils],
                  ['home_bounced', d?.bouncedFils],
                ] as [MessageKey, number | undefined][]
              ).map(([label, fils]) => (
                <View
                  key={label}
                  style={{
                    flex: 1,
                    backgroundColor: t.colors.heroTile,
                    borderRadius: t.radius.sm,
                    padding: 12,
                    gap: 4,
                  }}
                >
                  <Text variant="caption" color="onHeroSoft" numberOfLines={1}>
                    {tr(label)}
                  </Text>
                  {d ? (
                    <Amount fils={fils ?? 0} size="body" weight="medium" color="onHero" />
                  ) : (
                    <Skeleton width={60} height={20} />
                  )}
                </View>
              ))}
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingTop: 16, paddingHorizontal: 4 }}>
              <Text variant="caption" color="onHeroSoft">
                {tr('home_nextMonthLabel')}
              </Text>
              {d ? (
                <Amount fils={d.nextMonthFils} size="body" weight="medium" color="onHero" />
              ) : null}
            </Row>
          </View>

          {d?.expectedFils === 0 && !d.nextCheque ? (
            <EmptyState title={tr('home_empty_title')} body={tr('home_empty_body')} />
          ) : null}

          {/* Next cheque */}
          {!d ? (
            <Skeleton height={190} radius={24} />
          ) : d.nextCheque ? (
            <Link href={{ pathname: '/cheque/[id]', params: { id: d.nextCheque.id } }} asChild>
              <Pressable accessibilityRole="button">
                <Card style={{ padding: 16 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text weight="medium">{tr('home_next')}</Text>
                    <Chip label={tr(`status_${d.nextCheque.status}` as MessageKey)} />
                  </Row>
                  <View style={{ paddingTop: 14 }}>
                    <Amount fils={d.nextCheque.amountFils} size="title" />
                  </View>
                  <View style={{ marginTop: 16 }}>
                    <Separator />
                    <Text weight="medium" style={{ marginTop: 13 }}>
                      {d.nextCheque.tenantName}
                    </Text>
                    <Row style={{ justifyContent: 'space-between', marginTop: 5 }}>
                      <Text variant="caption" color="soft" numberOfLines={1} style={{ flex: 1 }}>
                        {pick(d.nextCheque.buildingNameAr, d.nextCheque.buildingNameEn)}
                        <Text variant="caption" style={{ color: t.colors.border }}>
                          {'  |  '}
                        </Text>
                        {tr('unit')} {d.nextCheque.unitNo}
                      </Text>
                      <DateText date={d.nextCheque.dueDate} variant="caption" color="soft" />
                    </Row>
                  </View>
                </Card>
              </Pressable>
            </Link>
          ) : (
            <EmptyState title={tr('home_next_empty')} />
          )}

          {/* Occupancy */}
          {!d ? (
            <Skeleton height={180} radius={24} />
          ) : (
            <Card style={{ padding: 16 }}>
              <Text tnum>
                <Text weight="medium" tnum>
                  {d.occupancy.occupied}
                </Text>
                <Text variant="secondary">{` ${tr('home_of')} `}</Text>
                <Text weight="medium" tnum>
                  {d.occupancy.total}
                </Text>
                <Text variant="secondary">{` ${tr('home_unitsRented')}`}</Text>
              </Text>
              <View style={{ paddingTop: 13 }}>
                <ProgressBar pct={d.occupancy.pct} />
              </View>
              {d.vacantUnits.length > 0 ? (
                <View style={{ marginTop: 20 }}>
                  <Separator />
                  <Text variant="caption" weight="medium" style={{ marginTop: 8 }}>
                    {tr('home_vacant')}
                  </Text>
                  {d.vacantUnits.map((u) => (
                    <Link
                      key={u.unitId}
                      href={{ pathname: '/unit/[id]', params: { id: u.unitId } }}
                      asChild
                    >
                      <Pressable
                        accessibilityRole="button"
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'flex-end',
                          paddingVertical: 8,
                          minHeight: 44,
                        }}
                      >
                        <View style={{ gap: 5 }}>
                          <Text weight="medium">{pick(u.buildingNameAr, u.buildingNameEn)}</Text>
                          <Text variant="caption" tnum>
                            {tr('unit')} {u.unitNo}
                          </Text>
                        </View>
                        {u.vacantSince ? (
                          <Text variant="caption" color="soft" tnum>
                            {tr('unit_vacantSince', { date: '' })}
                            <DateText date={u.vacantSince} variant="caption" />
                          </Text>
                        ) : (
                          <Chip label={tr('unit_neverRented')} />
                        )}
                      </Pressable>
                    </Link>
                  ))}
                </View>
              ) : null}
            </Card>
          )}

          {/* Disputes */}
          {d ? (
            <Link href="/(tabs)/disputes" asChild>
              <Pressable accessibilityRole="button">
                <Card
                  style={{
                    padding: 16,
                    borderRadius: t.radius.md,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Row style={{ gap: 8 }}>
                    <Icon name="scale" color={t.colors.ink} />
                    <Text variant="secondary" weight="medium">
                      {d.openDisputes === 0
                        ? tr('home_disputes_none')
                        : d.openDisputes === 1
                          ? tr('home_disputes_one')
                          : tr('home_disputes', { n: d.openDisputes })}
                    </Text>
                  </Row>
                  <Icon name="chevronRow" color={t.colors.ink} flip={isRTL} />
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
