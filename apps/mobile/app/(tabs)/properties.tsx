import { Link } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useI18n } from '@/lib/i18n';
import { useBuildings, useUnits } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import {
  Card,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  ProgressBar,
  Row,
  Separator,
  Skeleton,
  Text,
  layout,
} from '@/ui';

/** Properties tab: buildings with occupancy, then units with tenant, end date and rent. */
export default function PropertiesScreen() {
  const t = useTheme();
  const { t: tr, pick } = useI18n();
  const buildings = useBuildings();
  const units = useUnits();

  return (
    <ScrollView
      contentContainerStyle={layout.screen}
      refreshControl={
        <RefreshControl
          refreshing={buildings.isRefetching}
          onRefresh={() => void Promise.all([buildings.refetch(), units.refetch()])}
          tintColor={t.colors.primary}
        />
      }
    >
      {buildings.isPending ? (
        <>
          <Skeleton height={120} radius={12} />
          <Skeleton height={120} radius={12} />
        </>
      ) : buildings.isError ? (
        <ErrorState onRetry={() => void buildings.refetch()} />
      ) : buildings.data.length === 0 ? (
        <EmptyState title={tr('props_empty')} />
      ) : (
        buildings.data.map((b) => {
          const bUnits = units.data?.filter((u) => u.buildingId === b.id) ?? [];
          return (
            <Card key={b.id} style={{ padding: 16, gap: 10 }}>
              <View style={{ gap: 2 }}>
                <Text variant="heading" weight="semibold">
                  {pick(b.nameAr, b.nameEn)}
                </Text>
                <Text variant="caption" color="soft">
                  {b.area}
                </Text>
              </View>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="secondary" tnum>
                  {tr('props_units', { n: b.unitCount })}
                </Text>
                <Text variant="secondary" color="soft" tnum>
                  {tr('props_rented', { occupied: b.occupiedCount })}
                </Text>
              </Row>
              <ProgressBar
                pct={b.unitCount ? Math.round((b.occupiedCount / b.unitCount) * 100) : 0}
              />
              <View style={{ marginTop: 4 }}>
                {units.isPending ? (
                  <Skeleton height={44} />
                ) : (
                  bUnits.map((u, i) => (
                    <View key={u.id}>
                      {i > 0 ? <Separator /> : null}
                      <Link href={{ pathname: '/unit/[id]', params: { id: u.id } }} asChild>
                        <Pressable
                          accessibilityRole="button"
                          style={{ minHeight: 56, justifyContent: 'center', gap: 2 }}
                        >
                          <Row style={{ justifyContent: 'space-between' }}>
                            <Text weight="medium" tnum>
                              {u.unitNo}
                              {u.shareBp < 10_000 ? (
                                <Text variant="caption" color="faint" tnum>
                                  {'  '}
                                  {tr('unit_share', { pct: u.shareBp / 100 })}
                                </Text>
                              ) : null}
                            </Text>
                            {u.occupied ? (
                              <Money fils={u.annualRentFils} variant="secondary" />
                            ) : (
                              <Text variant="secondary" color="soft">
                                {tr('unit_vacant')}
                              </Text>
                            )}
                          </Row>
                          <Text variant="caption" color="soft" tnum>
                            {u.occupied ? (
                              <>
                                {u.tenantName} · {tr('unit_endsOn', { date: '' })}
                                <DateText date={u.contractEndDate} variant="caption" />
                              </>
                            ) : u.vacantSince ? (
                              <>
                                {tr('unit_vacantSince', { date: '' })}
                                <DateText date={u.vacantSince} variant="caption" />
                              </>
                            ) : (
                              tr('unit_neverRented')
                            )}
                          </Text>
                        </Pressable>
                      </Link>
                    </View>
                  ))
                )}
              </View>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}
