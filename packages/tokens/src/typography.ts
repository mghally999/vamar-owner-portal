/**
 * Almarai (SIL Open Font License, assets/fonts/Almarai-OFL.txt) covers Arabic and Latin and is the
 * typeface of the design file. It ships in 300 / 400 / 700 / 800; the app's "medium" weight maps to
 * Bold and "semibold" to ExtraBold, as headings and amounts do in the design.
 */
export const fontFamily = {
  sans: 'Almarai',
  /** Font file base names as loaded with expo-font / @font-face. */
  files: {
    300: 'Almarai-Light',
    400: 'Almarai-Regular',
    700: 'Almarai-Bold',
    800: 'Almarai-ExtraBold',
  },
  /** CSS fallback stack used by the dashboard. */
  fallback: "'Almarai', 'Segoe UI', system-ui, -apple-system, Tahoma, sans-serif",
} as const;

export const fontWeight = {
  regular: 400,
  medium: 700,
  semibold: 800,
} as const;

/**
 * Type scale in px, from the design file: hero amount 35, screen title 22, card heading 17,
 * body 15, secondary 13, caption 12. Line heights are 1.3 to 1.5 for Arabic ascenders.
 */
export const fontSize = {
  hero: { size: 35, lineHeight: 46 },
  title: { size: 22, lineHeight: 33 },
  heading: { size: 17, lineHeight: 25 },
  body: { size: 15, lineHeight: 23 },
  secondary: { size: 13, lineHeight: 20 },
  caption: { size: 12, lineHeight: 18 },
} as const;

export type FontSizeKey = keyof typeof fontSize;

/** Every amount and date uses tabular numerals so columns of numbers line up. */
export const numericVariant = {
  css: 'tabular-nums',
  reactNative: ['tabular-nums'] as const,
} as const;
