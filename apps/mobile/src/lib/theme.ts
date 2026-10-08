import { useColorScheme } from 'react-native';
import { dark, fontSize, light, radius, spacing, status, type SemanticColors } from '@vamar/tokens';

type Palette = Record<keyof SemanticColors, string>;

export interface Theme {
  scheme: 'light' | 'dark';
  colors: Palette & { silver: string };
  status: typeof status;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
}

export const fonts = {
  regular: 'IBMPlexSansArabic-Regular',
  medium: 'IBMPlexSansArabic-Medium',
  semibold: 'IBMPlexSansArabic-SemiBold',
} as const;

/** App follows the phone: light + dark. */
export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return {
    scheme,
    colors: { ...(scheme === 'dark' ? dark : light), silver: '#c4c6be' },
    status,
    spacing,
    radius,
    fontSize,
  };
}

export function statusColors(theme: Theme, key: keyof typeof status): { fg: string; bg: string } {
  const s = status[key];
  return theme.scheme === 'dark' ? { fg: s.fgOnDark, bg: s.bgOnDark } : { fg: s.fg, bg: s.bg };
}
