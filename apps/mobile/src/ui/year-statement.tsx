import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { todayInDubai } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useMe, useStatementYears } from '@/lib/queries';
import { shareYearStatement } from '@/lib/statement-period';
import { useTheme } from '@/lib/theme';
import { Button, Skeleton, Text } from '.';

/**
 * The yearly statement: the owner picks a calendar year (this year or an earlier one with data)
 * and gets one PDF for it. Used in Home's period sheet and in Settings, so it reads the owner,
 * the language and the fee-label setting itself. `onShared` runs once the share sheet (or the
 * print dialog on the web) has opened.
 */
export function YearStatementPicker({ onShared }: { onShared?: () => void }) {
  const t = useTheme();
  const { t: tr, lang, pick } = useI18n();
  const auth = useAuth();
  const me = useMe();
  const years = useStatementYears();
  const thisYear = Number(todayInDubai().slice(0, 4));
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const year = chosen ?? years.data?.[0] ?? thisYear;

  const make = () => {
    setBusy(true);
    setFailed(false);
    void shareYearStatement({
      ownerName: auth.owner ? pick(auth.owner.nameAr, auth.owner.nameEn) : '',
      lang,
      year,
      beforeFeeLabel: me.data?.settings?.showBeforeFeeLabel !== false,
    })
      .then(() => {
        onShared?.();
      })
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <View style={{ gap: 12 }}>
      <Text variant="secondary" color="soft">
        {tr('yearStatement_body')}
      </Text>
      <Text variant="caption" weight="medium" color="soft">
        {tr('yearStatement_pick')}
      </Text>
      {years.data ? (
        <View testID="statement-years" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {years.data.map((y) => {
            const selected = y === year;
            return (
              <Pressable
                key={y}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setChosen(y);
                }}
                style={{
                  minWidth: 72,
                  minHeight: 44,
                  paddingHorizontal: 14,
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
                  tnum
                  style={{ color: selected ? t.colors.onPrimary : t.colors.ink }}
                >
                  {String(y)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Skeleton height={44} />
      )}
      {year === thisYear ? (
        <Text variant="caption" color="soft">
          {tr('yearStatement_current')}
        </Text>
      ) : null}
      <Button
        title={tr('yearStatement_make', { year: String(year) })}
        loading={busy}
        disabled={!years.data}
        onPress={make}
      />
      {failed ? (
        <Text variant="caption" color="danger">
          {tr('error_generic')}
        </Text>
      ) : null}
    </View>
  );
}
