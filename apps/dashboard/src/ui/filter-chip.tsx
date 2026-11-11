/**
 * A filter that arrived in the link (from the Overview's Today panel, say) and has no control of
 * its own on the page: shown as a chip so staff can see why the list is short, and removed from
 * the URL with its button so a refresh does not bring it back.
 */
import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useCallback } from 'react';
import { useI18n } from '@/lib/i18n';

export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex h-9 max-w-full min-w-0 items-center gap-1 rounded-md bg-chip ps-3 pe-1 text-[14px] text-on-chip">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('filter_remove', { name: label })}
        className="grid size-7 shrink-0 place-items-center rounded-sm hover:bg-sunken"
      >
        <X className="size-4" aria-hidden />
      </button>
    </span>
  );
}

/** Removes the given keys from the page's URL search, keeping the rest. */
export function useDropSearch() {
  const navigate = useNavigate();
  return useCallback(
    (names: string[]) => {
      void navigate({
        to: '.',
        replace: true,
        search: (prev: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(prev).filter(([k]) => !names.includes(k))),
      } as never);
    },
    [navigate],
  );
}
