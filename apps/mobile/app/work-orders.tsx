import { FlashList } from '@shopify/flash-list';
import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';
import { WORK_ORDER_STATUS_LABEL } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useWorkOrders } from '@/lib/queries';
import type { WorkOrderItem } from '@/lib/types';
import { Card, Chip, DateText, EmptyState, ErrorState, Row, Skeleton, Text } from '@/ui';
import { PendingApprovalsBanner } from '@/ui/approval-link';

/** Maintenance jobs on the owner's units, newest first: what is broken, what was done, what it cost. */
export default function WorkOrdersScreen() {
  const { t: tr, pick, lang } = useI18n();
  const q = useWorkOrders();
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
        <PendingApprovalsBanner />
        <EmptyState title={tr('workOrders_empty')} />
      </View>
    );
  }
  return (
    <FlashList<WorkOrderItem>
      data={rows}
      keyExtractor={(w) => w.id}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      // Large jobs waiting for this owner's answer come first.
      ListHeaderComponent={<PendingApprovalsBanner />}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
      }}
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      renderItem={({ item: w }) => (
        <Link href={{ pathname: '/work-order/[id]', params: { id: w.id } }} asChild>
          <Pressable accessibilityRole="button" style={{ marginTop: 12 }}>
            <Card style={{ padding: 16, gap: 6 }}>
              <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                <Text weight="semibold" numberOfLines={2} style={{ flex: 1 }}>
                  {pick(w.titleAr, w.titleEn)}
                </Text>
                <Chip label={WORK_ORDER_STATUS_LABEL[w.status][lang]} />
              </Row>
              <Text variant="secondary" color="soft">
                {pick(w.buildingNameAr, w.buildingNameEn)}
                {w.unitNo ? ` ${w.unitNo}` : ''}
                {w.priority === 'urgent' ? ` · ${tr('workOrder_priority_urgent')}` : ''}
              </Text>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="caption" color="faint" tnum>
                  {tr(
                    w.completedAt
                      ? 'workOrder_completed'
                      : w.scheduledFor
                        ? 'workOrder_scheduled'
                        : 'workOrder_reported',
                  )}{' '}
                  <DateText
                    date={
                      w.completedAt ? w.completedAt.slice(0, 10) : (w.scheduledFor ?? w.reportedOn)
                    }
                    variant="caption"
                    color="faint"
                  />
                </Text>
                {w.photoCount > 0 ? (
                  <Text variant="caption" color="faint" tnum>
                    {tr('workOrder_photos')} {w.photoCount}
                  </Text>
                ) : null}
              </Row>
            </Card>
          </Pressable>
        </Link>
      )}
    />
  );
}
