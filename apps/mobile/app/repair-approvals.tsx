import { Link } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { REPAIR_APPROVAL_STATUS_LABEL } from '@vamar/shared';
import { useApprovalText } from '@/lib/approval-messages';
import { useApprovals } from '@/lib/approval-queries';
import { useI18n } from '@/lib/i18n';
import { Card, Chip, EmptyState, ErrorState, Money, Row, Skeleton, Text, layout } from '@/ui';

/** The owner's approval requests; the API lists those still waiting for an answer first. */
export default function ApprovalsScreen() {
  const ta = useApprovalText();
  const { pick, lang, date } = useI18n();
  const q = useApprovals();

  if (q.isPending)
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <Skeleton height={96} radius={12} />
        <Skeleton height={96} radius={12} />
      </View>
    );
  if (q.isError)
    return (
      <View style={{ padding: 16 }}>
        <ErrorState onRetry={() => void q.refetch()} />
      </View>
    );
  if (q.data.length === 0)
    return (
      <View style={{ padding: 16 }}>
        <EmptyState title={ta('approvals_empty')} />
      </View>
    );
  return (
    <ScrollView contentContainerStyle={layout.screen}>
      {q.data.map((a) => (
        <Link key={a.id} href={{ pathname: '/repair-approval/[id]', params: { id: a.id } }} asChild>
          <Pressable accessibilityRole="button">
            <Card style={{ padding: 16, gap: 6 }}>
              <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                <Text weight="semibold" numberOfLines={2} style={{ flex: 1 }}>
                  {pick(a.titleAr, a.titleEn)}
                </Text>
                <Chip label={REPAIR_APPROVAL_STATUS_LABEL[a.status][lang]} />
              </Row>
              <Text variant="secondary" color="soft">
                {pick(a.buildingNameAr, a.buildingNameEn)}
                {a.unitNo ? ` ${a.unitNo}` : ''}
              </Text>
              <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                <Text variant="caption" color="faint" tnum>
                  {ta('approval_asked')} {date(a.askedOn)}
                </Text>
                <Row style={{ gap: 6 }}>
                  <Text variant="caption" color="faint">
                    {ta('approval_share')}
                  </Text>
                  <Money fils={a.shareFils} variant="caption" />
                </Row>
              </Row>
            </Card>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}
