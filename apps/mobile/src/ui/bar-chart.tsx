import { View } from 'react-native';
import { formatMonth, type PlainDate } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Row, Text } from '.';

export interface BarChartPoint {
  /** `YYYY-MM` */
  key: string;
  rentFils: number;
  expensesFils: number;
}

/**
 * A small monthly bar chart drawn with Views (no native module): two bars per month, rent in
 * the primary colour and expenses in the mist, with a legend and a spoken label per month.
 */
export function BarChart({ points, height = 96 }: { points: BarChartPoint[]; height?: number }) {
  const t = useTheme();
  const { lang, t: tr, money, num } = useI18n();
  const max = Math.max(1, ...points.flatMap((p) => [p.rentFils, p.expensesFils]));
  const monthLetter = (key: string) =>
    formatMonth(`${key}-01` as PlainDate, lang)
      .split(' ')[0]
      ?.slice(0, lang === 'ar' ? 4 : 3) ?? '';
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ alignItems: 'flex-end', gap: 4, height }}>
        {points.map((p) => (
          <View
            key={p.key}
            accessible
            accessibilityLabel={tr('chart_month', {
              month: formatMonth(`${p.key}-01` as PlainDate, lang),
              rent: money(p.rentFils),
              expenses: money(p.expensesFils),
            })}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 1, height }}
          >
            <View
              style={{
                flex: 1,
                height: Math.max(2, Math.round((height * p.rentFils) / max)),
                backgroundColor: t.colors.primary,
                borderTopLeftRadius: 3,
                borderTopRightRadius: 3,
              }}
            />
            <View
              style={{
                flex: 1,
                height: Math.max(2, Math.round((height * p.expensesFils) / max)),
                backgroundColor: t.colors.track,
                borderTopLeftRadius: 3,
                borderTopRightRadius: 3,
              }}
            />
          </View>
        ))}
      </Row>
      <Row style={{ gap: 4 }}>
        {points.map((p) => (
          <Text
            key={p.key}
            variant="caption"
            color="faint"
            numberOfLines={1}
            style={{ flex: 1, textAlign: 'center', fontSize: 9, lineHeight: 12, paddingEnd: 0 }}
          >
            {points.length > 6 ? monthLetter(p.key).slice(0, 1) : monthLetter(p.key)}
          </Text>
        ))}
      </Row>
      <Row style={{ gap: 14 }}>
        <Row style={{ gap: 6 }}>
          <View
            style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: t.colors.primary }}
          />
          <Text variant="caption" color="soft">
            {tr('home_chart_rent')}
          </Text>
        </Row>
        <Row style={{ gap: 6 }}>
          <View
            style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: t.colors.track }}
          />
          <Text variant="caption" color="soft">
            {tr('home_chart_expenses')}
          </Text>
        </Row>
        <Text variant="caption" color="faint" tnum style={{ marginStart: 'auto' }}>
          {num(max)}
        </Text>
      </Row>
    </View>
  );
}
