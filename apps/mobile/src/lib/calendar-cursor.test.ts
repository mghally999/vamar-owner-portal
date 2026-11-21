import { describe, expect, it } from 'vitest';
import { moveCursor } from './calendar-cursor';

describe('moveCursor', () => {
  it('moves a year from a leap day to a day that exists', () => {
    expect(moveCursor('year', '2028-02-29', 1)).toBe('2029-02-28');
    expect(moveCursor('year', '2028-02-29', -1)).toBe('2027-02-28');
    expect(moveCursor('year', '2026-11-21', 1)).toBe('2027-11-21');
  });

  it('moves a month, a week or a page of the agenda', () => {
    expect(moveCursor('month', '2026-01-31', 1)).toBe('2026-02-28');
    expect(moveCursor('month', '2026-01-15', -1)).toBe('2025-12-15');
    expect(moveCursor('week', '2026-11-21', 1)).toBe('2026-11-28');
    expect(moveCursor('agenda', '2026-11-21', -1)).toBe('2026-09-22');
  });
});
