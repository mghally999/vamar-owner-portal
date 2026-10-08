/**
 * Official Vamar brand assets (see assets/brand/README.md). The vectors are single-colour with
 * fill="currentColor": navy on light surfaces, silver on navy. Web surfaces render them through a
 * CSS mask so they take the surrounding text colour; native surfaces use the PNG variants.
 */
export const brandAssets = {
  logoSvg: 'vamar-logo.svg',
  markSvg: 'vamar-mark.svg',
  logoNavyPng: 'vamar-logo-navy.png',
  logoSilverPng: 'vamar-logo-silver.png',
  logoWhitePng: 'vamar-logo-white.png',
  markNavyPng: 'vamar-mark-navy.png',
  markSilverPng: 'vamar-mark-silver.png',
  markWhitePng: 'vamar-mark-white.png',
  appIcon: 'app-icon-1024.png',
  adaptiveIconForeground: 'adaptive-icon-foreground.png',
  adaptiveIconMonochrome: 'adaptive-icon-monochrome.png',
  splashLogo: 'splash-logo.png',
  favicon: 'favicon-512.png',
  appleTouchIcon: 'apple-touch-icon.png',
} as const;

/** Intrinsic aspect ratios of the vectors (width / height). */
export const logoAspect = {
  logo: 840 / 703,
  mark: 453 / 478,
} as const;

/** Splash and adaptive-icon background colour. */
export const brandBackground = '#162842';

export const wordmark = {
  text: 'VAMAR',
  textAr: 'فامار',
  letterSpacingEm: 0.16,
} as const;
