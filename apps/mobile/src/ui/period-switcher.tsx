import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import {
  PERIOD_PRESET_LABEL,
  isPlainDate,
  todayInDubai,
  type PlainDate,
  type WeekStart,
} from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { QUICK_PRESETS, sameSelection, selectionLabel, type PeriodSelection } from '@/lib/period';
import { useTheme } from '@/lib/theme';
import { Button, Row, Text } from '.';
import { DatePickerField, YearMonthPicker } from './date-picker';

/**
 * The period switcher at the top of Home and Expenses: four quick chips and a "More" sheet with
 * last month, last year, a year, a month, or a custom range. The sheet is a bottom modal so it
 * works the same on the phone and in the web app.
 */
export function PeriodSwitcher({
  value,
  onChange,
  weekStart = 'monday',
  quick = QUICK_PRESETS,
}: {
  value: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  weekStart?: WeekStart | undefined;
  quick?: typeof QUICK_PRESETS;
}) {
  const t = useTheme();
  const { lang, t: tr } = useI18n();
  const [sheet, setSheet] = useState<'menu' | 'year' | 'month' | 'custom' | null>(null);
  const today = todayInDubai();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const [pickYear, setPickYear] = useState(y);
  const [pickMonth, setPickMonth] = useState(m);
  const [from, setFrom] = useState<PlainDate>(`${today.slice(0, 7)}-01` as PlainDate);
  const [to, setTo] = useState<PlainDate>(today);
  const quickActive = value.kind === 'preset' && quick.includes(value.preset);

  const chip = (label: string, active: boolean, onPress: () => void, key: string) => (
    <Pressable
      key={key}
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
        numberOfLines={1}
        style={{ color: active ? t.colors.onPrimary : t.colors.ink }}
      >
        {label}
      </Text>
    </Pressable>
  );

  const option = (label: string, onPress: () => void, active = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        minHeight: 52,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderRadius: t.radius.md,
        backgroundColor: active ? t.colors.bgSunken : 'transparent',
      }}
    >
      <Text weight={active ? 'medium' : 'regular'}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 6 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
      >
        {quick.map((p) =>
          chip(
            PERIOD_PRESET_LABEL[p][lang],
            value.kind === 'preset' && value.preset === p,
            () => {
              onChange({ kind: 'preset', preset: p });
            },
            p,
          ),
        )}
        {chip(
          quickActive ? tr('period_more') : selectionLabel(value, lang, today),
          !quickActive,
          () => {
            setSheet('menu');
          },
          'more',
        )}
      </ScrollView>

      <Modal
        visible={sheet !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setSheet(null);
        }}
      >
        <Pressable
          accessibilityLabel={tr('cancel')}
          onPress={() => {
            setSheet(null);
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
                gap: 8,
              }}
            >
              <Text variant="heading" weight="semibold" accessibilityRole="header">
                {sheet === 'year'
                  ? tr('period_pickYear')
                  : sheet === 'month'
                    ? tr('period_pickMonth')
                    : sheet === 'custom'
                      ? tr('period_custom')
                      : tr('period_title')}
              </Text>
              {sheet === 'menu' ? (
                <View>
                  {option(
                    PERIOD_PRESET_LABEL.last_month[lang],
                    () => {
                      onChange({ kind: 'preset', preset: 'last_month' });
                      setSheet(null);
                    },
                    sameSelection(value, { kind: 'preset', preset: 'last_month' }),
                  )}
                  {option(
                    PERIOD_PRESET_LABEL.last_year[lang],
                    () => {
                      onChange({ kind: 'preset', preset: 'last_year' });
                      setSheet(null);
                    },
                    sameSelection(value, { kind: 'preset', preset: 'last_year' }),
                  )}
                  {option(
                    tr('period_pickYear'),
                    () => {
                      setSheet('year');
                    },
                    value.kind === 'year',
                  )}
                  {option(
                    tr('period_pickMonth'),
                    () => {
                      setSheet('month');
                    },
                    value.kind === 'month',
                  )}
                  {option(
                    tr('period_custom'),
                    () => {
                      setSheet('custom');
                    },
                    value.kind === 'custom',
                  )}
                </View>
              ) : null}
              {sheet === 'year' || sheet === 'month' ? (
                <YearMonthPicker
                  year={pickYear}
                  month={pickMonth}
                  withMonth={sheet === 'month'}
                  onChange={(yy, mm) => {
                    setPickYear(yy);
                    setPickMonth(mm);
                  }}
                  onDone={() => {
                    onChange(
                      sheet === 'year'
                        ? { kind: 'year', year: pickYear }
                        : { kind: 'month', year: pickYear, month: pickMonth },
                    );
                    setSheet(null);
                  }}
                />
              ) : null}
              {sheet === 'custom' ? (
                <View style={{ gap: 12 }}>
                  <Row style={{ gap: 12 }}>
                    <DatePickerField
                      label={tr('period_from')}
                      value={from}
                      onChange={setFrom}
                      weekStart={weekStart}
                    />
                    <DatePickerField
                      label={tr('period_to')}
                      value={to}
                      onChange={setTo}
                      weekStart={weekStart}
                    />
                  </Row>
                  {to < from ? (
                    <Text variant="caption" color="danger">
                      {tr('period_invalidRange')}
                    </Text>
                  ) : null}
                  <Button
                    title={tr('period_apply')}
                    disabled={to < from || !isPlainDate(from) || !isPlainDate(to)}
                    onPress={() => {
                      onChange({ kind: 'custom', from, to });
                      setSheet(null);
                    }}
                  />
                </View>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
