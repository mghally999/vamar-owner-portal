import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { REPAIR_APPROVAL_STATUS_LABEL, type RepairApprovalStatus } from '@vamar/shared';
import { API_BASE, authHeaders } from '@/lib/api';
import { useApprovalText } from '@/lib/approval-messages';
import { useAnswerApproval, useApproval } from '@/lib/approval-queries';
import type { ApprovalDetail } from '@/lib/approval-types';
import { useI18n } from '@/lib/i18n';
import { fonts, statusColors, useTheme } from '@/lib/theme';
import {
  Button,
  Card,
  ErrorState,
  Money,
  Row,
  SectionTitle,
  Separator,
  Skeleton,
  Text,
  layout,
} from '@/ui';

const NOTE_MAX = 500;

/**
 * One request to approve a large repair: what it is, what it costs, the owner's share, the
 * contractor and the photos, with Approve and Reject while the job is still waiting.
 */
export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ta = useApprovalText();
  const { pick, date, money } = useI18n();
  const q = useApproval(id);
  const a = q.data;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  return (
    <ScrollView contentContainerStyle={layout.screen} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 6, paddingVertical: 8 }}>
        {a ? (
          <>
            <ApprovalStatusChip status={a.status} />
            <Text variant="title" weight="semibold">
              {pick(a.titleAr, a.titleEn)}
            </Text>
            <Text variant="secondary" color="soft">
              {ta(a.kind === 'expense' ? 'approval_kind_expense' : 'approval_kind_work_order')}
              {' · '}
              {pick(a.buildingNameAr, a.buildingNameEn)}
              {a.unitNo ? ` ${a.unitNo}` : ''}
            </Text>
          </>
        ) : (
          <>
            <Skeleton width={120} height={20} />
            <Skeleton width={240} height={28} />
          </>
        )}
      </View>

      {!a ? (
        <Skeleton height={200} radius={12} />
      ) : (
        <>
          <Card style={{ padding: 16, gap: 4 }}>
            <Text variant="secondary" color="soft">
              {ta('approval_share')}
            </Text>
            <Money fils={a.shareFils} variant="hero" weight="semibold" />
            <Text variant="secondary" color="soft" tnum>
              {ta('approval_estimate')}: {money(a.amountFils)}
            </Text>
          </Card>

          <Card style={{ paddingHorizontal: 16 }}>
            {(
              [
                [ta('approval_vendor'), a.vendorName ?? '—'],
                [ta('approval_asked'), date(a.askedOn)],
              ] as const
            ).map(([label, value], i) => (
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
            {a.description ? (
              <>
                <Separator />
                <View style={{ paddingVertical: 12, gap: 4 }}>
                  <Text variant="secondary" color="soft">
                    {ta('approval_reason')}
                  </Text>
                  <Text variant="secondary">{a.description}</Text>
                </View>
              </>
            ) : null}
          </Card>

          <Photos approval={a} />

          {a.canAnswer ? <AnswerForm approval={a} /> : <AnswerSummary approval={a} />}
        </>
      )}
    </ScrollView>
  );
}

function ApprovalStatusChip({ status }: { status: RepairApprovalStatus }) {
  const t = useTheme();
  const { lang } = useI18n();
  // Reuse the cheque status colours: waiting looks like "deposited", yes like "cleared", no like
  // "bounced", so the meaning reads the same across the app in both themes.
  const key = status === 'pending' ? 'deposited' : status === 'rejected' ? 'bounced' : 'cleared';
  const { fg, bg } = statusColors(t, key);
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: t.radius.full,
        paddingHorizontal: 12,
        height: 27,
        justifyContent: 'center',
        alignSelf: 'flex-start',
      }}
    >
      <Text variant="caption" weight="medium" style={{ color: fg }}>
        {REPAIR_APPROVAL_STATUS_LABEL[status][lang]}
      </Text>
    </View>
  );
}

function Photos({ approval }: { approval: ApprovalDetail }) {
  const t = useTheme();
  const ta = useApprovalText();
  return (
    <View>
      <SectionTitle>{ta('approval_photos')}</SectionTitle>
      {approval.attachments.length === 0 ? (
        <Card style={{ padding: 16 }}>
          <Text variant="secondary" color="soft">
            {ta('approval_no_photos')}
          </Text>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {approval.attachments.map((f) => (
            <View key={f.id} style={{ width: '48%', flexGrow: 1, gap: 4 }}>
              {f.mime.startsWith('image/') ? (
                <Image
                  source={{
                    uri: `${API_BASE}/api/owner/attachments/${f.id}`,
                    headers: authHeaders(),
                  }}
                  cachePolicy="memory-disk"
                  accessibilityLabel={f.fileName}
                  style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: t.radius.md }}
                  contentFit="cover"
                  placeholder={null}
                  transition={150}
                />
              ) : null}
              <Text variant="caption" color="faint" numberOfLines={1}>
                {f.fileName}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function AnswerForm({ approval }: { approval: ApprovalDetail }) {
  const t = useTheme();
  const ta = useApprovalText();
  const { date } = useI18n();
  const answer = useAnswerApproval(approval.id);
  const [note, setNote] = useState('');
  // Rejecting holds the work back, so it takes a second, explicit tap.
  const [confirmReject, setConfirmReject] = useState(false);
  const send = (decision: 'approve' | 'reject') => {
    const trimmed = note.trim();
    answer.mutate({ decision, note: trimmed ? trimmed : null });
  };
  return (
    <Card style={{ padding: 16, gap: 12 }}>
      {approval.deadline ? (
        <Text variant="secondary" color="soft" tnum>
          {ta('approval_deadline', { date: date(approval.deadline) })}
        </Text>
      ) : null}
      <Text variant="secondary" weight="medium">
        {ta('approval_note')}
      </Text>
      <TextInput
        accessibilityLabel={ta('approval_note')}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={NOTE_MAX}
        placeholder={ta('approval_note_placeholder')}
        placeholderTextColor={t.colors.inkFaint}
        style={{
          minHeight: 88,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: t.colors.borderStrong,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.bgElevated,
          color: t.colors.ink,
          fontFamily: fonts.regular,
          fontSize: 15,
          textAlignVertical: 'top',
          writingDirection: 'auto',
        }}
      />
      {answer.isError ? (
        <Text variant="secondary" color="danger">
          {ta('approval_error')}
        </Text>
      ) : null}
      {confirmReject ? (
        <View style={{ gap: 8 }}>
          <Text variant="secondary" color="soft">
            {ta('approval_reject_hint')}
          </Text>
          <Button
            title={ta('approval_reject_confirm')}
            variant="danger"
            loading={answer.isPending}
            onPress={() => {
              send('reject');
            }}
          />
          <Button
            title={ta('approval_cancel')}
            variant="ghost"
            disabled={answer.isPending}
            onPress={() => {
              setConfirmReject(false);
            }}
          />
        </View>
      ) : (
        <Row style={{ gap: 8 }}>
          <Button
            title={ta('approval_approve')}
            loading={answer.isPending}
            style={{ flex: 1 }}
            onPress={() => {
              send('approve');
            }}
          />
          <Button
            title={ta('approval_reject')}
            variant="danger"
            disabled={answer.isPending}
            style={{ flex: 1 }}
            onPress={() => {
              setConfirmReject(true);
            }}
          />
        </Row>
      )}
    </Card>
  );
}

function AnswerSummary({ approval }: { approval: ApprovalDetail }) {
  const ta = useApprovalText();
  const { date, lang } = useI18n();
  if (approval.status === 'pending')
    return (
      <Card style={{ padding: 16 }}>
        <Text variant="secondary" color="soft">
          {ta('approval_not_waiting')}
        </Text>
      </Card>
    );
  return (
    <Card style={{ paddingHorizontal: 16 }}>
      <Row style={{ justifyContent: 'space-between', minHeight: 48, gap: 12 }}>
        <Text variant="secondary" color="soft">
          {ta('approval_your_answer')}
        </Text>
        <Text variant="secondary" weight="medium">
          {REPAIR_APPROVAL_STATUS_LABEL[approval.status][lang]}
        </Text>
      </Row>
      {approval.answeredAt ? (
        <>
          <Separator />
          <Row style={{ justifyContent: 'space-between', minHeight: 48, gap: 12 }}>
            <Text variant="secondary" color="soft">
              {ta('approval_answered_on')}
            </Text>
            <Text variant="secondary" weight="medium" tnum>
              {date(approval.answeredAt.slice(0, 10))}
            </Text>
          </Row>
        </>
      ) : null}
      {approval.note ? (
        <>
          <Separator />
          <View style={{ paddingVertical: 12, gap: 4 }}>
            <Text variant="secondary" color="soft">
              {ta('approval_your_note')}
            </Text>
            <Text variant="secondary">{approval.note}</Text>
          </View>
        </>
      ) : null}
    </Card>
  );
}
