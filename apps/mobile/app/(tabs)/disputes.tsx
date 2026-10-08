import { Link } from 'expo-router';
import { Pressable, RefreshControl, ScrollView } from 'react-native';
import { DISPUTE_STATUS_LABEL, DISPUTE_TYPE_LABEL } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useDisputes } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { Card, DateText, EmptyState, ErrorState, Money, Row, Skeleton, Text, layout } from '@/ui';

export default function DisputesScreen() {
  const t = useTheme();
  const { t: tr, pick, lang } = useI18n();
  const q = useDisputes();
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
      {q.isPending ? (
        <>
          <Skeleton height={96} radius={12} />
          <Skeleton height={96} radius={12} />
        </>
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title={tr('disputes_empty')} />
      ) : (
        q.data.map((d) => (
          <Link key={d.id} href={{ pathname: '/dispute/[id]', params: { id: d.id } }} asChild>
            <Pressable accessibilityRole="button">
              <Card style={{ padding: 16, gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text weight="semibold">{DISPUTE_TYPE_LABEL[d.type][lang]}</Text>
                  <Text variant="caption" weight="medium" color="soft">
                    {DISPUTE_STATUS_LABEL[d.status][lang]}
                  </Text>
                </Row>
                <Text variant="secondary" color="soft">
                  {pick(d.buildingNameAr, d.buildingNameEn)} {d.unitNo}
                  {d.tenantName ? ` · ${d.tenantName}` : ''}
                </Text>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="caption" color="faint" tnum>
                    {tr('dispute_case')} {d.caseNo}
                  </Text>
                  {d.nextHearingDate ? (
                    <Text variant="caption" color="faint" tnum>
                      {tr('dispute_hearing')}{' '}
                      <DateText date={d.nextHearingDate} variant="caption" color="faint" />
                    </Text>
                  ) : null}
                </Row>
                {d.amountClaimedFils ? (
                  <Money fils={d.amountClaimedFils} variant="secondary" />
                ) : null}
              </Card>
            </Pressable>
          </Link>
        ))
      )}
    </ScrollView>
  );
}
