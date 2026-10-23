/**
 * Small UI kit for the owner app, following the design file: bordered cards with 24 px corners,
 * Almarai, amounts as a large number with a small currency word, chips fully rounded, tabular
 * numerals on every number, status chips always paired with a label, skeletons instead of spinners.
 */
import {
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type PressableProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import type { ChequeStatus } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { fonts, statusColors, useTheme, type Theme } from '@/lib/theme';

type Variant = 'hero' | 'title' | 'heading' | 'body' | 'secondary' | 'caption';
type Weight = 'regular' | 'medium' | 'semibold';

export type TextColor =
  | 'ink'
  | 'soft'
  | 'faint'
  | 'primary'
  | 'danger'
  | 'success'
  | 'onPrimary'
  | 'onHero'
  | 'onHeroSoft'
  | 'onHeader';

export function Text({
  variant = 'body',
  weight = 'regular',
  color,
  tnum,
  style,
  ...rest
}: TextProps & {
  variant?: Variant | undefined;
  weight?: Weight | undefined;
  color?: TextColor | undefined;
  tnum?: boolean | undefined;
}) {
  const t = useTheme();
  const size = t.fontSize[variant];
  const colorValue = {
    ink: t.colors.ink,
    soft: t.colors.inkSoft,
    faint: t.colors.inkFaint,
    primary: t.colors.primary,
    danger: t.colors.danger,
    success: t.colors.success,
    onPrimary: t.colors.onPrimary,
    onHero: t.colors.onHero,
    onHeroSoft: t.colors.onHeroSoft,
    onHeader: t.colors.onHeader,
  }[color ?? 'ink'];
  return (
    <RNText
      {...rest}
      allowFontScaling
      maxFontSizeMultiplier={1.3}
      style={[
        {
          fontFamily: fonts[weight],
          fontSize: size.size,
          lineHeight: size.lineHeight,
          color: colorValue,
          writingDirection: 'auto',
          // Android measures shaped Arabic a few pixels narrower than it draws it and clips the
          // last glyphs; no font padding plus a 2 px end padding keeps the last word intact.
          includeFontPadding: false,
          paddingEnd: 2,
        },
        // Native: 'left' is the reading start under I18nManager. Web: CSS direction decides.
        Platform.OS === 'web' ? null : { textAlign: 'left' as const },
        tnum ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}

export function Money({
  fils,
  variant = 'body',
  weight = 'medium',
  color,
  style,
}: {
  fils: number | null | undefined;
  variant?: Variant | undefined;
  weight?: Weight | undefined;
  color?: TextColor | undefined;
  style?: TextProps['style'] | undefined;
}) {
  const { money } = useI18n();
  return (
    <Text variant={variant} weight={weight} color={color} tnum style={style}>
      {money(fils)}
    </Text>
  );
}

/**
 * Amount as in the design: the number large and bold, the currency word small and regular beside
 * it (`43,791 درهم` / `AED 43,791`). Reading order follows the language.
 */
export function Amount({
  fils,
  size = 'body',
  color = 'ink',
  weight = 'semibold',
  currencySize,
}: {
  fils: number | null | undefined;
  size?: Variant | undefined;
  color?: TextColor | undefined;
  weight?: Weight | undefined;
  currencySize?: Variant | undefined;
}) {
  const { num, lang } = useI18n();
  const small = currencySize ?? (size === 'hero' || size === 'title' ? 'secondary' : 'caption');
  if (fils === null || fils === undefined) {
    return (
      <Text variant={size} weight={weight} color={color}>
        —
      </Text>
    );
  }
  return (
    <Row style={{ gap: 4, alignItems: 'baseline' }}>
      <Text
        variant={size}
        weight={weight}
        color={color}
        tnum
        style={{ letterSpacing: size === 'hero' ? -1 : 0 }}
      >
        {num(fils)}
      </Text>
      <Text variant={small} color={color}>
        {lang === 'ar' ? 'درهم' : 'AED'}
      </Text>
    </Row>
  );
}

export function DateText({
  date,
  variant = 'secondary',
  color = 'soft',
  style,
}: {
  date: string | null | undefined;
  variant?: Variant | undefined;
  color?: TextColor | undefined;
  style?: TextProps['style'] | undefined;
}) {
  const i18n = useI18n();
  return (
    <Text variant={variant} color={color} tnum style={style}>
      {i18n.date(date)}
    </Text>
  );
}

export function Card({ style, children, ...rest }: ViewProps) {
  const t = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderWidth: 0.8,
          borderRadius: t.radius.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({ style, children, ...rest }: ViewProps) {
  return (
    <View {...rest} style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
      {children}
    </View>
  );
}

export function Separator() {
  const t = useTheme();
  return <View style={{ height: 0.8, backgroundColor: t.colors.border }} />;
}

export function Button({
  title,
  variant = 'primary',
  loading,
  disabled,
  style,
  ...rest
}: PressableProps & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
}) {
  const t = useTheme();
  const bg =
    variant === 'primary'
      ? t.colors.primary
      : variant === 'secondary'
        ? t.colors.bgElevated
        : 'transparent';
  const fg =
    variant === 'primary'
      ? t.colors.onPrimary
      : variant === 'danger'
        ? t.colors.danger
        : t.colors.ink;
  const border =
    variant === 'secondary' || variant === 'danger' ? t.colors.borderStrong : 'transparent';
  const isDisabled = Boolean(disabled) || Boolean(loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      {...rest}
      style={({ pressed }) => [
        {
          minHeight: 48,
          paddingHorizontal: 16,
          borderRadius: t.radius.md,
          backgroundColor: bg,
          borderColor: border,
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style({ pressed, hovered: false }) : style,
      ]}
    >
      <Text variant="body" weight="medium" style={{ color: fg }}>
        {loading ? '…' : title}
      </Text>
    </Pressable>
  );
}

export function StatusChip({ status }: { status: ChequeStatus }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const c = statusColors(t, status);
  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderRadius: t.radius.full,
        paddingHorizontal: 12,
        height: 27,
        justifyContent: 'center',
        alignSelf: 'flex-start',
      }}
    >
      <Text variant="caption" weight="medium" style={{ color: c.fg }}>
        {tr(`status_${status}` as MessageKey)}
      </Text>
    </View>
  );
}

/** Neutral label chip (no status meaning), e.g. "never rented". */
export function Chip({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.colors.chip,
        borderRadius: t.radius.full,
        paddingHorizontal: 12,
        paddingVertical: 6,
        alignSelf: 'flex-start',
      }}
    >
      <Text variant="caption" style={{ color: t.colors.onChip, fontSize: 11, lineHeight: 15 }}>
        {label}
      </Text>
    </View>
  );
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      style={{
        width,
        height,
        borderRadius: radius ?? t.radius.sm,
        backgroundColor: t.colors.bgSunken,
        opacity: 0.8,
      }}
    />
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <Card style={{ padding: 20, gap: 6 }}>
      <Text weight="medium">{title}</Text>
      {body ? (
        <Text variant="secondary" color="soft">
          {body}
        </Text>
      ) : null}
    </Card>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <Card style={{ padding: 16, gap: 12 }}>
      <Text color="danger">{t('error_generic')}</Text>
      {onRetry ? <Button title={t('retry')} variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

export function ProgressBar({ pct }: { pct: number }) {
  const t = useTheme();
  const now = Math.max(0, Math.min(100, pct));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now }}
      style={{ height: 7, borderRadius: 999, backgroundColor: t.colors.track, overflow: 'hidden' }}
    >
      <View
        style={{
          width: `${now}%`,
          height: '100%',
          borderRadius: 999,
          backgroundColor: t.colors.trackFill,
        }}
      />
    </View>
  );
}

export function SectionTitle({ children, aside }: { children: string; aside?: React.ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
      <Text variant="heading" weight="semibold">
        {children}
      </Text>
      {aside}
    </Row>
  );
}

export const layout = StyleSheet.create({
  screen: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32, gap: 16 },
});

export function themedStyles(_t: Theme) {
  return layout;
}
