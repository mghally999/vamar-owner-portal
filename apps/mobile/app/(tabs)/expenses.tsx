import { FlashList } from '@shopify/flash-list';
import { Link, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { EXPENSE_KIND_LABEL, type ExpenseKind } from '@/lib/shared';
import { useI18n } from '@/lib/i18n';
import { usePeriod } from '@/lib/period';
import { useBuildings, useExpenses, useMe, useSummary } from '@/lib/queries';
import type { ExpenseItem } from '@/lib/types';
import { Amount, Card, Chip, EmptyState, ErrorState, Money, Row, Skeleton, Text } from '@/ui';
import { PeriodSwitcher } from '@/ui/period-switcher';
import { FilterChip, FilterChipRow } from '@/ui/filter-chip';
import { Segmented } from '@/ui/segmented';

interface Category {
  id: string;
  nameAr: string;
  nameEn: string;
}

/**
 * Expenses tab: the shared period switcher with month / 6 months / year shortcuts, totals for
 * the period, fixed versus variable, property and category filters, and one row per invoice with
 * its category, reason, property, date and value (VAT shown when there is any).
 */
export default function ExpensesScreen() {
  const { t: tr, pick, date, lang, num } = useI18n();
  const params = useLocalSearchParams<{ kind?: string }>();
  const { selection, setSelection, query } = usePeriod();
  const settings = useMe().data?.settings;
  const [kind, setKind] = useState<ExpenseKind | 'all'>(
    params.kind === 'fixed' || params.kind === 'variable' ? params.kind : 'all',
  );
  const [buildingId, setBuildingId] = useState<string | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const buildings = useBuildings();
  const summary = useSummary(query);
  const q = useExpenses({
    ...query,
    buildingId,
    categoryId,
    kind: kind === 'all' ? undefined : kind,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  // The categories come from the rows. Once one is chosen only its rows load, so the chips keep
  // the list seen before the choice; otherwise the others vanish and switching needs "All" first.
  const seenCategories = useRef<Category[]>([]);
  const categories = useMemo(() => {
    if (categoryId !== undefined) return seenCategories.current;
    const map = new Map<string, Category>();
    for (const e of items)
      map.set(e.categoryId, {
        id: e.categoryId,
        nameAr: e.categoryNameAr,
        nameEn: e.categoryNameEn,
      });
    seenCategories.current = [...map.values()];
    return seenCategories.current;
  }, [items, categoryId]);

  const quick = selection.kind === 'preset' ? selection.preset : null;
  const s = summary.data;
  const header = (
    <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}>
      <Segmented
        options={[
          { value: 'this_month', label: tr('expenses_month') },
          { value: 'last_6_months', label: tr('expenses_6months') },
          { value: 'this_year', label: tr('expenses_year') },
        ]}
        value={
          quick === 'this_month' || quick === 'last_6_months' || quick === 'this_year'
            ? quick
            : ('' as 'this_month')
        }
        onChange={(v) => {
          setSelection({ kind: 'preset', preset: v });
        }}
      />
      <PeriodSwitcher value={selection} onChange={setSelection} weekStart={settings?.weekStart} />
      <Card style={{ padding: 16, gap: 8 }}>
        <Text variant="caption" color="soft">
          {tr('expenses_total')}
        </Text>
        {s ? (
          <Amount
            fils={
              kind === 'fixed'
                ? s.expenses.fixedFils
                : kind === 'variable'
                  ? s.expenses.variableFils
                  : s.expenses.totalFils
            }
            size="title"
          />
        ) : (
          <Skeleton width={160} height={30} />
        )}
        {s ? (
          <Row style={{ gap: 12, flexWrap: 'wrap' }}>
            <Text variant="caption" color="soft" tnum>
              {tr('home_fixed')}:{' '}
              <Money fils={s.expenses.fixedFils} variant="caption" color="ink" />
            </Text>
            <Text variant="caption" color="soft" tnum>
              {tr('home_variable')}:{' '}
              <Money fils={s.expenses.variableFils} variant="caption" color="ink" />
            </Text>
            {s.expenses.projectedFixedFils > 0 ? (
              <Text variant="caption" color="soft" tnum>
                {tr('home_projected')}:{' '}
                <Money fils={s.expenses.projectedFixedFils} variant="caption" color="ink" />
              </Text>
            ) : null}
          </Row>
        ) : null}
      </Card>
      <Segmented
        options={[
          { value: 'all', label: tr('expenses_all') },
          { value: 'fixed', label: EXPENSE_KIND_LABEL.fixed[lang] },
          { value: 'variable', label: EXPENSE_KIND_LABEL.variable[lang] },
        ]}
        value={kind}
        onChange={setKind}
      />
      <FilterChipRow>
        <FilterChip
          label={tr('cheques_filter_all')}
          active={buildingId === undefined}
          onPress={() => {
            setBuildingId(undefined);
          }}
        />
        {buildings.data?.map((b) => (
          <FilterChip
            key={b.id}
            label={pick(b.nameAr, b.nameEn)}
            active={buildingId === b.id}
            onPress={() => {
              setBuildingId(b.id);
            }}
          />
        ))}
      </FilterChipRow>
      {categories.length > 1 || categoryId ? (
        <FilterChipRow>
          <FilterChip
            label={tr('expenses_filter_category')}
            active={categoryId === undefined}
            onPress={() => {
              setCategoryId(undefined);
            }}
          />
          {categories.map((c) => (
            <FilterChip
              key={c.id}
              label={pick(c.nameAr, c.nameEn)}
              active={categoryId === c.id}
              onPress={() => {
                setCategoryId(c.id);
              }}
            />
          ))}
        </FilterChipRow>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {q.isPending ? (
        <ScrollView>
          {header}
          <View style={{ padding: 16, gap: 12 }}>
            <Skeleton height={88} radius={12} />
            <Skeleton height={88} radius={12} />
            <Skeleton height={88} radius={12} />
          </View>
        </ScrollView>
      ) : q.isError ? (
        <ScrollView>
          {header}
          <View style={{ padding: 16 }}>
            <ErrorState onRetry={() => void q.refetch()} />
          </View>
        </ScrollView>
      ) : (
        <FlashList<ExpenseItem>
          data={items}
          keyExtractor={(e) => e.id}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <EmptyState title={tr('expenses_empty')} body={tr('expenses_empty_body')} />
            </View>
          }
          contentContainerStyle={{ paddingBottom: 32 }}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
          }}
          onRefresh={() => void Promise.all([q.refetch(), summary.refetch()])}
          refreshing={q.isRefetching}
          renderItem={({ item: e }) => (
            <Link href={{ pathname: '/expense/[id]', params: { id: e.id } }} asChild>
              <Pressable
                accessibilityRole="button"
                style={{ marginHorizontal: 16, marginBottom: 8 }}
              >
                <Card style={{ padding: 14, gap: 6 }}>
                  <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                    <Text variant="secondary" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                      {pick(e.categoryNameAr, e.categoryNameEn)}
                    </Text>
                    <Chip label={EXPENSE_KIND_LABEL[e.kind][lang]} />
                  </Row>
                  <Text numberOfLines={2}>{pick(e.reasonAr, e.reasonEn)}</Text>
                  <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                    <Text variant="caption" color="soft" numberOfLines={1} style={{ flex: 1 }}>
                      {pick(e.buildingNameAr, e.buildingNameEn)}
                      {e.unitNo ? ` ${e.unitNo}` : ` · ${tr('expense_building')}`} ·{' '}
                      {date(e.invoiceDate)}
                    </Text>
                    <Money fils={e.amountFils} variant="heading" weight="semibold" />
                  </Row>
                  {e.grossVatFils > 0 || e.shared ? (
                    <Text variant="caption" color="faint" tnum>
                      {e.shared
                        ? tr('expense_yourShare', {
                            share: '',
                            total: '',
                          })
                            .replace(/\s+/g, ' ')
                            .trim()
                        : ''}
                      {e.shared ? ` ${num(e.amountFils)} / ${num(e.grossTotalFils)}` : ''}
                      {e.grossVatFils > 0
                        ? `${e.shared ? ' · ' : ''}${tr('expense_vat')} ${num(e.grossVatFils)}`
                        : ''}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}
