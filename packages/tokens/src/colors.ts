// TEMPORARY: from vamar.ae, replace with official files
// Extracted on 2026-10-07 from the vamar.ae stylesheet (CSS variables --ink, --bg, --bg-elev,
// --accent, --feature-bg) and the site icon. The site uses a deep navy on a warm off-white.
// Only brand.primary is used for primary actions, the active tab and the hero number.

export const brand = {
  /** Vamar navy. Primary actions, active tab, hero number. */
  primary: '#162842',
  /** Hover/pressed state of primary (vamar.ae --feature-bg). */
  primaryStrong: '#0d1f33',
  /** Lighter navy used for primary surfaces on dark backgrounds (vamar.ae --feature-bg dark). */
  primarySoft: '#1a3656',
  /** Slate accent from vamar.ae (--accent). Secondary text and icons. */
  accent: '#5f7180',
  /** Slate accent, dark theme variant (--accent dark). */
  accentDark: '#8fa0ad',
  /** Warm sand from vamar.ae dark-theme ink. */
  sand: '#ebe6dd',
  /** Light grey used for the mark strokes in the site icon. */
  markStroke: '#c4ccd3',
} as const;

/** Warm grey neutrals. Step 0 is the vamar.ae page background. */
export const neutral = {
  0: '#f5f4ef',
  50: '#f3efe7',
  100: '#ebe6dd',
  200: '#dcd7cc',
  300: '#c4ccd3',
  400: '#8fa0ad',
  500: '#5f7180',
  600: '#44525e',
  700: '#2d3741',
  800: '#1a2229',
  900: '#151717',
} as const;

/**
 * Muted status colours. Always paired with a text label in the UI, never colour alone.
 * `fg` is for text/icons, `bg` for a soft chip background, `fgOnDark`/`bgOnDark` for dark theme.
 */
export const status = {
  upcoming: {
    fg: '#44525e',
    bg: '#ebe6dd',
    fgOnDark: '#c4ccd3',
    bgOnDark: '#1a3656',
  },
  deposited: {
    fg: '#8a5a12',
    bg: '#f6e7c9',
    fgOnDark: '#e3b562',
    bgOnDark: '#3a2c10',
  },
  cleared: {
    fg: '#2a6b3f',
    bg: '#dcefe0',
    fgOnDark: '#7fc694',
    bgOnDark: '#143221',
  },
  bounced: {
    fg: '#a33a2f',
    bg: '#f6ddd9',
    fgOnDark: '#e78b80',
    bgOnDark: '#3f1b17',
  },
  replaced: {
    fg: '#4a5a67',
    bg: '#e6e3dc',
    fgOnDark: '#8fa0ad',
    bgOnDark: '#262e35',
  },
  cancelled: {
    fg: '#4a5a67',
    bg: '#e6e3dc',
    fgOnDark: '#8fa0ad',
    bgOnDark: '#262e35',
  },
} as const;

export type StatusColorKey = keyof typeof status;

/** Semantic colours for the light theme (app in light mode, dashboard always). */
export const light = {
  bg: neutral[0],
  bgElevated: '#ffffff',
  bgSunken: neutral[50],
  border: neutral[200],
  borderStrong: neutral[300],
  ink: brand.primary,
  inkSoft: 'rgba(22, 40, 66, 0.70)',
  inkFaint: 'rgba(22, 40, 66, 0.45)',
  primary: brand.primary,
  primaryHover: brand.primaryStrong,
  onPrimary: neutral[0],
  focusRing: brand.accent,
  danger: status.bounced.fg,
  success: status.cleared.fg,
  warning: status.deposited.fg,
} as const;

/** Semantic colours for the dark theme (app follows the phone). */
export const dark = {
  bg: '#0d1f33',
  bgElevated: '#162842',
  bgSunken: '#0a1829',
  border: 'rgba(235, 230, 221, 0.14)',
  borderStrong: 'rgba(235, 230, 221, 0.28)',
  ink: brand.sand,
  inkSoft: 'rgba(235, 230, 221, 0.72)',
  inkFaint: 'rgba(235, 230, 221, 0.45)',
  primary: brand.sand,
  primaryHover: '#ffffff',
  onPrimary: brand.primary,
  focusRing: brand.accentDark,
  danger: status.bounced.fgOnDark,
  success: status.cleared.fgOnDark,
  warning: status.deposited.fgOnDark,
} as const;

export type SemanticColors = typeof light;
