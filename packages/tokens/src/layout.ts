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

/** One radius scale. Cards and buttons use `md`, chips `sm`, sheets `lg`. */
export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  full: 9999,
} as const;

/** At most one subtle shadow level. Cards sit on borders, not shadows, by default. */
export const shadow = {
  card: {
    css: '0 1px 2px rgba(22, 40, 66, 0.06), 0 2px 8px rgba(22, 40, 66, 0.04)',
    reactNative: {
      shadowColor: '#162842',
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
