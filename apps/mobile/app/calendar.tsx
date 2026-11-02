import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import {
  addDays,
  addMonthsClamped,
  formatMonth,
  monthGrid,
  startOfWeek,
  todayInDubai,
  type PlainDate,
} from '@vamar/shared';
import { groupByDay } from '@/lib/calendar';
import { useI18n } from '@/lib/i18n';
import { useCalendar, useMe } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { Card, ErrorState, Row, Skeleton, Text, layout } from '@/ui';
import { Agenda, HijriLine, Legend, MonthGrid, WeekStrip, YearGrid } from '@/ui/calendar';
import { YearMonthPicker } from '@/ui/date-picker';
import { Icon } from '@/ui/icon';
import { Segmented } from '@/ui/segmented';

type ViewKind = 'year' | 'month' | 'week' | 'agenda';

/**
 * The calendar: Year (twelve mini months), Month, Week and Agenda, opening on today. Arrows move
 * a year, a month or a week; a tap on the title jumps to any month or year; "Today" comes back.
 * Dots are coloured by kind; a tapped day lists its items under the grid.
 */
export default function CalendarScreen() {
  const t = useTheme();
  const { t: tr, lang, date, isRTL } = useI18n();
  const settings = useMe().data?.settings;
  const weekStart = settings?.weekStart ?? 'monday';
  const today = todayInDubai();
  const [view, setView] = useState<ViewKind>('month');
  const [cursor, setCursor] = useState<PlainDate>(today);
  const [selected, setSelected] = useState<PlainDate | null>(today);
  const [jump, setJump] = useState(false);
  const [jumpYear, setJumpYear] = useState(Number(today.slice(0, 4)));
  const [jumpMonth, setJumpMonth] = useState(Number(today.slice(5, 7)));
  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7));

  // One request per visible range: the year for the year view, else the month grid's padding.
  const range = useMemo((): { from: PlainDate; to: PlainDate } => {
    if (view === 'year')
      return { from: `${year}-01-01` as PlainDate, to: `${year}-12-31` as PlainDate };
    if (view === 'week') {
      const from = startOfWeek(cursor, weekStart);
      return { from, to: addDays(from, 6) };
    }
    if (view === 'agenda') return { from: cursor, to: addDays(cursor, 59) };
    const rows = monthGrid(year, month, weekStart);
    const first = rows[0]?.[0]?.date ?? cursor;
    const lastRow = rows[rows.length - 1];
    const last = lastRow?.[lastRow.length - 1]?.date ?? cursor;
    return { from: first, to: last };
  }, [view, year, month, cursor, weekStart]);
  const q = useCalendar(range.from, range.to);
  const items = q.data?.items ?? [];
  const byDay = useMemo(() => groupByDay(items), [items]);
  const holidays = useMemo(() => new Set(q.data?.holidays ?? []), [q.data]);

  const move = (dir: -1 | 1) => {
    if (view === 'year') setCursor(`${year + dir}${cursor.slice(4)}` as PlainDate);
    else if (view === 'week') setCursor(addDays(cursor, 7 * dir));
    else if (view === 'agenda') setCursor(addDays(cursor, 60 * dir));
    else setCursor(addMonthsClamped(cursor, dir));
  };

  const title =
    view === 'year'
      ? String(year)
      : view === 'week'
        ? `${date(startOfWeek(cursor, weekStart))} – ${date(addDays(startOfWeek(cursor, weekStart), 6))}`
        : view === 'agenda'
          ? `${date(range.from)} – ${date(range.to)}`
          : formatMonth(cursor, lang);

  return (
    <ScrollView contentContainerStyle={layout.screen}>
      <Segmented
        options={[
          { value: 'year', label: tr('calendar_year') },
          { value: 'month', label: tr('calendar_month') },
          { value: 'week', label: tr('calendar_week') },
          { value: 'agenda', label: tr('calendar_agenda') },
        ]}
        value={view}
        onChange={setView}
      />
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('calendar_prev')}
          hitSlop={8}
          onPress={() => {
            move(-1);
          }}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronPrev" color={t.colors.ink} flip={!isRTL} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('calendar_jump')}
          onPress={() => {
            setJumpYear(year);
            setJumpMonth(month);
            setJump(true);
          }}
          style={{ flex: 1, alignItems: 'center', gap: 2 }}
        >
          <Text variant="heading" weight="semibold" tnum numberOfLines={1}>
            {title}
          </Text>
          <HijriLine date={selected ?? cursor} show={settings?.hijriDisplay === true} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('calendar_next')}
          hitSlop={8}
          onPress={() => {
            move(1);
          }}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronNext" color={t.colors.ink} flip={!isRTL} />
        </Pressable>
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setCursor(today);
            setSelected(today);
          }}
          style={{
            height: 32,
            paddingHorizontal: 12,
            borderRadius: 16,
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.bgElevated,
          }}
        >
          <Text variant="caption" weight="medium">
            {tr('calendar_today')}
          </Text>
        </Pressable>
        <Text variant="caption" color="faint" tnum>
          {q.data ? tr('calendar_items', { n: items.length }) : ''}
        </Text>
      </Row>

      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : null}
      {q.isPending ? <Skeleton height={280} radius={24} /> : null}

      {view === 'year' ? (
        <YearGrid
          year={year}
          weekStart={weekStart}
          today={today}
          byDay={byDay}
          holidays={holidays}
          onOpenMonth={(m) => {
            setCursor(`${year}-${String(m).padStart(2, '0')}-01` as PlainDate);
            setView('month');
          }}
        />
      ) : null}
      {view === 'month' ? (
        <Card style={{ padding: 12 }}>
          <MonthGrid
            year={year}
            month={month}
            weekStart={weekStart}
            today={today}
            selected={selected}
            byDay={byDay}
            holidays={holidays}
            onSelect={(d) => {
              setSelected(d);
              if (d.slice(0, 7) !== cursor.slice(0, 7)) setCursor(d);
            }}
          />
        </Card>
      ) : null}
      {view === 'week' ? (
        <Card style={{ padding: 12 }}>
          <WeekStrip
            anchor={cursor}
            weekStart={weekStart}
            today={today}
            selected={selected}
            byDay={byDay}
            holidays={holidays}
            onSelect={setSelected}
          />
        </Card>
      ) : null}

      <View style={{ gap: 6 }}>
        <Text variant="caption" weight="medium" color="soft">
          {tr('calendar_legend')}
        </Text>
        <Legend />
      </View>

      {view === 'agenda' ? (
        <Agenda
          items={items}
          from={range.from}
          to={range.to}
          emptyText={tr('calendar_agendaEmpty')}
        />
      ) : view === 'week' ? (
        <Agenda
          items={items}
          from={range.from}
          to={range.to}
          emptyText={tr('calendar_agendaEmpty')}
        />
      ) : selected ? (
        <View style={{ gap: 6 }}>
          <Text variant="secondary" weight="medium" tnum>
            {date(selected)}
          </Text>
          <Agenda items={items} from={selected} to={selected} emptyText={tr('calendar_dayEmpty')} />
        </View>
      ) : null}

      <Modal
        visible={jump}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setJump(false);
        }}
      >
        <Pressable
          accessibilityLabel={tr('cancel')}
          onPress={() => {
            setJump(false);
          }}
          style={{ flex: 1, backgroundColor: 'rgba(37,50,58,0.35)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
            }}
          >
            <View
              style={{
                backgroundColor: t.colors.bgElevated,
                borderTopLeftRadius: t.radius.lg,
                borderTopRightRadius: t.radius.lg,
                padding: 20,
                paddingBottom: 32,
                gap: 12,
              }}
            >
              <Text variant="heading" weight="semibold" accessibilityRole="header">
                {tr('calendar_jump')}
              </Text>
              <YearMonthPicker
                year={jumpYear}
                month={jumpMonth}
                withMonth={view !== 'year'}
                onChange={(y, m) => {
                  setJumpYear(y);
                  setJumpMonth(m);
                }}
                onDone={() => {
                  const next = `${jumpYear}-${String(jumpMonth).padStart(2, '0')}-01` as PlainDate;
                  setCursor(next);
                  setSelected(null);
                  setJump(false);
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
