import { useEffect } from 'react';

/**
 * Ctrl+K (or Cmd+K) anywhere opens the search palette. Kept apart from the palette so the shell
 * can listen for the shortcut without loading the palette (and its dialog) until it is used.
 */
export function useSearchShortcut(setOpen: (o: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [setOpen]);
}
