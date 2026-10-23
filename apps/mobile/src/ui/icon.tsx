/**
 * Icons from the design file (packages/tokens/assets/figma), rendered unedited by expo-image and
 * tinted with the theme colour so the same file works on slate, white and dark surfaces.
 */
import { Image } from 'expo-image';

const ICONS = {
  home: require('../../../../packages/tokens/assets/figma/tab-home.svg'),
  cheques: require('../../../../packages/tokens/assets/figma/tab-cheques.svg'),
  properties: require('../../../../packages/tokens/assets/figma/tab-properties.svg'),
  disputes: require('../../../../packages/tokens/assets/figma/tab-disputes.svg'),
  settings: require('../../../../packages/tokens/assets/figma/settings.svg'),
  chevronPrev: require('../../../../packages/tokens/assets/figma/chevron-prev.svg'),
  chevronNext: require('../../../../packages/tokens/assets/figma/chevron-next.svg'),
  chevronRow: require('../../../../packages/tokens/assets/figma/chevron-row.svg'),
  scale: require('../../../../packages/tokens/assets/figma/disputes-row.svg'),
} as const;

export type IconName = keyof typeof ICONS;

/** Native size of each design asset (its root width/height). */
const SIZE: Record<IconName, number> = {
  home: 24,
  cheques: 24,
  properties: 24,
  disputes: 24,
  settings: 24,
  chevronPrev: 19,
  chevronNext: 19,
  chevronRow: 19,
  scale: 21,
};

export function Icon({
  name,
  color,
  flip,
  accessibilityLabel,
}: {
  name: IconName;
  color: string;
  /** Mirror horizontally. The chevrons are drawn for right-to-left; flip them in left-to-right. */
  flip?: boolean;
  accessibilityLabel?: string;
}) {
  const size = SIZE[name];
  return (
    <Image
      source={ICONS[name] as number}
      tintColor={color}
      contentFit="contain"
      {...(accessibilityLabel ? { accessibilityLabel, accessible: true } : { accessible: false })}
      style={[{ width: size, height: size }, flip ? { transform: [{ scaleX: -1 }] } : null]}
    />
  );
}
