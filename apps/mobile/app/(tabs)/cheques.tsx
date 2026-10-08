import { FlashList } from '@shopify/flash-list';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { CHEQUE_STATUSES, todayInDubai, type ChequeStatus, type PlainDate } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useBuildings, useCheques } from '@/lib/queries';
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
import { MonthSwitcher } from '@/ui/month-switcher';

type Section = { kind: 'header'; date: string } | { kind: 'cheque'; cheque: ChequeItem };

/** Cheques tab: month switcher, property + status filters, grouped by due date. */
export default function ChequesScreen() {
  const t = useTheme();
  const { t: tr, pick, date } = useI18n();
  const [monthStart, setMonthStart] = useState<PlainDate | null>(
    `${todayInDubai().slice(0, 7)}-01` as PlainDate,
  );
  const [buildingId, setBuildingId] = useState<string | undefined>();
  const [status, setStatus] = useState<ChequeStatus | undefined>();
  const buildings = useBuildings();
  const q = useCheques({ month: monthStart?.slice(0, 7), buildingId, status });

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

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <MonthSwitcher
          value={monthStart ?? (`${todayInDubai().slice(0, 7)}-01` as PlainDate)}
          onChange={(m) => {
            setMonthStart(m);
          }}
        />
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
      </View>

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
                          {tr('cheque_yourShare', { pct: item.cheque.shareBp / 100 })}
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
