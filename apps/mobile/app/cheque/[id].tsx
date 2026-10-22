import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { ScrollView, View } from 'react-native';
import { sharePct } from '@vamar/shared';
import { API_BASE, authHeaders } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCheque } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import {
  Card,
  DateText,
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

export default function ChequeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { t: tr, pick, date } = useI18n();
  const q = useCheque(id);
  const c = q.data;

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  return (
    <ScrollView contentContainerStyle={layout.screen}>
      <View style={{ gap: 6, paddingVertical: 8 }}>
        <Text variant="caption" weight="medium" color="soft">
          {c?.shared ? tr('cheque_yourShare', { pct: sharePct(c.shareBp) }) : tr('cheque_detail')}
        </Text>
        {c ? (
          <Money fils={c.amountFils} variant="hero" weight="semibold" color="primary" />
        ) : (
          <Skeleton width={220} height={40} />
        )}
        {c ? <StatusChip status={c.status} /> : null}
        {c?.bounceReason ? (
          <Text variant="secondary" color="danger">
            {tr('cheque_bounceReason')}: {c.bounceReason}
          </Text>
        ) : null}
      </View>

      {!c ? (
        <Skeleton height={160} radius={12} />
      ) : (
        <Card style={{ paddingHorizontal: 16 }}>
          {[
            [tr('cheque_due'), date(c.dueDate)],
            [tr('cheque_no'), c.chequeNo ?? '—'],
            [tr('cheque_bank'), c.bankName ?? '—'],
            [tr('cheque_unit'), `${pick(c.buildingNameAr, c.buildingNameEn)} ${c.unitNo}`],
            [tr('cheque_tenant'), c.tenantName],
          ].map(([label, value], i) => (
            <View key={label}>
              {i > 0 ? <Separator /> : null}
              <Row style={{ justifyContent: 'space-between', minHeight: 48, gap: 12 }}>
                <Text variant="secondary" color="soft">
                  {label}
                </Text>
                <Text
                  variant="secondary"
                  weight="medium"
                  tnum
                  style={{ flexShrink: 1, textAlign: 'right' }}
                >
                  {value}
                </Text>
              </Row>
            </View>
          ))}
        </Card>
      )}

      <View>
        <SectionTitle>{tr('cheque_timeline')}</SectionTitle>
        {!c ? (
          <Skeleton height={96} radius={12} />
        ) : (
          <Card style={{ padding: 16, gap: 12 }}>
            {c.timeline.map((e, i) => (
              <Row key={e.id} style={{ gap: 12 }}>
                <View style={{ alignItems: 'center', width: 12 }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: t.colors.primary,
                    }}
                  />
                  {i < c.timeline.length - 1 ? (
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
                <View style={{ flex: 1, gap: 2 }}>
                  <StatusChip status={e.toStatus} />
                  <Text variant="caption" color="faint" tnum>
                    {date(e.at.slice(0, 10))}
                  </Text>
                </View>
              </Row>
            ))}
          </Card>
        )}
      </View>

      {c?.hasImage ? (
        <View>
          <SectionTitle>{tr('cheque_image')}</SectionTitle>
          <Image
            source={{ uri: `${API_BASE}/api/owner/cheques/${c.id}/image`, headers: authHeaders() }}
            cachePolicy="memory-disk"
            accessibilityLabel={tr('cheque_image')}
            style={{ width: '100%', aspectRatio: 2.2, borderRadius: t.radius.md }}
            contentFit="contain"
            placeholder={null}
            transition={150}
          />
        </View>
      ) : null}
      <DateText date={null} style={{ display: 'none' }} />
    </ScrollView>
  );
}
