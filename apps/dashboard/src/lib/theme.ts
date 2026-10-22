/**
 * Dashboard theme: "default" (slate sidebar and hero, as in the design file) or "white".
 * Remembered per browser; applied as `data-theme` on <html> before the first render.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_THEME, isThemeName, type ThemeName } from '@vamar/tokens';

const KEY = 'vamar.theme';
const listeners = new Set<() => void>();

function read(): ThemeName {
  try {
    const v = localStorage.getItem(KEY);
    return isThemeName(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Sets the attribute the generated tokens.css keys its palettes on. */
export function applyTheme(name: ThemeName = read()): void {
  if (name === 'default') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = name;
}

export function setTheme(name: ThemeName): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // private mode: the choice lasts for this page only
  }
  applyTheme(name);
  for (const l of listeners) l();
}

export function useTheme(): [ThemeName, (name: ThemeName) => void] {
  const name = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => DEFAULT_THEME,
  );
  const set = useCallback((n: ThemeName) => {
    setTheme(n);
  }, []);
  return [name, set];
}
