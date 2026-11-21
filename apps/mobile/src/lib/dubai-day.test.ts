import { describe, expect, it } from 'vitest';
import { dubaiDay } from './dubai-day';

describe('dubaiDay', () => {
  it('gives the day in Dubai, not the UTC day', () => {
    // 21:30 UTC on 31 Oct is 01:30 on 1 Nov in Dubai.
    expect(dubaiDay('2026-10-31T21:30:00.000Z')).toBe('2026-11-01');
    expect(dubaiDay('2026-10-31T19:59:59.000Z')).toBe('2026-10-31');
    expect(dubaiDay('2026-12-31T20:00:00Z')).toBe('2027-01-01');
  });
});
