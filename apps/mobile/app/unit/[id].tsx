import { Link, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  CONTRACT_STATUS_LABEL,
  sharePct,
  UNIT_STATUS_LABEL,
  type TimelineKind,
  type UnitStatus,
} from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useUnit, useUnitTimeline } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import type { TimelineEntry } from '@/lib/types';
import {
  Button,
  Card,
  Chip,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  Row,
  SectionTitle,
  Separator,
  Skeleton,
  StatusChip,
  Text,
  layout,
} from '@/ui';
import { AskVamar } from '@/ui/ask-vamar';

/** An unknown status (an older API) is shown as it came. */
const contractLabels = CONTRACT_STATUS_LABEL as Partial<
  Record<string, Record<'ar' | 'en', string>>
>;

const KIND_FILTERS: (TimelineKind | 'all')[] = [
  'all',
  'status',
  'contract',
  'tenant',
  'cheque',
  'expense',
  'work_order',
  'dispute',
  'ownership',
];

/** Unit screen: status badge, property record, cheques, contracts and the history timeline. */
export default function UnitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { t: tr, pick, date, lang } = useI18n();
  const q = useUnit(id);
  const u = q.data;
  const [kind, setKind] = useState<TimelineKind | 'all'>('all');
  const timeline = useUnitTimeline(id, kind === 'all' ? undefined : [kind]);
  const entries = useMemo(
    () => timeline.data?.pages.flatMap((p) => p.items) ?? [],
    [timeline.data],
  );
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  const status: UnitStatus | null = u
    ? u.occupied
      ? 'occupied'
      : (u.status ?? 'vacant_ready')
    : null;
  const identifiers: [string, string | null | undefined][] = u
    ? [
        [tr('unit_titleDeed'), u.titleDeedNo],
        [tr('unit_plot'), u.plotNo],
        [tr('unit_makani'), u.makaniNo],
        [tr('unit_dewa'), u.dewaPremiseNo],
        [tr('unit_municipality'), u.municipalityNo],
        [tr('unit_handover'), u.handoverDate ? date(u.handoverDate) : null],
      ]
    : [];
  const hasIdentifiers = identifiers.some(([, v]) => v);

  return (
    <ScrollView contentContainerStyle={layout.screen}>
      <View style={{ gap: 6, paddingVertical: 8 }}>
        {u ? (
          <>
            <Row style={{ justifyContent: 'space-between', gap: 8 }}>
              <Text variant="title" weight="semibold" tnum style={{ flexShrink: 1 }}>
                {pick(u.buildingNameAr, u.buildingNameEn)} {u.unitNo}
              </Text>
              {status ? <Chip label={UNIT_STATUS_LABEL[status][lang]} /> : null}
            </Row>
            <Text variant="secondary" color="soft">
              {u.occupied
                ? `${tr('unit_rented')} · ${u.tenantName ?? ''}`
                : u.vacantSince
                  ? tr('unit_vacantSince', { date: date(u.vacantSince) })
                  : tr('unit_neverRented')}
              {u.shareBp < 10_000 ? ` · ${tr('unit_share', { pct: sharePct(u.shareBp) })}` : ''}
            </Text>
            {u.occupied ? (
              <Row style={{ gap: 12, marginTop: 8 }}>
                <View>
                  <Text variant="caption" color="soft">
                    {tr('unit_annualRent')}
                  </Text>
                  <Money fils={u.annualRentFils} variant="heading" weight="semibold" />
                </View>
                <View>
                  <Text variant="caption" color="soft">
                    {tr('unit_endsOn', { date: '' })}
                  </Text>
                  <DateText date={u.contractEndDate} variant="heading" color="ink" />
                </View>
              </Row>
            ) : null}
          </>
        ) : (
          <>
            <Skeleton width={240} height={28} />
            <Skeleton width={180} height={16} />
          </>
        )}
      </View>

      {u && hasIdentifiers ? (
        <View>
          <SectionTitle>{tr('unit_identifiers')}</SectionTitle>
          <Card style={{ paddingHorizontal: 16 }}>
            {identifiers
              .filter(([, v]) => v)
              .map(([label, value], i) => (
                <View key={label}>
                  {i > 0 ? <Separator /> : null}
                  <Row style={{ justifyContent: 'space-between', minHeight: 44, gap: 12 }}>
                    <Text variant="secondary" color="soft">
                      {label}
                    </Text>
                    <Text variant="secondary" weight="medium" tnum selectable>
                      {value}
                    </Text>
                  </Row>
                </View>
              ))}
          </Card>
        </View>
      ) : null}

      <View>
        <SectionTitle>{tr('unit_cheques')}</SectionTitle>
        {!u ? (
          <Skeleton height={160} radius={12} />
        ) : u.cheques.length === 0 ? (
          <EmptyState title={tr('cheques_empty')} />
        ) : (
          <Card style={{ paddingHorizontal: 16 }}>
            {u.cheques.map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <Separator /> : null}
                <Link href={{ pathname: '/cheque/[id]', params: { id: c.id } }} asChild>
                  <Pressable
                    accessibilityRole="button"
                    style={{ minHeight: 56, justifyContent: 'center', gap: 2 }}
                  >
                    <Row style={{ justifyContent: 'space-between' }}>
                      <DateText date={c.dueDate} color="ink" />
                      <Money fils={c.amountFils} variant="secondary" />
                    </Row>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text variant="caption" color="faint" tnum>
                        {c.chequeNo ?? '—'} · {c.bankName ?? ''}
                      </Text>
                      <StatusChip status={c.status} />
                    </Row>
                  </Pressable>
                </Link>
              </View>
            ))}
          </Card>
        )}
      </View>

      <View>
        <SectionTitle>{tr('unit_contracts')}</SectionTitle>
        {!u ? (
          <Skeleton height={80} radius={12} />
        ) : (
          <Card style={{ paddingHorizontal: 16 }}>
            {u.contracts.map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <Separator /> : null}
                <View style={{ minHeight: 56, justifyContent: 'center', gap: 2 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text weight="medium">{c.tenantName}</Text>
                    <Money fils={c.annualRentFils} variant="secondary" />
                  </Row>
                  <Text variant="caption" color="soft" tnum>
                    {date(c.startDate)} – {date(c.endDate)} ·{' '}
                    {contractLabels[c.status]?.[lang] ?? c.status}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </View>

      <View>
        <SectionTitle>{tr('unit_history')}</SectionTitle>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingBottom: 10 }}
        >
          {KIND_FILTERS.map((k) => {
            const active = kind === k;
            return (
              <Pressable
                key={k}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setKind(k);
                }}
                style={{
                  height: 32,
                  paddingHorizontal: 12,
                  borderRadius: 16,
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
                  {tr(`tl_${k}` as MessageKey)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {timeline.isPending ? (
          <Skeleton height={140} radius={12} />
        ) : timeline.isError ? (
          <ErrorState onRetry={() => void timeline.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState title={tr('unit_history_empty')} />
        ) : (
          <Card style={{ padding: 16, gap: 12 }}>
            {entries.map((e, i) => (
              <TimelineRow key={e.id} entry={e} last={i === entries.length - 1} />
            ))}
            {timeline.hasNextPage ? (
              <Button
                title={tr('timeline_loadMore')}
                variant="secondary"
                loading={timeline.isFetchingNextPage}
                onPress={() => void timeline.fetchNextPage()}
              />
            ) : null}
          </Card>
        )}
      </View>
      <AskVamar
        type="unit"
        id={id}
        label={u ? `${pick(u.buildingNameAr, u.buildingNameEn)} ${u.unitNo}` : null}
      />
    </ScrollView>
  );
}

/** Where a timeline entry opens: the cheque, the expense, the job or the case. */
function hrefOf(e: TimelineEntry): { pathname: string; params: { id: string } } | null {
  switch (e.entityType) {
    case 'cheque':
      return { pathname: '/cheque/[id]', params: { id: e.entityId } };
    case 'expense':
      return { pathname: '/expense/[id]', params: { id: e.entityId } };
    case 'work_order':
      return { pathname: '/work-order/[id]', params: { id: e.entityId } };
    case 'dispute':
      return { pathname: '/dispute/[id]', params: { id: e.entityId } };
    default:
      return null;
  }
}

/** The title keys the API sends (status, cheque_cleared, expense_fixed...) become sentences here. */
export function timelineTitle(
  e: TimelineEntry,
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string,
  lang: 'ar' | 'en',
): string {
  if (e.kind === 'status') {
    const labels = UNIT_STATUS_LABEL as Partial<Record<string, Record<'ar' | 'en', string>>>;
    return tr('tl_status_changed', { status: labels[e.titleEn]?.[lang] ?? e.titleEn });
  }
  const key = e.titleAr;
  const name = e.titleEn;
  const known: Partial<Record<string, MessageKey>> = {
    contract_start: 'tl_contract_start',
    contract_end: 'tl_contract_end',
    contract_terminated: 'tl_contract_terminated',
    contract_renewed: 'tl_contract_renewed',
    tenant_moved_in: 'tl_tenant_moved_in',
    cheque_due: 'tl_cheque_due',
    cheque_deposited: 'tl_cheque_deposited',
    cheque_cleared: 'tl_cheque_cleared',
    cheque_bounced: 'tl_cheque_bounced',
    cheque_replaced: 'tl_cheque_replaced',
    cheque_cancelled: 'tl_cheque_cancelled',
    expense_fixed: 'tl_expense_fixed',
    expense_variable: 'tl_expense_variable',
    work_order_open: 'tl_work_order_open',
    work_order_scheduled: 'tl_work_order_scheduled',
    work_order_in_progress: 'tl_work_order_in_progress',
    work_order_done: 'tl_work_order_done',
    work_order_cancelled: 'tl_work_order_cancelled',
    work_order_completed: 'tl_work_order_completed',
    dispute_opened: 'tl_dispute_opened',
    dispute_update: 'tl_dispute_update',
    dispute_closed: 'tl_dispute_closed',
    ownership_from: 'tl_ownership_from',
  };
  const k = known[key];
  if (!k) return lang === 'ar' ? e.titleAr : e.titleEn;
  if (e.kind === 'expense') return `${tr(k)} · ${lang === 'ar' ? e.detailAr : e.titleEn}`;
  if (e.kind === 'work_order') return `${tr(k)} · ${lang === 'ar' ? e.detailAr : e.titleEn}`;
  if (e.kind === 'ownership') return tr(k, { name: lang === 'ar' ? e.detailAr : name });
  return tr(k, { name });
}

function TimelineRow({ entry, last }: { entry: TimelineEntry; last: boolean }) {
  const t = useTheme();
  const { t: tr, lang, date } = useI18n();
  const href = hrefOf(entry);
  const detail =
    entry.kind === 'cheque' ||
    entry.kind === 'expense' ||
    entry.kind === 'work_order' ||
    entry.kind === 'ownership'
      ? entry.kind === 'ownership'
        ? `${Number(entry.detailEn) / 100}%`
        : entry.kind === 'expense'
          ? entry.detailEn
          : entry.kind === 'work_order'
            ? entry.detailEn
            : entry.detailAr
      : entry.detailAr;
  const body = (
    <Row style={{ gap: 12, alignItems: 'flex-start' }}>
      <View style={{ alignItems: 'center', width: 12, alignSelf: 'stretch' }}>
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: t.colors.primary,
            marginTop: 6,
          }}
        />
        {!last ? (
          <View
            style={{
              width: 1,
              flex: 1,
              minHeight: 20,
              backgroundColor: t.colors.border,
              marginTop: 4,
            }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2, paddingBottom: 4 }}>
        <Row style={{ justifyContent: 'space-between', gap: 8 }}>
          <Text variant="secondary" weight="medium" numberOfLines={2} style={{ flex: 1 }}>
            {timelineTitle(entry, tr, lang)}
          </Text>
          {entry.amountFils !== null ? <Money fils={entry.amountFils} variant="caption" /> : null}
        </Row>
        {detail ? (
          <Text variant="caption" color="soft" numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
        <Text variant="caption" color="faint" tnum>
          {date(entry.date)}
        </Text>
      </View>
    </Row>
  );
  if (!href) return body;
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button">{body}</Pressable>
    </Link>
  );
}
