import { Image } from 'react-native';
import { logoAspect } from '@vamar/tokens';

const sources = {
  full: {
    navy: require('../../../../packages/tokens/assets/brand/vamar-logo-navy.png'),
    silver: require('../../../../packages/tokens/assets/brand/vamar-logo-silver.png'),
    white: require('../../../../packages/tokens/assets/brand/vamar-logo-white.png'),
  },
  mark: {
    navy: require('../../../../packages/tokens/assets/brand/vamar-mark-navy.png'),
    silver: require('../../../../packages/tokens/assets/brand/vamar-mark-silver.png'),
    white: require('../../../../packages/tokens/assets/brand/vamar-mark-white.png'),
  },
} as const;

/** Official logo PNGs: navy on light surfaces, silver on navy. */
export function Logo({
  variant = 'mark',
  width = 40,
  color = '#162842',
}: {
  variant?: 'full' | 'mark';
  width?: number;
  color?: '#162842' | '#c4c6be' | '#ffffff';
}) {
  const tone = color === '#c4c6be' ? 'silver' : color === '#ffffff' ? 'white' : 'navy';
  const ratio = variant === 'full' ? logoAspect.logo : logoAspect.mark;
  return (
    <Image
      accessibilityRole="image"
      accessibilityLabel="Vamar"
      source={sources[variant][tone]}
      style={{ width, height: Math.round(width / ratio) }}
      resizeMode="contain"
    />
  );
}
