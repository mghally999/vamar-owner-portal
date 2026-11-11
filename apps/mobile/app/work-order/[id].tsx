import { Image } from 'expo-image';
import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { WORK_ORDER_STATUS_LABEL } from '@vamar/shared';
import { API_BASE, authHeaders } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useWorkOrder } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { WorkOrderApprovalCard } from '@/ui/approval-link';
import {
  Card,
  Chip,
  ErrorState,
  Money,
  Row,
  SectionTitle,
  Separator,
  Skeleton,
  Text,
  layout,
} from '@/ui';

/** One maintenance job: status, dates, contractor, the before and after photos and the invoice. */
export default function WorkOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { t: tr, pick, date, lang } = useI18n();
  const q = useWorkOrder(id);
  const w = q.data;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  const rows: [string, string][] = w
    ? [
        [tr('workOrder_reported'), date(w.reportedOn)],
        [tr('workOrder_scheduled'), w.scheduledFor ? date(w.scheduledFor) : '—'],
        [tr('workOrder_completed'), w.completedAt ? date(w.completedAt.slice(0, 10)) : '—'],
        [tr('workOrder_vendor'), w.vendorName ?? '—'],
        [tr('workOrder_priority'), tr(`workOrder_priorityValue_${w.priority}` as MessageKey)],
      ]
    : [];

  return (
    <ScrollView contentContainerStyle={layout.screen}>
      <View style={{ gap: 6, paddingVertical: 8 }}>
        {w ? (
          <>
            <Chip label={WORK_ORDER_STATUS_LABEL[w.status][lang]} />
            <Text variant="title" weight="semibold">
              {pick(w.titleAr, w.titleEn)}
            </Text>
            <Text variant="secondary" color="soft">
              {pick(w.buildingNameAr, w.buildingNameEn)}
              {w.unitNo ? ` ${w.unitNo}` : ''}
            </Text>
            {w.description ? <Text variant="secondary">{w.description}</Text> : null}
          </>
        ) : (
          <>
            <Skeleton width={120} height={20} />
            <Skeleton width={240} height={28} />
          </>
        )}
      </View>

      {id ? <WorkOrderApprovalCard workOrderId={id} /> : null}

      {!w ? (
        <Skeleton height={160} radius={12} />
      ) : (
        <Card style={{ paddingHorizontal: 16 }}>
          {rows.map(([label, value], i) => (
            <View key={label}>
              {i > 0 ? <Separator /> : null}
              <Row style={{ justifyContent: 'space-between', minHeight: 48, gap: 12 }}>
                <Text variant="secondary" color="soft">
                  {label}
                </Text>
                <Text variant="secondary" weight="medium" tnum style={{ flexShrink: 1 }}>
                  {value}
                </Text>
              </Row>
            </View>
          ))}
          {w.expenseId ? (
            <>
              <Separator />
              <Link href={{ pathname: '/expense/[id]', params: { id: w.expenseId } }} asChild>
                <Pressable accessibilityRole="button">
                  <Row style={{ justifyContent: 'space-between', minHeight: 48, gap: 12 }}>
                    <Text variant="secondary" color="soft">
                      {tr('workOrder_cost')}
                    </Text>
                    <Money fils={w.expenseTotalFils} variant="secondary" color="primary" />
                  </Row>
                </Pressable>
              </Link>
            </>
          ) : null}
        </Card>
      )}

      <View>
        <SectionTitle>{tr('workOrder_photos')}</SectionTitle>
        {!w ? (
          <Skeleton height={160} radius={12} />
        ) : w.attachments.length === 0 ? (
          <Card style={{ padding: 16 }}>
            <Text variant="secondary" color="soft">
              {tr('workOrder_noPhotos')}
            </Text>
          </Card>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {w.attachments.map((a) => (
              <View key={a.id} style={{ width: '48%', flexGrow: 1, gap: 4 }}>
                <Image
                  source={{
                    uri: `${API_BASE}/api/owner/attachments/${a.id}`,
                    headers: authHeaders(),
                  }}
                  cachePolicy="memory-disk"
                  accessibilityLabel={a.fileName}
                  style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: t.radius.md }}
                  contentFit="cover"
                  placeholder={null}
                  transition={150}
                />
                <Text variant="caption" color="faint" numberOfLines={1}>
                  {a.fileName}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
