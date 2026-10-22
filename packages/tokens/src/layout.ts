/** 8 pt spacing grid. Screen gutters are 16. */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 40,
  8: 48,
  9: 64,
} as const;

export const gutter = spacing[4];

/**
 * Radii from the design file: tiles and small buttons 12, the month switcher and row buttons 20,
 * cards 24, chips and the progress track fully rounded.
 */
export const radius = {
  sm: 12,
  md: 20,
  lg: 24,
  full: 9999,
} as const;

/** At most one subtle shadow level. Cards sit on borders, not shadows, by default. */
export const shadow = {
  card: {
    css: '0 1px 2px rgba(37, 50, 58, 0.06), 0 2px 8px rgba(37, 50, 58, 0.04)',
    reactNative: {
      shadowColor: '#25323a',
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
  },
} as const;

/** Minimum touch target in px (iOS HIG / WCAG 2.5.5). */
export const minTouchTarget = 44;

export const borderWidth = {
  hairline: 1,
  thick: 2,
} as const;
