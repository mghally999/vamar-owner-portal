/** IBM Plex Sans Arabic covers Arabic and Latin. Only 400 / 500 / 600 are shipped. */
export const fontFamily = {
  sans: 'IBM Plex Sans Arabic',
  /** Font file base names as loaded with expo-font / @font-face. */
  files: {
    400: 'IBMPlexSansArabic-Regular',
    500: 'IBMPlexSansArabic-Medium',
    600: 'IBMPlexSansArabic-SemiBold',
  },
  /** CSS fallback stack used by the dashboard. */
  fallback: "'IBM Plex Sans Arabic', 'Segoe UI', system-ui, -apple-system, Tahoma, sans-serif",
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

/** Type scale in px: 32 / 24 / 20 / 17 / 15 / 13. Line heights tuned for Arabic ascenders. */
export const fontSize = {
  hero: { size: 32, lineHeight: 40 },
  title: { size: 24, lineHeight: 32 },
  heading: { size: 20, lineHeight: 28 },
  body: { size: 17, lineHeight: 26 },
  secondary: { size: 15, lineHeight: 22 },
  caption: { size: 13, lineHeight: 18 },
} as const;

export type FontSizeKey = keyof typeof fontSize;

/** Every amount and date uses tabular numerals so columns of numbers line up. */
export const numericVariant = {
  css: 'tabular-nums',
  reactNative: ['tabular-nums'] as const,
} as const;
