/**
 * The app's own calendar views (no native module): a month grid with coloured dots, a week
 * strip, a year of twelve mini months, an agenda list, the legend and one item row. RTL follows
 * the layout direction; digits are always Western; the week starts on the configured day.
 */
import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';
import {
  CALENDAR_ITEM_KIND_LABEL,
  formatHijri,
  formatMonth,
  monthGrid,
  weekDays,
  WEEKDAY_SHORT,
  weekdayLabel,
  weekdayOrder,
  type CalendarItem,
  type CalendarItemKind,
  type PlainDate,
  type WeekStart,
} from '@vamar/shared';
import { CALENDAR_KINDS, groupByDay, hrefFor, kindColor } from '@/lib/calendar';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Card, Money, Row, Separator, Text } from '.';

export function Dots({ kinds }: { kinds: CalendarItemKind[] }) {
  const t = useTheme();
  const unique = [...new Set(kinds)].slice(0, 4);
  return (
    <Row style={{ gap: 2, height: 6 }}>
      {unique.map((k) => (
        <View
          key={k}
          style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: kindColor(k, t) }}
        />
      ))}
    </Row>
  );
}

function DayCell({
  date,
  inMonth,
  selected,
  today,
  kinds,
  nonWorking,
  onPress,
  compact,
}: {
  date: PlainDate;
  inMonth: boolean;
  selected: boolean;
  today: boolean;
  kinds: CalendarItemKind[];
  nonWorking: boolean;
  onPress?: (() => void) | undefined;
  compact?: boolean | undefined;
}) {
  const t = useTheme();
  const { date: fmt, t: tr } = useI18n();
  const day = Number(date.slice(8, 10));
  const inner = (
    <View
      style={{
        height: compact ? 18 : 46,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: compact ? 9 : 12,
        backgroundColor: selected
          ? t.colors.primary
          : nonWorking && inMonth && !compact
            ? t.colors.bgSunken
            : 'transparent',
        opacity: inMonth ? 1 : 0.35,
        gap: 2,
      }}
    >
      <Text
        variant="caption"
        weight={today ? 'semibold' : 'regular'}
        tnum
        style={{
          color: selected ? t.colors.onPrimary : today ? t.colors.primary : t.colors.ink,
          paddingEnd: 0,
          fontSize: compact ? 8 : 12,
          lineHeight: compact ? 10 : 16,
          textDecorationLine: today && !selected ? 'underline' : 'none',
        }}
      >
        {day}
      </Text>
      {compact ? (
        kinds.length ? (
          <View
            style={{
              width: 3,
              height: 3,
              borderRadius: 2,
              backgroundColor: selected ? t.colors.onPrimary : kindColor(kinds[0] ?? 'event', t),
            }}
          />
        ) : null
      ) : (
        <Dots kinds={kinds} />
      )}
    </View>
  );
  if (!onPress) return <View style={{ flex: 1 }}>{inner}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${fmt(date)}${kinds.length ? `, ${tr('calendar_items', { n: kinds.length })}` : ''}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      {inner}
    </Pressable>
  );
}

export function WeekdayHeader({
  weekStart,
  compact,
}: {
  weekStart: WeekStart;
  compact?: boolean | undefined;
}) {
  const { lang } = useI18n();
  return (
    <Row>
      {weekdayOrder(weekStart).map((d) => (
        <Text
          key={d}
          variant="caption"
          color="faint"
          numberOfLines={1}
          style={{
            flex: 1,
            textAlign: 'center',
            paddingEnd: 0,
            fontSize: compact ? 7 : 11,
            lineHeight: compact ? 9 : 14,
          }}
        >
          {compact
            ? (WEEKDAY_SHORT[lang][d] ?? '').slice(0, lang === 'ar' ? 2 : 1)
            : WEEKDAY_SHORT[lang][d]}
        </Text>
      ))}
    </Row>
  );
}

/** One month: a tap on a day selects it. */
export function MonthGrid({
  year,
  month,
  weekStart,
  today,
  selected,
  byDay,
  holidays,
  onSelect,
  compact,
}: {
  year: number;
  month: number;
  weekStart: WeekStart;
  today: PlainDate;
  selected: PlainDate | null;
  byDay: Map<string, CalendarItem[]>;
  holidays: ReadonlySet<string>;
  onSelect?: ((d: PlainDate) => void) | undefined;
  compact?: boolean | undefined;
}) {
  const rows = monthGrid(year, month, weekStart);
  return (
    <View style={{ gap: compact ? 1 : 4 }}>
      <WeekdayHeader weekStart={weekStart} compact={compact} />
      {rows.map((row, i) => (
        <Row key={i}>
          {row.map((cell) => {
            const kinds = (byDay.get(cell.date) ?? []).map((it) => it.kind);
            const dow = new Date(`${cell.date}T00:00:00Z`).getUTCDay();
            return (
              <DayCell
                key={cell.date}
                date={cell.date}
                inMonth={cell.inMonth}
                selected={selected === cell.date}
                today={cell.date === today}
                kinds={kinds}
                nonWorking={holidays.has(cell.date) || dow === 0 || dow === 6}
                onPress={
                  onSelect
                    ? () => {
                        onSelect(cell.date);
                      }
                    : undefined
                }
                compact={compact}
              />
            );
          })}
        </Row>
      ))}
    </View>
  );
}

/** Seven days around `anchor`. */
export function WeekStrip({
  anchor,
  weekStart,
  today,
  selected,
  byDay,
  holidays,
  onSelect,
}: {
  anchor: PlainDate;
  weekStart: WeekStart;
  today: PlainDate;
  selected: PlainDate | null;
  byDay: Map<string, CalendarItem[]>;
  holidays: ReadonlySet<string>;
  onSelect: (d: PlainDate) => void;
}) {
  const { lang } = useI18n();
  return (
    <View style={{ gap: 4 }}>
      <Row>
        {weekDays(anchor, weekStart).map((d) => (
          <Text
            key={d}
            variant="caption"
            color="faint"
            numberOfLines={1}
            style={{ flex: 1, textAlign: 'center', paddingEnd: 0, fontSize: 11 }}
          >
            {weekdayLabel(d, lang, true)}
          </Text>
        ))}
      </Row>
      <Row>
        {weekDays(anchor, weekStart).map((d) => {
          const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
          return (
            <DayCell
              key={d}
              date={d}
              inMonth
              selected={selected === d}
              today={d === today}
              kinds={(byDay.get(d) ?? []).map((it) => it.kind)}
              nonWorking={holidays.has(d) || dow === 0 || dow === 6}
              onPress={() => {
                onSelect(d);
              }}
            />
          );
        })}
      </Row>
    </View>
  );
}

/** Twelve mini months; a tap on a month opens it. */
export function YearGrid({
  year,
  weekStart,
  today,
  byDay,
  holidays,
  onOpenMonth,
}: {
  year: number;
  weekStart: WeekStart;
  today: PlainDate;
  byDay: Map<string, CalendarItem[]>;
  holidays: ReadonlySet<string>;
  onOpenMonth: (month: number) => void;
}) {
  const t = useTheme();
  const { lang } = useI18n();
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {months.map((m) => {
        const label = formatMonth(
          `${year}-${String(m).padStart(2, '0')}-01` as PlainDate,
          lang,
        ).replace(` ${year}`, '');
        return (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => {
              onOpenMonth(m);
            }}
            style={{
              width: '31%',
              flexGrow: 1,
              padding: 6,
              borderRadius: t.radius.sm,
              borderWidth: 0.8,
              borderColor: t.colors.border,
              backgroundColor: t.colors.bgElevated,
              gap: 2,
            }}
          >
            <Text
              variant="caption"
              weight="medium"
              numberOfLines={1}
              style={{ fontSize: 10, lineHeight: 14 }}
            >
              {label}
            </Text>
            <MonthGrid
              year={year}
              month={m}
              weekStart={weekStart}
              today={today}
              selected={null}
              byDay={byDay}
              holidays={holidays}
              compact
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export function Legend({ kinds = CALENDAR_KINDS }: { kinds?: CalendarItemKind[] }) {
  const t = useTheme();
  const { lang } = useI18n();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {kinds
        .filter((k) => k !== 'contract_renewal')
        .map((k) => (
          <Row key={k} style={{ gap: 5 }}>
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: kindColor(k, t) }}
            />
            <Text variant="caption" color="soft" style={{ fontSize: 11 }}>
              {CALENDAR_ITEM_KIND_LABEL[k][lang]}
            </Text>
          </Row>
        ))}
    </View>
  );
}

/** One item in the day list or the agenda; opens its screen when it has one. */
export function ItemRow({ item }: { item: CalendarItem }) {
  const t = useTheme();
  const { lang } = useI18n();
  const href = hrefFor(item);
  const body = (
    <Row style={{ gap: 10, minHeight: 48, paddingVertical: 6 }}>
      <View
        style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: kindColor(item.kind, t) }}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="secondary" numberOfLines={2}>
          {lang === 'ar' ? item.titleAr : item.titleEn}
        </Text>
        <Text variant="caption" color="faint">
          {CALENDAR_ITEM_KIND_LABEL[item.kind][lang]}
          {item.time ? ` · ${item.time}` : ''}
        </Text>
      </View>
      {item.amountFils !== null && item.amountFils !== undefined ? (
        <Money fils={item.amountFils} variant="secondary" />
      ) : null}
    </Row>
  );
  if (!href) return body;
  return (
    <Link href={{ pathname: href.pathname, params: href.params ?? {} }} asChild>
      <Pressable accessibilityRole="button">{body}</Pressable>
    </Link>
  );
}

/** Items of the selected day, or of a range (agenda), grouped by day. */
export function Agenda({
  items,
  from,
  to,
  emptyText,
}: {
  items: CalendarItem[];
  from: PlainDate;
  to: PlainDate;
  emptyText: string;
}) {
  const { date, lang } = useI18n();
  const byDay = groupByDay(items);
  const days = [...byDay.keys()].filter((d) => d >= from && d <= to).sort();
  if (days.length === 0)
    return (
      <Card style={{ padding: 16 }}>
        <Text variant="secondary" color="soft">
          {emptyText}
        </Text>
      </Card>
    );
  return (
    <Card style={{ paddingHorizontal: 16 }}>
      {days.map((d, i) => (
        <View key={d}>
          {i > 0 ? <Separator /> : null}
          <Text variant="caption" weight="medium" color="soft" tnum style={{ marginTop: 10 }}>
            {weekdayLabel(d as PlainDate, lang)} {date(d)}
          </Text>
          {(byDay.get(d) ?? []).map((it) => (
            <ItemRow key={`${d}-${it.id}`} item={it} />
          ))}
        </View>
      ))}
    </Card>
  );
}

export function HijriLine({ date, show }: { date: PlainDate; show: boolean }) {
  const { lang } = useI18n();
  if (!show) return null;
  const text = formatHijri(date, lang);
  if (!text) return null;
  return (
    <Text variant="caption" color="faint" tnum>
      {text}
    </Text>
  );
}
