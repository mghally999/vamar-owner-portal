import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useUnit } from '@/lib/queries';
import {
  Card,
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

export default function UnitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t: tr, pick, date } = useI18n();
  const q = useUnit(id);
  const u = q.data;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  return (
    <ScrollView contentContainerStyle={layout.screen}>
      <View style={{ gap: 4, paddingVertical: 8 }}>
        {u ? (
          <>
            <Text variant="title" weight="semibold" tnum>
              {pick(u.buildingNameAr, u.buildingNameEn)} {u.unitNo}
            </Text>
            <Text variant="secondary" color="soft">
              {u.occupied
                ? `${tr('unit_rented')} · ${u.tenantName ?? ''}`
                : u.vacantSince
                  ? tr('unit_vacantSince', { date: date(u.vacantSince) })
                  : tr('unit_neverRented')}
              {u.shareBp < 10_000 ? ` · ${tr('unit_share', { pct: u.shareBp / 100 })}` : ''}
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
                    {tr(
                      `status_${c.status === 'active' ? 'cleared' : 'cancelled'}` as MessageKey,
                    ) && contractLabel(c.status, pick)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </View>
    </ScrollView>
  );
}

function contractLabel(status: string, pick: (ar: string, en: string) => string): string {
  const map: Record<string, [string, string]> = {
    active: ['ساري', 'Active'],
    expired: ['منتهي', 'Expired'],
    terminated: ['مُنهى', 'Terminated'],
    renewed: ['مُجدَّد', 'Renewed'],
    draft: ['مسودة', 'Draft'],
  };
  const m = map[status] ?? [status, status];
  return pick(m[0], m[1]);
}
