import { FlashList } from '@shopify/flash-list';
import { Link, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { EXPENSE_KIND_LABEL, type ExpenseKind } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { usePeriod } from '@/lib/period';
import { useBuildings, useExpenses, useMe, useSummary } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import type { ExpenseItem } from '@/lib/types';
import {
  Amount,
  Card,
  Chip,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  Row,
  Skeleton,
  Text,
} from '@/ui';
import { PeriodSwitcher } from '@/ui/period-switcher';
import { Segmented } from '@/ui/segmented';

/**
 * Expenses tab: the shared period switcher with month / 6 months / year shortcuts, totals for
 * the period, fixed versus variable, property and category filters, and one row per invoice with
 * its category, reason, property, date and value (VAT shown when there is any).
 */
export default function ExpensesScreen() {
  const t = useTheme();
  const { t: tr, pick, date, lang } = useI18n();
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
  const categories = useMemo(() => {
    const map = new Map<string, { id: string; nameAr: string; nameEn: string }>();
    for (const e of items)
      map.set(e.categoryId, {
        id: e.categoryId,
        nameAr: e.categoryNameAr,
        nameEn: e.categoryNameEn,
      });
    return [...map.values()];
  }, [items]);

  const quick = selection.kind === 'preset' ? selection.preset : null;
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        justifyContent: 'center',
        backgroundColor: active ? t.colors.primary : t.colors.bgElevated,
        borderWidth: 1,
        borderColor: active ? t.colors.primary : t.colors.border,
      }}
    >
      <Text
        variant="caption"
        weight="medium"
        style={{ color: active ? t.colors.onPrimary : t.colors.ink }}
      >
        {label}
      </Text>
    </Pressable>
  );

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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
      >
        {chip(tr('cheques_filter_all'), buildingId === undefined, () => {
          setBuildingId(undefined);
        })}
        {buildings.data?.map((b) =>
          chip(pick(b.nameAr, b.nameEn), buildingId === b.id, () => {
            setBuildingId(b.id);
          }),
        )}
      </ScrollView>
      {categories.length > 1 || categoryId ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        >
          {chip(tr('expenses_filter_category'), categoryId === undefined, () => {
            setCategoryId(undefined);
          })}
          {categories.map((c) =>
            chip(pick(c.nameAr, c.nameEn), categoryId === c.id, () => {
              setCategoryId(c.id);
            }),
          )}
        </ScrollView>
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
                      {e.shared
                        ? ` ${fmt(e.amountFils, lang)} / ${fmt(e.grossTotalFils, lang)}`
                        : ''}
                      {e.grossVatFils > 0
                        ? `${e.shared ? ' · ' : ''}${tr('expense_vat')} ${fmt(e.grossVatFils, lang)}`
                        : ''}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
            </Link>
          )}
        />
      )}
      <DateText date={null} style={{ display: 'none' }} />
    </View>
  );
}

function fmt(fils: number, lang: 'ar' | 'en'): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE', {
    maximumFractionDigits: 0,
  })
    .format(Math.round(fils / 100))
    .replace(/[‎‏؜]/g, '');
}
