import { fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { View } from 'react-native';
import type { CalendarItem, PlainDate } from '@/lib/shared';
import * as theme from '@/lib/theme';
import { MonthGrid } from '@/ui/calendar';
import { renderApp } from '@/test/render';

const byDay = new Map<string, CalendarItem[]>();
const holidays = new Set<string>();

/** A year of month grids, as the Cheques calendar shows for a 12-month period. */
function Year() {
  const [selected, setSelected] = useState<PlainDate | null>(null);
  return (
    <View>
      {Array.from({ length: 12 }, (_, i) => (
        <MonthGrid
          key={i}
          year={2026}
          month={i + 1}
          weekStart="monday"
          today={'2026-11-21' as PlainDate}
          selected={selected}
          byDay={byDay}
          holidays={holidays}
          onSelect={setSelected}
        />
      ))}
    </View>
  );
}

describe('calendar grids', () => {
  it('re-render only the days whose selection changed when a day is tapped', async () => {
    const spy = jest.spyOn(theme, 'useTheme');
    await renderApp(<Year />, { signedIn: false });
    const day = await screen.findByLabelText('15 Mar 2026');
    const afterMount = spy.mock.calls.length;
    await fireEvent.press(day);
    const firstTap = spy.mock.calls.length - afterMount;
    expect(firstTap).toBeLessThanOrEqual(6);
    expect(screen.getByLabelText('15 Mar 2026').props.accessibilityState).toMatchObject({
      selected: true,
    });
    const beforeSecond = spy.mock.calls.length;
    await fireEvent.press(screen.getByLabelText('16 Mar 2026'));
    const secondTap = spy.mock.calls.length - beforeSecond;
    expect(screen.getByLabelText('15 Mar 2026').props.accessibilityState).toMatchObject({
      selected: false,
    });
    // Every useTheme call is one component rendering. A year has 504 day cells (1,407 renders
    // per tap before the cells were memoised); only the old and the new selected day render.
    expect(secondTap).toBeLessThanOrEqual(12);
  });
});
