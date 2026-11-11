/**
 * A building's budget for the year inside its card on the Properties tab: each line's spend
 * against its budget with a bar (solid: spent, lighter: fixed costs still due), and where the
 * year is heading. The figures are the building's, the ones Vamar manages, not the owner's share.
 */
import { View } from 'react-native';
import type { BudgetLevel } from '@vamar/shared';
import { useBudgetText } from '@/lib/budget-messages';
import type { OwnerBuildingBudget, OwnerBudgetLine } from '@/lib/budget-queries';
import { useI18n } from '@/lib/i18n';
import { useTheme, type Theme } from '@/lib/theme';
import { Row, Separator, Text } from './index';

function levelColor(t: Theme, level: BudgetLevel): string {
  return level === 'over'
    ? t.colors.danger
    : level === 'near'
      ? t.colors.warning
      : t.colors.trackFill;
}

function BudgetLineRow({ line }: { line: OwnerBudgetLine }) {
  const t = useTheme();
  const { money, pick } = useI18n();
  const { t: tb, levelLabel, totalLabel } = useBudgetText();
  const name =
    line.nameAr !== null && line.nameEn !== null ? pick(line.nameAr, line.nameEn) : totalLabel;
  const spent = Math.min(line.percent, 100);
  const projected = Math.max(0, Math.min(line.forecastPercent, 100) - spent);
  const color = levelColor(t, line.level);
  return (
    <View style={{ gap: 4 }}>
      <Row style={{ justifyContent: 'space-between', gap: 8 }}>
        <Text
          variant="secondary"
          weight={line.categoryId === null ? 'semibold' : 'regular'}
          style={{ flexShrink: 1 }}
        >
          {name}
        </Text>
        <Text
          variant="secondary"
          weight="semibold"
          tnum
          style={{ color: line.level === 'ok' ? t.colors.ink : color }}
        >
          {`${String(line.percent)}%`}
        </Text>
      </Row>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={name}
        accessibilityValue={{ min: 0, max: 100, now: spent }}
        style={{
          height: 7,
          borderRadius: 999,
          backgroundColor: t.colors.track,
          overflow: 'hidden',
          flexDirection: 'row',
        }}
      >
        <View style={{ width: `${spent}%`, height: '100%', backgroundColor: color }} />
        <View
          style={{
            width: `${projected}%`,
            height: '100%',
            backgroundColor: levelColor(t, line.forecastLevel),
            opacity: 0.4,
          }}
        />
      </View>
      <Text variant="caption" color="soft" tnum>
        {tb('budget_spent', { actual: money(line.actualFils), budget: money(line.budgetFils) })}
        {line.level !== 'ok' ? ` · ${levelLabel(line.level)}` : ''}
      </Text>
      {line.projectedFils > 0 ? (
        <Text variant="caption" color={line.forecastLevel === 'over' ? 'danger' : 'faint'} tnum>
          {tb('budget_forecast', { forecast: money(line.forecastFils), pct: line.forecastPercent })}
        </Text>
      ) : null}
    </View>
  );
}

export function BuildingBudget({ budget, year }: { budget: OwnerBuildingBudget; year: number }) {
  const { t: tb } = useBudgetText();
  if (budget.lines.length === 0) return null;
  return (
    <View style={{ gap: 10 }} testID={`budget-${budget.buildingId}`}>
      <Separator />
      <Text variant="body" weight="semibold" tnum>
        {tb('budget_title', { year })}
      </Text>
      {budget.lines.map((line) => (
        <BudgetLineRow key={line.budgetId} line={line} />
      ))}
      <Text variant="caption" color="faint">
        {tb('budget_note')}
      </Text>
    </View>
  );
}
