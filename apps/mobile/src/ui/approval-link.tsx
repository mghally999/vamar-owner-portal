/**
 * Ways into a pending approval request besides the push: a banner over the maintenance list and
 * a card on the job itself. Both stay hidden when there is nothing to answer (or the request
 * failed: the job screens must not break over this).
 */
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { useApprovalText } from '@/lib/approval-messages';
import { useApprovals } from '@/lib/approval-queries';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Card, Money, Row, Text } from './index';

export function PendingApprovalsBanner() {
  const t = useTheme();
  const ta = useApprovalText();
  const q = useApprovals({ status: 'pending' });
  const open = (q.data ?? []).filter((a) => a.canAnswer);
  if (open.length === 0) return null;
  return (
    <Link href="/repair-approvals" asChild>
      <Pressable accessibilityRole="button" style={{ marginTop: 12 }}>
        <Card style={{ padding: 16, gap: 4, borderColor: t.colors.warning }}>
          <Text weight="semibold" tnum>
            {ta('approvals_banner', { count: open.length })}
          </Text>
          <Text variant="secondary" color="soft">
            {ta('approvals_banner_body')}
          </Text>
        </Card>
      </Pressable>
    </Link>
  );
}

export function WorkOrderApprovalCard({ workOrderId }: { workOrderId: string }) {
  const t = useTheme();
  const ta = useApprovalText();
  const { money } = useI18n();
  const q = useApprovals({ workOrderId });
  const mine = (q.data ?? []).find((a) => a.canAnswer);
  if (!mine) return null;
  return (
    <Link href={{ pathname: '/repair-approval/[id]', params: { id: mine.id } }} asChild>
      <Pressable accessibilityRole="button">
        <Card style={{ padding: 16, gap: 6, borderColor: t.colors.warning }}>
          <Text weight="semibold">{ta('approval_card_title')}</Text>
          <Row style={{ justifyContent: 'space-between', gap: 12 }}>
            <Text variant="secondary" color="soft">
              {ta('approval_share')}
            </Text>
            <Money fils={mine.shareFils} variant="secondary" />
          </Row>
          <Text variant="secondary" color="soft" tnum>
            {ta('approval_estimate')}: {money(mine.amountFils)}
          </Text>
          <Text variant="secondary" color="primary" weight="medium">
            {ta('approval_card_open')}
          </Text>
        </Card>
      </Pressable>
    </Link>
  );
}
