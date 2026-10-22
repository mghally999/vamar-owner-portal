import { FlashList } from '@shopify/flash-list';
import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';
import { DISPUTE_STATUS_LABEL, DISPUTE_TYPE_LABEL } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useDisputes } from '@/lib/queries';
import type { DisputeItem } from '@/lib/types';
import { Card, DateText, EmptyState, ErrorState, Money, Row, Skeleton, Text } from '@/ui';

/** Disputes tab: newest first, loaded page by page as the owner scrolls. */
export default function DisputesScreen() {
  const { t: tr, pick, lang } = useI18n();
  const q = useDisputes();
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  if (q.isPending) {
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <Skeleton height={96} radius={12} />
        <Skeleton height={96} radius={12} />
      </View>
    );
  }
  if (q.isError) {
    return (
      <View style={{ padding: 16 }}>
        <ErrorState onRetry={() => void q.refetch()} />
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View style={{ padding: 16 }}>
        <EmptyState title={tr('disputes_empty')} />
      </View>
    );
  }

  return (
    <FlashList<DisputeItem>
      data={rows}
      keyExtractor={(d) => d.id}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
      }}
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      renderItem={({ item: d }) => (
        <Link href={{ pathname: '/dispute/[id]', params: { id: d.id } }} asChild>
          <Pressable accessibilityRole="button" style={{ marginTop: 12 }}>
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
      )}
    />
  );
}
