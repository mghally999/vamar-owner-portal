import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { DISPUTE_STATUS_LABEL, DISPUTE_TYPE_LABEL } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useDispute } from '@/lib/queries';
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
  Text,
  layout,
} from '@/ui';

export default function DisputeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t: tr, pick, lang, date } = useI18n();
  const q = useDispute(id);
  const d = q.data;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  return (
    <ScrollView contentContainerStyle={layout.screen}>
      <View style={{ gap: 4, paddingVertical: 8 }}>
        {d ? (
          <>
            <Text variant="caption" weight="medium" color="soft" tnum>
              {tr('dispute_case')} {d.caseNo} · {DISPUTE_STATUS_LABEL[d.status][lang]}
            </Text>
            <Text variant="title" weight="semibold">
              {DISPUTE_TYPE_LABEL[d.type][lang]}
            </Text>
            <Text variant="secondary" color="soft">
              {pick(d.buildingNameAr, d.buildingNameEn)} {d.unitNo}
              {d.tenantName ? ` · ${d.tenantName}` : ''}
            </Text>
          </>
        ) : (
          <>
            <Skeleton width={160} height={14} />
            <Skeleton width={240} height={28} />
          </>
        )}
      </View>

      {d ? (
        <Card style={{ paddingHorizontal: 16 }}>
          {[
            [
              tr('dispute_claimed'),
              d.amountClaimedFils ? (
                <Money key="m" fils={d.amountClaimedFils} variant="secondary" />
              ) : (
                '—'
              ),
            ],
            [tr('dispute_hearing'), d.nextHearingDate ? date(d.nextHearingDate) : '—'],
            [tr('dispute_opened'), date(d.openedAt.slice(0, 10))],
          ].map(([label, value], i) => (
            <View key={i}>
              {i > 0 ? <Separator /> : null}
              <Row style={{ justifyContent: 'space-between', minHeight: 48 }}>
                <Text variant="secondary" color="soft">
                  {label}
                </Text>
                {typeof value === 'string' ? (
                  <Text variant="secondary" weight="medium" tnum>
                    {value}
                  </Text>
                ) : (
                  value
                )}
              </Row>
            </View>
          ))}
        </Card>
      ) : (
        <Skeleton height={140} radius={12} />
      )}

      <View>
        <SectionTitle>{tr('dispute_updates')}</SectionTitle>
        {!d ? (
          <Skeleton height={96} radius={12} />
        ) : d.updates.length === 0 ? (
          <EmptyState title={tr('dispute_updates_empty')} />
        ) : (
          <Card style={{ paddingHorizontal: 16 }}>
            {d.updates.map((u, i) => (
              <View key={u.id}>
                {i > 0 ? <Separator /> : null}
                <View style={{ paddingVertical: 12, gap: 4 }}>
                  <Text>{u.note}</Text>
                  <DateText date={u.at.slice(0, 10)} variant="caption" color="faint" />
                </View>
              </View>
            ))}
          </Card>
        )}
      </View>
    </ScrollView>
  );
}
