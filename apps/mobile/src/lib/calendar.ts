/**
 * Calendar helpers for the app's own views: the colour of each kind of item, grouping by day and
 * the ranges a view needs. Grids come from @vamar/shared (monthGrid, weekDays).
 */
import type { CalendarItem, CalendarItemKind } from '@vamar/shared';
import { status as statusColors, brand } from '@vamar/tokens';
import type { Theme } from './theme';

export const CALENDAR_KINDS: CalendarItemKind[] = [
  'cheque_due',
  'contract_end',
  'contract_renewal',
  'hearing',
  'work_order',
  'holiday',
  'event',
];

/** One colour per kind, readable on light and dark surfaces, always paired with a label. */
export function kindColor(kind: CalendarItemKind, theme: Theme): string {
  const dark = theme.scheme === 'dark';
  switch (kind) {
    case 'cheque_due':
      return dark ? statusColors.deposited.fgOnDark : statusColors.deposited.fg;
    case 'contract_end':
    case 'contract_renewal':
      return dark ? statusColors.replaced.fgOnDark : brand.secondary;
    case 'hearing':
      return dark ? statusColors.bounced.fgOnDark : statusColors.bounced.fg;
    case 'work_order':
      return dark ? statusColors.cleared.fgOnDark : statusColors.cleared.fg;
    case 'holiday':
      return theme.colors.inkFaint;
    case 'event':
      return theme.colors.primary;
  }
}

/** Items by day, multi-day items on every day they cover (at most 31 days per item). */
export function groupByDay(items: readonly CalendarItem[]): Map<string, CalendarItem[]> {
  const out = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const days = daysBetween(it.date, it.endDate);
    for (const d of days) {
      const list = out.get(d) ?? [];
      list.push(it);
      out.set(d, list);
    }
  }
  return out;
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [from];
  if (to <= from) return out;
  const start = Date.parse(`${from}T00:00:00Z`);
  for (let i = 1; i <= 31; i += 1) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    if (d > to) break;
    out.push(d);
  }
  return out;
}

/** Where a tap on an item goes. */
export function hrefFor(
  item: CalendarItem,
): { pathname: string; params?: Record<string, string> } | null {
  switch (item.entityType) {
    case 'cheque':
      return { pathname: '/cheque/[id]', params: { id: item.entityId } };
    case 'contract':
      return item.unitId ? { pathname: '/unit/[id]', params: { id: item.unitId } } : null;
    case 'dispute':
      return { pathname: '/dispute/[id]', params: { id: item.entityId } };
    case 'work_order':
      return { pathname: '/work-order/[id]', params: { id: item.entityId } };
    default:
      return null;
  }
}
