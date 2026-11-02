import { FlashList } from '@shopify/flash-list';
import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  CHEQUE_STATUSES,
  isChequeStatus,
  todayInDubai,
  type ChequeStatus,
  type PlainDate,
  sharePct,
} from '@vamar/shared';
import { groupByDay } from '@/lib/calendar';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { usePeriod } from '@/lib/period';
import { useBuildings, useCalendar, useCheques, useMe } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import type { ChequeItem } from '@/lib/types';
import {
  Card,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  Row,
  Skeleton,
  StatusChip,
  Text,
} from '@/ui';
import { Agenda, Legend, MonthGrid } from '@/ui/calendar';
import { PeriodSwitcher } from '@/ui/period-switcher';
import { Segmented } from '@/ui/segmented';

type Section = { kind: 'header'; date: string } | { kind: 'cheque'; cheque: ChequeItem };

/**
 * Cheques tab: the shared period switcher, property and status filters, a List | Calendar toggle.
 * Home's tiles open it with a status (`?status=cleared`), which seeds the status filter.
 */
export default function ChequesScreen() {
  const t = useTheme();
  const { t: tr, pick, date } = useI18n();
  const params = useLocalSearchParams<{ status?: string }>();
  const { selection, setSelection, period } = usePeriod();
  const settings = useMe().data?.settings;
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [buildingId, setBuildingId] = useState<string | undefined>();
  const [status, setStatus] = useState<ChequeStatus | undefined>(
    isChequeStatus(params.status) ? params.status : undefined,
  );
  useEffect(() => {
    if (isChequeStatus(params.status)) setStatus(params.status);
  }, [params.status]);
  const buildings = useBuildings();
  const q = useCheques({ from: period.from, to: period.to, buildingId, status });
  const cal = useCalendar(period.from, period.to, ['cheque_due', 'holiday']);
  const [selectedDay, setSelectedDay] = useState<PlainDate | null>(null);

  const rows = useMemo<Section[]>(() => {
    const items = q.data?.pages.flatMap((p) => p.items) ?? [];
    const out: Section[] = [];
    let last = '';
    for (const c of items) {
      if (c.dueDate !== last) {
        out.push({ kind: 'header', date: c.dueDate });
        last = c.dueDate;
      }
      out.push({ kind: 'cheque', cheque: c });
    }
    return out;
  }, [q.data]);

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        justifyContent: 'center',
        backgroundColor: active ? t.colors.primary : t.colors.bgElevated,
        borderWidth: 1,
        borderColor: active ? t.colors.primary : t.colors.border,
      }}
    >
      <Text
        variant="caption"
        weight="medium"
        style={{ color: active ? t.colors.onPrimary : t.colors.ink }}
      >
        {label}
      </Text>
    </Pressable>
  );

  const header = (
    <View style={{ paddingHorizontal: 16, gap: 8 }}>
      <PeriodSwitcher value={selection} onChange={setSelection} weekStart={settings?.weekStart} />
      <Segmented
        options={[
          { value: 'list', label: tr('cheques_view_list') },
          { value: 'calendar', label: tr('cheques_view_calendar') },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'list' ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          >
            {chip(tr('cheques_filter_all'), buildingId === undefined, () => {
              setBuildingId(undefined);
            })}
            {buildings.data?.map((b) =>
              chip(pick(b.nameAr, b.nameEn), buildingId === b.id, () => {
                setBuildingId(b.id);
              }),
            )}
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          >
            {chip(tr('cheques_filter_status'), status === undefined, () => {
              setStatus(undefined);
            })}
            {CHEQUE_STATUSES.map((s) =>
              chip(tr(`status_${s}` as MessageKey), status === s, () => {
                setStatus(s);
              }),
            )}
          </ScrollView>
        </>
      ) : null}
    </View>
  );

  if (view === 'calendar') {
    const items = cal.data?.items ?? [];
    const byDay = groupByDay(items.filter((i) => i.kind === 'cheque_due'));
    const holidays = new Set(cal.data?.holidays ?? []);
    const months = monthsOf(period.from, period.to);
    const today = todayInDubai();
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 32, gap: 12 }}>
        {header}
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {cal.isError ? <ErrorState onRetry={() => void cal.refetch()} /> : null}
          {cal.isPending ? <Skeleton height={260} radius={24} /> : null}
          {months.map(([y, m]) => (
            <Card key={`${y}-${m}`} style={{ padding: 12, gap: 6 }}>
              <Text variant="secondary" weight="medium" tnum>
                {date(`${y}-${String(m).padStart(2, '0')}-01`).replace(/^1 /, '')}
              </Text>
              <MonthGrid
                year={y}
                month={m}
                weekStart={settings?.weekStart ?? 'monday'}
                today={today}
                selected={selectedDay}
                byDay={byDay}
                holidays={holidays}
                onSelect={setSelectedDay}
              />
            </Card>
          ))}
          <Legend kinds={['cheque_due', 'holiday']} />
          {selectedDay ? (
            <Agenda
              items={items}
              from={selectedDay}
              to={selectedDay}
              emptyText={tr('calendar_dayEmpty')}
            />
          ) : null}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {header}
      {q.isPending ? (
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton width={120} height={14} />
          <Skeleton height={76} radius={12} />
          <Skeleton height={76} radius={12} />
          <Skeleton height={76} radius={12} />
        </View>
      ) : q.isError ? (
        <View style={{ padding: 16 }}>
          <ErrorState onRetry={() => void q.refetch()} />
        </View>
      ) : rows.length === 0 ? (
        <View style={{ padding: 16 }}>
          <EmptyState title={tr('cheques_empty')} />
        </View>
      ) : (
        <FlashList<Section>
          data={rows}
          keyExtractor={(item) => (item.kind === 'header' ? `h-${item.date}` : item.cheque.id)}
          getItemType={(item) => item.kind}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
          }}
          onRefresh={() => void q.refetch()}
          refreshing={q.isRefetching}
          renderItem={({ item }) =>
            item.kind === 'header' ? (
              <Text
                variant="caption"
                weight="medium"
                color="soft"
                tnum
                style={{ marginTop: 16, marginBottom: 6 }}
              >
                {date(item.date)}
              </Text>
            ) : (
              <Link href={{ pathname: '/cheque/[id]', params: { id: item.cheque.id } }} asChild>
                <Pressable accessibilityRole="button" style={{ marginBottom: 8 }}>
                  <Card style={{ padding: 14, gap: 6 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Money fils={item.cheque.amountFils} variant="heading" weight="semibold" />
                      <StatusChip status={item.cheque.status} />
                    </Row>
                    <Text variant="secondary" color="soft">
                      {pick(item.cheque.buildingNameAr, item.cheque.buildingNameEn)}{' '}
                      {item.cheque.unitNo} · {item.cheque.tenantName}
                    </Text>
                    <Row style={{ gap: 10 }}>
                      <Text variant="caption" color="faint" tnum>
                        {tr('cheque_no')} {item.cheque.chequeNo ?? '—'}
                      </Text>
                      {item.cheque.shared ? (
                        <Text variant="caption" color="faint" tnum>
                          {tr('cheque_yourShare', { pct: sharePct(item.cheque.shareBp) })}
                        </Text>
                      ) : null}
                    </Row>
                  </Card>
                </Pressable>
              </Link>
            )
          }
        />
      )}
      <DateText date={null} style={{ display: 'none' }} />
    </View>
  );
}

/** The [year, month] pairs a period touches, at most twelve (the calendar view shows a year at most). */
function monthsOf(from: string, to: string): [number, number][] {
  const out: [number, number][] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while ((y < ty || (y === ty && m <= tm)) && out.length < 12) {
    out.push([y, m]);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
