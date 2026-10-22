/**
 * App theme. Two themes the owner chooses in Settings ("default" slate and "white"), remembered
 * on the phone; when the phone is in dark mode the dark palette is used whichever is chosen.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import {
  DEFAULT_THEME,
  fontSize,
  isThemeName,
  radius,
  spacing,
  status,
  themes,
  type SemanticColors,
  type ThemeName,
} from '@vamar/tokens';
import { getItem, setItem } from './storage';

export interface Theme {
  name: ThemeName;
  scheme: 'light' | 'dark';
  colors: SemanticColors & { silver: string };
  status: typeof status;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
}

/** Almarai: "medium" is Bold and "semibold" ExtraBold, as headings and amounts are in the design. */
export const fonts = {
  light: 'Almarai-Light',
  regular: 'Almarai-Regular',
  medium: 'Almarai-Bold',
  semibold: 'Almarai-ExtraBold',
} as const;

interface ThemeState {
  name: ThemeName;
  ready: boolean;
  setName: (name: ThemeName) => Promise<void>;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [name, setNameState] = useState<ThemeName>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void getItem('theme').then((saved) => {
      if (isThemeName(saved)) setNameState(saved);
      setReady(true);
    });
  }, []);
  const setName = useCallback(async (next: ThemeName) => {
    setNameState(next);
    await setItem('theme', next);
  }, []);
  const value = useMemo(() => ({ name, ready, setName }), [name, ready, setName]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeChoice(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeChoice outside ThemeProvider');
  return ctx;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  const name = ctx?.name ?? DEFAULT_THEME;
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return useMemo(
    () => ({
      name,
      scheme,
      colors: { ...(scheme === 'dark' ? themes.dark : themes[name]), silver: '#c4c6be' },
      status,
      spacing,
      radius,
      fontSize,
    }),
    [name, scheme],
  );
}

export function statusColors(theme: Theme, key: keyof typeof status): { fg: string; bg: string } {
  const s = status[key];
  return theme.scheme === 'dark' ? { fg: s.fgOnDark, bg: s.bgOnDark } : { fg: s.fg, bg: s.bg };
}
