import { describe, expect, it } from 'vitest';
import { ltr } from './bidi';

describe('ltr', () => {
  it('wraps the run in a left-to-right isolate and keeps it intact', () => {
    expect(ltr('+971500000001')).toBe('⁦+971500000001⁩');
    expect(ltr('+971500000001').slice(1, -1)).toBe('+971500000001');
  });
});
