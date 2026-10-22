import { FlashList } from '@shopify/flash-list';
import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { occupancyPct, sharePct } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useBuildings, useUnits } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import type { BuildingItem, UnitItem } from '@/lib/types';
import {
  Card,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  ProgressBar,
  Row,
  Skeleton,
  Text,
} from '@/ui';

type RowItem =
  | { kind: 'building'; building: BuildingItem }
  | { kind: 'unit'; unit: UnitItem; last: boolean }
  | { kind: 'truncated' };

/**
 * Properties tab: buildings with occupancy, then units with tenant, end date and rent. One flat
 * virtualised list so a large portfolio scrolls as smoothly as a small one.
 */
export default function PropertiesScreen() {
  const t = useTheme();
  const { t: tr, pick } = useI18n();
  const buildings = useBuildings();
  const units = useUnits();

  const rows = useMemo<RowItem[]>(() => {
    const out: RowItem[] = [];
    for (const b of buildings.data ?? []) {
      out.push({ kind: 'building', building: b });
      const bUnits = units.data?.items.filter((u) => u.buildingId === b.id) ?? [];
      bUnits.forEach((u, i) => {
        out.push({ kind: 'unit', unit: u, last: i === bUnits.length - 1 });
      });
    }
    if (units.data?.truncated) out.push({ kind: 'truncated' });
    return out;
  }, [buildings.data, units.data]);

  if (buildings.isPending) {
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <Skeleton height={120} radius={12} />
        <Skeleton height={120} radius={12} />
      </View>
    );
  }
  if (buildings.isError) {
    return (
      <View style={{ padding: 16 }}>
        <ErrorState onRetry={() => void buildings.refetch()} />
      </View>
    );
  }
  if (buildings.data.length === 0) {
    return (
      <View style={{ padding: 16 }}>
        <EmptyState title={tr('props_empty')} />
      </View>
    );
  }

  return (
    <FlashList<RowItem>
      data={rows}
      keyExtractor={(item) =>
        item.kind === 'building'
          ? `b-${item.building.id}`
          : item.kind === 'unit'
            ? `u-${item.unit.id}`
            : 'truncated'
      }
      getItemType={(item) => item.kind}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      onRefresh={() => void Promise.all([buildings.refetch(), units.refetch()])}
      refreshing={buildings.isRefetching}
      renderItem={({ item }) => {
        if (item.kind === 'truncated') {
          return (
            <Text variant="caption" color="soft" style={{ marginTop: 12 }}>
              {tr('props_truncated')}
            </Text>
          );
        }
        if (item.kind === 'building') {
          const b = item.building;
          return (
            <Card
              style={{
                marginTop: 12,
                padding: 16,
                gap: 10,
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
              }}
            >
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
              <ProgressBar pct={occupancyPct(b.occupiedCount, b.unitCount)} />
              {units.isPending ? <Skeleton height={44} /> : null}
            </Card>
          );
        }
        const u = item.unit;
        return (
          <Card
            style={{
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              borderTopWidth: 0,
              paddingHorizontal: 16,
              borderBottomLeftRadius: item.last ? t.radius.md : 0,
              borderBottomRightRadius: item.last ? t.radius.md : 0,
            }}
          >
            <Link href={{ pathname: '/unit/[id]', params: { id: u.id } }} asChild>
              <Pressable
                accessibilityRole="button"
                style={{
                  minHeight: 56,
                  justifyContent: 'center',
                  gap: 2,
                  borderTopWidth: 1,
                  borderTopColor: t.colors.border,
                }}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text weight="medium" tnum>
                    {u.unitNo}
                    {u.shareBp < 10_000 ? (
                      <Text variant="caption" color="faint" tnum>
                        {'  '}
                        {tr('unit_share', { pct: sharePct(u.shareBp) })}
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
          </Card>
        );
      }}
    />
  );
}
