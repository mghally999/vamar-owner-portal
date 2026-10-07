// TEMPORARY: from vamar.ae, replace with official files
// The site uses a stroked "V" monogram (viewBox 0 0 64 78) next to the word VAMAR set in a
// serif (Marcellus) with 0.16em letter-spacing. The paths below are copied from the site header.

/** Monogram paths, stroke only. Use `currentColor` so it adapts to the theme. */
export const markPaths = [
  'M5 6 L32 72 L59 6',
  'M26.5 68 L26.5 33',
  'M37.5 68 L37.5 24',
  'M26.5 33 L37.5 24',
  'M32 68 L32 29',
] as const;

export const markViewBox = '0 0 64 78';

/** Inline SVG string for web contexts. `color` defaults to currentColor. */
export function markSvg(options: { color?: string; size?: number } = {}): string {
  const color = options.color ?? 'currentColor';
  const size = options.size ?? 32;
  const height = Math.round((size * 78) / 64);
  const paths = markPaths.map((d) => `<path d="${d}"/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="${markViewBox}" fill="none" aria-hidden="true">` +
    `<g stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
  );
}

/** App icon: navy rounded square with the monogram, as published at vamar.ae/icon.svg. */
export const appIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">' +
  '<rect width="64" height="64" rx="13" fill="#162842"/>' +
  '<g stroke="#c4ccd3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
  '<path d="M14 15 L32 53 L50 15"/><path d="M27 50 L27 27"/><path d="M37 50 L37 21"/>' +
  '<path d="M27 27 L37 21"/><path d="M32 50 L32 24"/></g></svg>';

export const wordmark = {
  text: 'VAMAR',
  textAr: 'فامار',
  letterSpacingEm: 0.16,
} as const;
