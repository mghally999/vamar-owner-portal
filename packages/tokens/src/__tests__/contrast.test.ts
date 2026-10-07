import { describe, expect, it } from 'vitest';
import { dark, light, status } from '../colors.js';

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

describe('colour tokens meet WCAG AA (4.5:1 for text)', () => {
  it('body ink on backgrounds (light)', () => {
    expect(contrast(light.ink, light.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.ink, light.bgElevated)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.onPrimary, light.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('body ink on backgrounds (dark)', () => {
    expect(contrast(dark.ink, dark.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.ink, dark.bgElevated)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.onPrimary, dark.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('status text on its chip background, both themes', () => {
    for (const [name, s] of Object.entries(status)) {
      expect(contrast(s.fg, s.bg), `${name} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.fgOnDark, s.bgOnDark), `${name} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
