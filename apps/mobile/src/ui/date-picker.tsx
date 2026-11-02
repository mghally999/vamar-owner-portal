import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import {
  addMonthsClamped,
  formatMonth,
  monthGrid,
  todayInDubai,
  weekdayOrder,
  WEEKDAY_SHORT,
  type PlainDate,
  type WeekStart,
} from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Button, Row, Text } from '.';
import { Icon } from './icon';

/**
 * In-house calendar date picker: a month grid with arrows, Western digits, the week starting on
 * the configured day. Used by the custom range in the period sheet. `value` is the field's date.
 */
export function DatePickerField({
  label,
  value,
  onChange,
  weekStart = 'monday',
  min,
  max,
}: {
  label: string;
  value: PlainDate;
  onChange: (next: PlainDate) => void;
  weekStart?: WeekStart | undefined;
  min?: PlainDate | undefined;
  max?: PlainDate | undefined;
}) {
  const t = useTheme();
  const { date } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text variant="caption" color="soft">
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${date(value)}`}
        onPress={() => {
          setOpen(true);
        }}
        style={{
          minHeight: 48,
          justifyContent: 'center',
          paddingHorizontal: 14,
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: t.colors.borderStrong,
          backgroundColor: t.colors.bgElevated,
        }}
      >
        <Text tnum>{date(value)}</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setOpen(false);
        }}
      >
        <Pressable
          accessibilityLabel="close"
          onPress={() => {
            setOpen(false);
          }}
          style={{ flex: 1, backgroundColor: 'rgba(37,50,58,0.35)', justifyContent: 'center' }}
        >
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
            }}
            style={{ marginHorizontal: 20 }}
          >
            <View
              style={{
                backgroundColor: t.colors.bgElevated,
                borderRadius: t.radius.lg,
                padding: 16,
                gap: 12,
              }}
            >
              <MonthCalendar
                value={value}
                weekStart={weekStart}
                min={min}
                max={max}
                onPick={(d) => {
                  onChange(d);
                  setOpen(false);
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** A month grid that picks one day. Shared by the date field and the period sheet. */
export function MonthCalendar({
  value,
  onPick,
  weekStart = 'monday',
  min,
  max,
}: {
  value: PlainDate;
  onPick: (d: PlainDate) => void;
  weekStart?: WeekStart | undefined;
  min?: PlainDate | undefined;
  max?: PlainDate | undefined;
}) {
  const t = useTheme();
  const { lang, t: tr, isRTL } = useI18n();
  const [cursor, setCursor] = useState<PlainDate>(`${value.slice(0, 7)}-01` as PlainDate);
  const [y, m] = cursor.split('-').map(Number) as [number, number];
  const rows = monthGrid(y, m, weekStart);
  const today = todayInDubai();
  const order = weekdayOrder(weekStart);
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('month_prev')}
          hitSlop={8}
          onPress={() => {
            setCursor(addMonthsClamped(cursor, -1));
          }}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronPrev" color={t.colors.ink} flip={!isRTL} />
        </Pressable>
        <Text weight="medium" tnum>
          {formatMonth(cursor, lang)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('month_next')}
          hitSlop={8}
          onPress={() => {
            setCursor(addMonthsClamped(cursor, 1));
          }}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronNext" color={t.colors.ink} flip={!isRTL} />
        </Pressable>
      </Row>
      <Row>
        {order.map((d) => (
          <Text
            key={d}
            variant="caption"
            color="faint"
            style={{ flex: 1, textAlign: 'center', paddingEnd: 0 }}
          >
            {WEEKDAY_SHORT[lang][d]}
          </Text>
        ))}
      </Row>
      {rows.map((row, i) => (
        <Row key={i}>
          {row.map((cell) => {
            const disabled =
              (min !== undefined && cell.date < min) || (max !== undefined && cell.date > max);
            const selected = cell.date === value;
            return (
              <Pressable
                key={cell.date}
                accessibilityRole="button"
                accessibilityLabel={cell.date}
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  onPick(cell.date);
                }}
                style={{
                  flex: 1,
                  height: 40,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 20,
                  backgroundColor: selected ? t.colors.primary : 'transparent',
                  opacity: disabled ? 0.3 : cell.inMonth ? 1 : 0.45,
                }}
              >
                <Text
                  variant="secondary"
                  weight={cell.date === today ? 'semibold' : 'regular'}
                  tnum
                  style={{
                    color: selected ? t.colors.onPrimary : t.colors.ink,
                    paddingEnd: 0,
                    textDecorationLine: cell.date === today && !selected ? 'underline' : 'none',
                  }}
                >
                  {Number(cell.date.slice(8, 10))}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      ))}
    </View>
  );
}

/** Year and month pickers for the "pick a year / month" sheets and the calendar jump. */
export function YearMonthPicker({
  year,
  month,
  onChange,
  withMonth,
  onDone,
}: {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
  withMonth: boolean;
  onDone: () => void;
}) {
  const t = useTheme();
  const { lang, t: tr, isRTL } = useI18n();
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return (
    <View style={{ gap: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('calendar_prev')}
          hitSlop={8}
          onPress={() => {
            onChange(year - 1, month);
          }}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronPrev" color={t.colors.ink} flip={!isRTL} />
        </Pressable>
        <Text variant="heading" weight="semibold" tnum>
          {year}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('calendar_next')}
          hitSlop={8}
          onPress={() => {
            onChange(year + 1, month);
          }}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronNext" color={t.colors.ink} flip={!isRTL} />
        </Pressable>
      </Row>
      {withMonth ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {months.map((mo) => {
            const selected = mo === month;
            return (
              <Pressable
                key={mo}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  onChange(year, mo);
                }}
                style={{
                  width: '30%',
                  flexGrow: 1,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: t.radius.md,
                  borderWidth: 1,
                  borderColor: selected ? t.colors.primary : t.colors.border,
                  backgroundColor: selected ? t.colors.primary : t.colors.bgElevated,
                }}
              >
                <Text
                  variant="secondary"
                  weight="medium"
                  style={{ color: selected ? t.colors.onPrimary : t.colors.ink, paddingEnd: 0 }}
                >
                  {formatMonth(
                    `${year}-${String(mo).padStart(2, '0')}-01` as PlainDate,
                    lang,
                  ).replace(` ${year}`, '')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Button title={tr('period_apply')} onPress={onDone} />
    </View>
  );
}
