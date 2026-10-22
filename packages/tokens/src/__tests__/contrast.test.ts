import { describe, expect, it } from 'vitest';
import { status, THEME_NAMES, themes, type SemanticColors } from '../colors.js';

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Flattens an rgba() colour onto an opaque hex background. */
function flatten(color: string, bgHex: string): string {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(color);
  if (!m) return color;
  const a = Number(m[4]);
  const bg = [1, 3, 5].map((i) => parseInt(bgHex.slice(i, i + 2), 16));
  const out = [m[1], m[2], m[3]].map((v, i) => Math.round(Number(v) * a + (bg[i] ?? 0) * (1 - a)));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function contrast(fg: string, bg: string): number {
  const la = luminance(flatten(fg, bg));
  const lb = luminance(bg);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text that a theme paints, with the surface it sits on. */
function textPairs(c: SemanticColors): [string, string, string][] {
  const tile = flatten(c.heroTile, c.hero);
  return [
    ['ink on bg', c.ink, c.bg],
    ['ink on elevated', c.ink, c.bgElevated],
    ['ink on sunken', c.ink, c.bgSunken],
    ['soft ink on bg', c.inkSoft, c.bg],
    ['soft ink on elevated', c.inkSoft, c.bgElevated],
    ['faint ink on bg', c.inkFaint, c.bg],
    ['faint ink on elevated', c.inkFaint, c.bgElevated],
    ['on primary', c.onPrimary, c.primary],
    ['header title', c.onHeader, c.header],
    ['header soft text', c.onHeaderSoft, c.header],
    ['hero amount', c.onHero, c.hero],
    ['hero label', c.onHeroSoft, c.hero],
    ['hero tile amount', c.onHero, tile],
    ['hero tile label', c.onHeroSoft, tile],
    ['chip label', c.onChip, c.chip],
    ['tab label', c.tabInk, c.tabBar],
    ['active tab label', c.onTabActive, c.tabActive],
    ['danger text', c.danger, c.bgElevated],
    ['success text', c.success, c.bgElevated],
    ['warning text', c.warning, c.bgElevated],
  ];
}

describe('every theme meets WCAG AA for text (4.5:1)', () => {
  for (const name of [...THEME_NAMES, 'dark'] as const) {
    it(`${name} theme`, () => {
      for (const [label, fg, bg] of textPairs(themes[name])) {
        expect(contrast(fg, bg), `${name}: ${label}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('the progress fill stands out from its track (3:1, non-text)', () => {
    for (const name of [...THEME_NAMES, 'dark'] as const) {
      const c = themes[name];
      expect(contrast(c.trackFill, c.track), name).toBeGreaterThanOrEqual(3);
    }
  });

  it('status text on its chip background, both palettes', () => {
    for (const [name, s] of Object.entries(status)) {
      expect(contrast(s.fg, s.bg), `${name} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.fgOnDark, s.bgOnDark), `${name} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
