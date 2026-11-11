import { Link, useGlobalSearchParams, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { formatPeriod } from '@vamar/shared';
import { sameSelection, selectionFromLink, usePeriod } from '@/lib/period';
import { useMe, useSummary } from '@/lib/queries';
import { shareStatementForPeriod } from '@/lib/statement-period';
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
import { BarChart } from '@/ui/bar-chart';
import { Icon } from '@/ui/icon';
import { PeriodSwitcher } from '@/ui/period-switcher';
import { UpdateBanner } from '@/screens/update';
import { useUpdateState } from '@/lib/version';

interface Href {
  pathname: string;
  params: Record<string, string>;
}

/**
 * Owner home (Figma "Vamar" Page 2, Home frame 25:171): the period switcher, the period's money
 * card (expected rent, then collected / outstanding / at risk tiles, then expenses and net), a
 * small rent-versus-expenses chart, the next cheque, contracts ending soon, open maintenance,
 * the calendar row, occupancy and open disputes. Every number opens the list behind it.
 */
export default function HomeScreen() {
  const t = useTheme();
  const { t: tr, pick, isRTL, lang, num } = useI18n();
  const auth = useAuth();
  const { selection, setSelection, query, period } = usePeriod();
  // A push notification (the monthly summary) or a link can open Home on a period: the route's
  // own params, or the address's when the router keeps them at the top level. The web app's
  // launch link is applied before the first render by the period provider. The params are those
  // push-routes.ts puts on Home: a preset, or the dates of the month a summary is about.
  const local = useLocalSearchParams<{
    preset?: string;
    from?: string;
    to?: string;
    statement?: string;
  }>();
  const global = useGlobalSearchParams<{
    preset?: string;
    from?: string;
    to?: string;
    statement?: string;
  }>();
  const linked = useMemo(
    () =>
      selectionFromLink({ preset: local.preset, from: local.from, to: local.to }) ??
      selectionFromLink({ preset: global.preset, from: global.from, to: global.to }),
    [local.preset, local.from, local.to, global.preset, global.from, global.to],
  );
  useEffect(() => {
    if (linked) setSelection(linked);
  }, [linked, setSelection]);
  // The monthly summary push asks for its statement: offered at the top while Home still shows
  // that period, so the owner does not have to look for it at the bottom.
  const statementLink =
    linked !== null &&
    (local.statement ?? global.statement) === '1' &&
    sameSelection(selection, linked);
  const me = useMe();
  const settings = me.data?.settings;
  const q = useSummary(query);
  const update = useUpdateState();
  const d = q.data;
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const makeStatement = () => {
    if (!d) return;
    setSharing(true);
    setShareError(false);
    const ownerName = auth.owner ? pick(auth.owner.nameAr, auth.owner.nameEn) : '';
    void shareStatementForPeriod({
      ownerName,
      lang,
      period,
      query,
      summary: d,
      beforeFeeLabel: settings?.showBeforeFeeLabel !== false,
    })
      .catch(() => {
        setShareError(true);
      })
      .finally(() => {
        setSharing(false);
      });
  };
  const projected = d?.isFuture === true;
  const netLabel = tr(projected ? 'home_projectedNet' : 'home_net');
  const nothing = d
    ? d.rent.expectedFils === 0 && d.expenses.totalFils === 0 && d.expenses.projectedFixedFils === 0
    : false;

  const tile = (
    label: string,
    fils: number | undefined,
    href: Href,
    wide = false,
    extra?: React.ReactNode,
  ) => (
    <Link key={label} href={href} asChild>
      <Pressable
        accessibilityRole="button"
        style={{
          flex: wide ? 2 : 1,
          minWidth: wide ? '60%' : '30%',
          backgroundColor: t.colors.heroTile,
          borderRadius: t.radius.sm,
          padding: 12,
          gap: 4,
        }}
      >
        {/* Labels wrap rather than cut; a long amount steps down a size so it stays whole. */}
        <Text variant="caption" color="onHeroSoft">
          {label}
        </Text>
        {d ? (
          <Amount
            fils={fils ?? 0}
            size={num(fils ?? 0).length > 7 ? 'secondary' : 'body'}
            weight="medium"
            color="onHero"
          />
        ) : (
          <Skeleton width={60} height={20} />
        )}
        {d ? extra : null}
      </Pressable>
    </Link>
  );

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
      <PeriodSwitcher
        value={selection}
        onChange={setSelection}
        weekStart={settings?.weekStart}
        yearStatement
      />

      {statementLink && d && !q.isError ? (
        <Card
          testID="statement-link"
          style={{ padding: 16, gap: 10, borderColor: t.colors.primary }}
        >
          <Text variant="secondary">{tr('home_statementFor_body')}</Text>
          <Button
            title={tr('home_statementFor', { period: formatPeriod(period, lang) })}
            loading={sharing}
            onPress={makeStatement}
          />
          {shareError ? (
            <Text variant="caption" color="danger">
              {tr('error_generic')}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <>
          {/* The period's money */}
          <View
            style={{
              backgroundColor: t.colors.hero,
              borderColor: t.colors.heroBorder,
              borderWidth: 0.8,
              borderRadius: t.radius.lg,
              padding: 16,
            }}
          >
            <Link href={{ pathname: '/(tabs)/cheques', params: {} }} asChild>
              <Pressable accessibilityRole="button">
                <Text variant="secondary" weight="medium" color="onHeroSoft">
                  {tr('home_expectedRent')}
                </Text>
                <View style={{ paddingVertical: 12 }}>
                  {d ? (
                    <Amount fils={d.rent.expectedFils} size="hero" color="onHero" />
                  ) : (
                    <Skeleton width={200} height={46} />
                  )}
                </View>
              </Pressable>
            </Link>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {tile(tr('home_collected'), d?.rent.collectedFils, {
                pathname: '/(tabs)/cheques',
                params: { status: 'cleared' },
              })}
              {tile(tr('home_outstanding'), d?.rent.outstandingFils, {
                pathname: '/(tabs)/cheques',
                params: { status: 'upcoming' },
              })}
              {tile(tr('home_atRisk'), d?.rent.atRiskFils, {
                pathname: '/(tabs)/cheques',
                params: { status: 'bounced' },
              })}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {tile(
                tr('home_expenses'),
                d?.expenses.totalFils,
                { pathname: '/(tabs)/expenses', params: {} },
                true,
                d ? (
                  <>
                    <Text variant="caption" color="onHeroSoft" tnum>
                      {tr('home_fixed')} {num(d.expenses.fixedFils)} · {tr('home_variable')}{' '}
                      {num(d.expenses.variableFils)}
                    </Text>
                    {d.expenses.projectedFixedFils > 0 ? (
                      <Text variant="caption" color="onHeroSoft" tnum>
                        {tr('home_projected')}: {num(d.expenses.projectedFixedFils)}
                      </Text>
                    ) : null}
                  </>
                ) : null,
              )}
              {tile(netLabel, d ? (projected ? d.projectedNetFils : d.netFils) : undefined, {
                pathname: '/(tabs)/expenses',
                params: {},
              })}
            </View>
            {settings?.showBeforeFeeLabel !== false ? (
              <Text
                variant="caption"
                color="onHeroSoft"
                style={{ paddingTop: 10, paddingHorizontal: 4 }}
              >
                {netLabel}: {tr('home_beforeFee')}
              </Text>
            ) : null}
          </View>

          {nothing ? (
            <EmptyState title={tr('home_empty_period_title')} body={tr('home_empty_period_body')} />
          ) : null}

          {/* Rent vs expenses by month */}
          {d && d.buckets.length > 1 ? (
            <Card style={{ padding: 16, gap: 10 }}>
              <Text variant="secondary" weight="medium">
                {tr('home_chart')}
              </Text>
              <BarChart
                points={d.buckets.map((b) => ({
                  key: b.key,
                  rentFils: b.expectedFils,
                  expensesFils: b.fixedFils + b.variableFils + b.projectedFixedFils,
                }))}
              />
            </Card>
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

          {/* Contracts ending soon */}
          {d ? (
            <Card style={{ padding: 16, gap: 8 }}>
              <Text weight="medium">{tr('home_endingSoon')}</Text>
              {d.contractsEnding.length === 0 ? (
                <Text variant="secondary" color="soft">
                  {tr('home_endingSoon_empty')}
                </Text>
              ) : (
                d.contractsEnding.map((c) => (
                  <Link
                    key={c.id}
                    href={{ pathname: '/unit/[id]', params: { id: c.unitId } }}
                    asChild
                  >
                    <Pressable
                      accessibilityRole="button"
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        minHeight: 44,
                        gap: 8,
                      }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="secondary" weight="medium" numberOfLines={1}>
                          {pick(c.buildingNameAr, c.buildingNameEn)} {c.unitNo}
                        </Text>
                        <Text variant="caption" color="soft" numberOfLines={1}>
                          {c.tenantName}
                        </Text>
                      </View>
                      <DateText date={c.endDate} variant="caption" />
                    </Pressable>
                  </Link>
                ))
              )}
            </Card>
          ) : null}

          {/* Open maintenance and the calendar */}
          {d ? (
            <Row style={{ gap: 12, alignItems: 'stretch' }}>
              <Link href="/work-orders" asChild>
                <Pressable accessibilityRole="button" style={{ flex: 1 }}>
                  <Card
                    style={{ padding: 14, minHeight: 92, justifyContent: 'space-between', flex: 1 }}
                  >
                    <Text variant="secondary" weight="medium">
                      {d.openWorkOrders === 0
                        ? tr('home_workOrders_none')
                        : d.openWorkOrders === 1
                          ? tr('home_workOrders_one')
                          : tr('home_workOrders', { n: d.openWorkOrders })}
                    </Text>
                    <Icon name="chevronRow" color={t.colors.ink} flip={!isRTL} />
                  </Card>
                </Pressable>
              </Link>
              <Link href="/calendar" asChild>
                <Pressable accessibilityRole="button" style={{ flex: 1 }}>
                  <Card
                    style={{ padding: 14, minHeight: 92, justifyContent: 'space-between', flex: 1 }}
                  >
                    <Row style={{ gap: 8 }}>
                      <Icon name="calendar" color={t.colors.ink} />
                      <Text variant="secondary" weight="medium">
                        {tr('home_calendar')}
                      </Text>
                    </Row>
                    <Icon name="chevronRow" color={t.colors.ink} flip={!isRTL} />
                  </Card>
                </Pressable>
              </Link>
            </Row>
          ) : null}

          {/* Occupancy */}
          {!d ? (
            <Skeleton height={120} radius={24} />
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
                  <Icon name="chevronRow" color={t.colors.ink} flip={!isRTL} />
                </Card>
              </Pressable>
            </Link>
          ) : null}

          {d ? (
            <View style={{ gap: 6 }}>
              <Button
                title={tr('home_statement')}
                variant="secondary"
                loading={sharing}
                onPress={makeStatement}
              />
              {shareError ? (
                <Text variant="caption" color="danger">
                  {tr('error_generic')}
                </Text>
              ) : null}
            </View>
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
