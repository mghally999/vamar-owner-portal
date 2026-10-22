// Brand colours from the Vamar design file (Figma "Vamar", Page 2 Home frame and the company
// profile on Page 1): slate #25323A is the primary ink and the dark surfaces, #303C44 the
// secondary slate, #B8B9B2 the mist used for borders, tracks and text on slate, #E8E8E8 the chip
// grey and #E5E5E5 the tab bar pill, on a white background.

export const brand = {
  /** Slate. Primary actions, ink, the default header and hero card. */
  primary: '#25323a',
  /** Secondary slate. Hover/pressed state and focus ring. */
  secondary: '#303c44',
  /** Mist. Borders, the occupancy track, soft text on slate. Never body text on white. */
  mist: '#b8b9b2',
  /** Chip grey. */
  chip: '#e8e8e8',
  /** Tab bar pill. */
  tabPill: '#e5e5e5',
  /** Official logo silver (assets/brand). Logo only. */
  silver: '#c4c6be',
} as const;

/** Neutral greys between white and slate. */
export const neutral = {
  0: '#ffffff',
  50: '#f4f4f3',
  100: '#e8e8e8',
  200: '#d6d7d3',
  300: '#b8b9b2',
  400: '#8e918b',
  500: '#5e676c',
  600: '#4c575e',
  700: '#303c44',
  800: '#25323a',
  900: '#161e23',
} as const;

/**
 * Muted status colours. Always paired with a text label in the UI, never colour alone.
 * `fg` is for text/icons, `bg` for a soft chip background, `fgOnDark`/`bgOnDark` for the dark palette.
 */
export const status = {
  upcoming: { fg: '#3d4a52', bg: '#e8e8e8', fgOnDark: '#d6d7d3', bgOnDark: '#303c44' },
  deposited: { fg: '#8a5a12', bg: '#f6e7c9', fgOnDark: '#e3b562', bgOnDark: '#3a2c10' },
  cleared: { fg: '#2a6b3f', bg: '#dcefe0', fgOnDark: '#7fc694', bgOnDark: '#143221' },
  bounced: { fg: '#a33a2f', bg: '#f6ddd9', fgOnDark: '#e78b80', bgOnDark: '#3f1b17' },
  replaced: { fg: '#4c575e', bg: '#ececea', fgOnDark: '#b8b9b2', bgOnDark: '#262f35' },
  cancelled: { fg: '#4c575e', bg: '#ececea', fgOnDark: '#b8b9b2', bgOnDark: '#262f35' },
} as const;

export type StatusColorKey = keyof typeof status;

/** Every role a screen paints. Both apps read these names, never raw hex values. */
export interface SemanticColors {
  bg: string;
  bgElevated: string;
  bgSunken: string;
  border: string;
  borderStrong: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  primary: string;
  primaryHover: string;
  onPrimary: string;
  focusRing: string;
  danger: string;
  success: string;
  warning: string;
  /** Screen header (app) and sidebar (dashboard). */
  header: string;
  headerBorder: string;
  onHeader: string;
  onHeaderSoft: string;
  /** The month's money card and other hero surfaces. */
  hero: string;
  heroBorder: string;
  onHero: string;
  onHeroSoft: string;
  heroTile: string;
  /** Neutral chips (status-free labels such as "upcoming", "never rented"). */
  chip: string;
  onChip: string;
  /** Progress bars (occupancy). */
  track: string;
  trackFill: string;
  /** Floating tab bar. */
  tabBar: string;
  tabInk: string;
  tabActive: string;
  onTabActive: string;
}

const base = {
  bg: neutral[0],
  bgElevated: neutral[0],
  bgSunken: neutral[50],
  border: brand.mist,
  borderStrong: neutral[400],
  ink: brand.primary,
  inkSoft: neutral[600],
  inkFaint: neutral[500],
  primary: brand.primary,
  primaryHover: brand.secondary,
  onPrimary: neutral[0],
  focusRing: brand.secondary,
  danger: status.bounced.fg,
  success: status.cleared.fg,
  warning: status.deposited.fg,
  chip: brand.chip,
  onChip: brand.primary,
  track: brand.mist,
  trackFill: brand.primary,
} as const;

export const themes = {
  /** "Default": the slate look from the design file. */
  default: {
    ...base,
    header: brand.primary,
    headerBorder: brand.primary,
    onHeader: neutral[0],
    onHeaderSoft: brand.mist,
    hero: brand.primary,
    heroBorder: brand.primary,
    onHero: neutral[0],
    onHeroSoft: brand.mist,
    heroTile: 'rgba(255, 255, 255, 0.05)',
    tabBar: brand.tabPill,
    tabInk: '#1f2328',
    tabActive: brand.primary,
    onTabActive: neutral[0],
  },
  /** "White": the same layout on white surfaces, slate only for ink and accents. */
  white: {
    ...base,
    header: neutral[0],
    headerBorder: brand.chip,
    onHeader: brand.primary,
    onHeaderSoft: neutral[500],
    hero: neutral[0],
    heroBorder: brand.mist,
    onHero: brand.primary,
    onHeroSoft: neutral[500],
    heroTile: neutral[50],
    tabBar: neutral[0],
    tabInk: brand.primary,
    tabActive: brand.chip,
    onTabActive: brand.primary,
  },
  /** The phone's dark mode (app only), whichever theme is chosen. */
  dark: {
    bg: neutral[900],
    bgElevated: '#1f2a31',
    bgSunken: '#121a1e',
    border: 'rgba(232, 232, 232, 0.16)',
    borderStrong: 'rgba(232, 232, 232, 0.30)',
    ink: '#f2f2f0',
    inkSoft: 'rgba(242, 242, 240, 0.74)',
    inkFaint: 'rgba(242, 242, 240, 0.62)',
    primary: brand.chip,
    primaryHover: neutral[0],
    onPrimary: brand.primary,
    focusRing: brand.mist,
    danger: status.bounced.fgOnDark,
    success: status.cleared.fgOnDark,
    warning: status.deposited.fgOnDark,
    header: brand.primary,
    headerBorder: brand.primary,
    onHeader: neutral[0],
    onHeaderSoft: brand.mist,
    hero: brand.primary,
    heroBorder: brand.secondary,
    onHero: neutral[0],
    onHeroSoft: brand.mist,
    heroTile: 'rgba(255, 255, 255, 0.06)',
    chip: brand.secondary,
    onChip: brand.chip,
    track: brand.secondary,
    trackFill: brand.chip,
    tabBar: '#1f2a31',
    tabInk: brand.chip,
    tabActive: brand.chip,
    onTabActive: brand.primary,
  },
} as const satisfies Record<string, SemanticColors>;

/** Themes a person can choose. The dark palette follows the phone; it is not a choice. */
export const THEME_NAMES = ['default', 'white'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
export const DEFAULT_THEME: ThemeName = 'default';

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value);
}

/** Kept for code written before the theme switch: the default palette and the dark palette. */
export const light: SemanticColors = themes.default;
export const dark: SemanticColors = themes.dark;
