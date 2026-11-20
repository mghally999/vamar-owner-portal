import { describe, expect, it } from 'vitest';
import { isReadySlot, parseTargets } from '../src/config';

const prod = { name: 'production', base: 'https://a.example.dev', readyEveryMinutes: 30 };

describe('parseTargets', () => {
  it('accepts the parsed array wrangler passes and a JSON string', () => {
    expect(parseTargets([prod])).toEqual([prod]);
    expect(parseTargets(JSON.stringify([prod]))).toEqual([prod]);
  });

  it.each([
    ['an empty list', []],
    ['not a list', { prod }],
    ['a path in base', [{ ...prod, base: 'https://a.example.dev/readyz' }]],
    ['http', [{ ...prod, base: 'http://a.example.dev' }]],
    ['an upper-case name', [{ ...prod, name: 'Prod' }]],
    ['a duplicate name', [prod, prod]],
    ['readyEveryMinutes not a multiple of 5', [{ ...prod, readyEveryMinutes: 7 }]],
    ['readyEveryMinutes below 5', [{ ...prod, readyEveryMinutes: 0 }]],
    ['readyEveryMinutes as text', [{ ...prod, readyEveryMinutes: '30' }]],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseTargets(raw)).toThrow();
  });
});

describe('isReadySlot', () => {
  const at = (iso: string) => Date.parse(iso);

  it('is true on exactly one 5-minute run per period', () => {
    const hour = Array.from({ length: 12 }, (_, i) => at('2026-11-20T10:00:00Z') + i * 300_000);
    expect(hour.filter((t) => isReadySlot(t, 30))).toEqual([
      at('2026-11-20T10:00:00Z'),
      at('2026-11-20T10:30:00Z'),
    ]);
    expect(hour.filter((t) => isReadySlot(t, 5))).toHaveLength(12);
    const day = Array.from({ length: 288 }, (_, i) => at('2026-11-20T00:00:00Z') + i * 300_000);
    expect(day.filter((t) => isReadySlot(t, 120))).toHaveLength(12);
  });
});
